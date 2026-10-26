import { persistSnapshot } from "./persistSnapshot.js";
import { persistValidationMany } from "./persistValidation.js";
import { listCorporateActions } from "./persistCorporateAction.js";
import { getPool } from "../lib/db/pool.js";
import { CLOSE_JUMP_WARN_PCT, isEgxWeekday } from "./integrity.js";

/** Gaps of this many EGX weekdays are flagged. Holidays remain UNKNOWN. */
export const SUSPICIOUS_GAP_WEEKDAYS = 10;

const OHLC_SQL = `
  high < low
  OR (open IS NOT NULL AND high IS NOT NULL AND open > high)
  OR (open IS NOT NULL AND low IS NOT NULL AND open < low)
  OR (close IS NOT NULL AND high IS NOT NULL AND close > high)
  OR (close IS NOT NULL AND low IS NOT NULL AND close < low)
`;

function ymd(value) {
  if (value == null) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s.slice(0, 10);
}

function toPayload(row, extra = {}) {
  return {
    sessionDate: row.session_date != null ? ymd(row.session_date) : null,
    observationSeq: row.observation_seq ?? null,
    open: row.open ?? null,
    high: row.high ?? null,
    low: row.low ?? null,
    close: row.close ?? null,
    volume: row.volume ?? null,
    ...extra,
  };
}

async function persistFailures(snapshotId, checkCode, severity, rows, payloadFn) {
  if (!rows.length) return 0;
  const batch = rows.map((row) => ({
    snapshotId,
    instrumentId: row.instrument_id,
    ohlcvBarRawId: row.id || row.ohlcv_bar_raw_id || null,
    checkCode,
    severity,
    passed: false,
    payload: payloadFn(row),
  }));
  const chunk = 200;
  for (let i = 0; i < batch.length; i += chunk) {
    await persistValidationMany(batch.slice(i, i + chunk));
  }
  return rows.length;
}

/**
 * Read-only wrt ohlcv_bar_raw. Writes data_validation_result under a new snapshot.
 * Isolated from live scrape.
 */
export async function auditHistoricalQuality({
  tickers = null,
  sourceKind = null,
} = {}) {
  const pool = getPool();
  const params = [];
  const filters = [];
  if (tickers?.length) {
    params.push(tickers);
    filters.push(`i.display_ticker = ANY($${params.length}::text[])`);
  }
  if (sourceKind) {
    params.push(sourceKind);
    filters.push(`b.source_kind = $${params.length}`);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const { rows: counts } = await pool.query(
    `SELECT COUNT(*)::int AS bars,
            COUNT(DISTINCT b.instrument_id)::int AS instruments
       FROM ohlcv_bar_raw b
       JOIN instrument i ON i.id = b.instrument_id
       ${where}`,
    params
  );

  const snapshot = await persistSnapshot({
    scrapedAt: new Date().toISOString(),
    range: "audit",
    priceSource: "ohlcv_bar_raw",
    errors: [],
    hostingContext: "local",
    rawManifest: {
      kind: "data_quality_audit",
      tickers: tickers || null,
      sourceKind: sourceKind || null,
      barsEvaluated: counts[0]?.bars ?? 0,
      instrumentsEvaluated: counts[0]?.instruments ?? 0,
    },
  });

  const failures = {};

  const { rows: ohlcRows } = await pool.query(
    `SELECT b.id, b.instrument_id, b.session_date, b.observation_seq,
            b.open, b.high, b.low, b.close, b.volume, i.display_ticker
       FROM ohlcv_bar_raw b
       JOIN instrument i ON i.id = b.instrument_id
       ${where ? `${where} AND` : "WHERE"}
       (${OHLC_SQL})
       AND b.open IS NOT NULL AND b.high IS NOT NULL AND b.low IS NOT NULL AND b.close IS NOT NULL`,
    params
  );
  failures.ohlc_invalid = await persistFailures(
    snapshot.id,
    "ohlc_invalid",
    "fail",
    ohlcRows,
    (r) => toPayload(r, { ticker: r.display_ticker })
  );

  const { rows: negRows } = await pool.query(
    `SELECT b.id, b.instrument_id, b.session_date, b.observation_seq,
            b.open, b.high, b.low, b.close, b.volume, i.display_ticker
       FROM ohlcv_bar_raw b
       JOIN instrument i ON i.id = b.instrument_id
       ${where ? `${where} AND` : "WHERE"}
       (b.open < 0 OR b.high < 0 OR b.low < 0 OR b.close < 0)`,
    params
  );
  failures.negative_price = await persistFailures(
    snapshot.id,
    "negative_price",
    "fail",
    negRows,
    (r) => toPayload(r, { ticker: r.display_ticker })
  );

  const { rows: volRows } = await pool.query(
    `SELECT b.id, b.instrument_id, b.session_date, b.observation_seq,
            b.open, b.high, b.low, b.close, b.volume, i.display_ticker
       FROM ohlcv_bar_raw b
       JOIN instrument i ON i.id = b.instrument_id
       ${where ? `${where} AND` : "WHERE"}
       b.volume < 0`,
    params
  );
  failures.volume_invalid = await persistFailures(
    snapshot.id,
    "volume_invalid",
    "fail",
    volRows,
    (r) => toPayload(r, { ticker: r.display_ticker })
  );

  const { rows: dupRows } = await pool.query(
    `SELECT (ARRAY_AGG(b.id ORDER BY b.observation_seq))[1] AS id,
            b.instrument_id,
            b.session_date,
            MAX(b.observation_seq) AS observation_seq,
            COUNT(*)::int AS observation_count,
            i.display_ticker
       FROM ohlcv_bar_raw b
       JOIN instrument i ON i.id = b.instrument_id
       ${where}
       GROUP BY b.instrument_id, b.session_date, i.display_ticker
       HAVING COUNT(*) > 1`,
    params
  );
  failures.duplicate_session_date = await persistFailures(
    snapshot.id,
    "duplicate_session_date",
    "warn",
    dupRows,
    (r) => ({
      ticker: r.display_ticker,
      sessionDate: ymd(r.session_date),
      observationSeq: r.observation_seq,
      observationCount: r.observation_count,
      note: "Includes live re-scrapes kept as extra observation_seq; raw rows are not deleted",
    })
  );

  const { rows: weekendRows } = await pool.query(
    `SELECT b.id, b.instrument_id, b.session_date, b.observation_seq,
            b.open, b.high, b.low, b.close, b.volume, i.display_ticker
       FROM ohlcv_bar_raw b
       JOIN instrument i ON i.id = b.instrument_id
       ${where ? `${where} AND` : "WHERE"}
       EXTRACT(ISODOW FROM b.session_date) IN (5, 6)`,
    params
  );
  failures.weekend_session_date = await persistFailures(
    snapshot.id,
    "weekend_session_date",
    "warn",
    weekendRows,
    (r) => toPayload(r, { ticker: r.display_ticker, note: "Fri/Sat; official holidays UNKNOWN" })
  );

  const { rows: series } = await pool.query(
    `SELECT b.id, b.instrument_id, b.session_date, b.observation_seq, b.close, i.display_ticker
       FROM ohlcv_bar_raw b
       JOIN instrument i ON i.id = b.instrument_id
       ${where ? `${where} AND` : "WHERE"}
       b.observation_seq = 1 AND b.close IS NOT NULL
       ORDER BY b.instrument_id, b.session_date`,
    params
  );

  const jumpRows = [];
  const gapRows = [];
  let prev = null;
  for (const row of series) {
    if (!prev || prev.instrument_id !== row.instrument_id) {
      prev = row;
      continue;
    }
    const d0 = ymd(prev.session_date);
    const d1 = ymd(row.session_date);
    const a = Number(prev.close);
    const b = Number(row.close);
    if (Number.isFinite(a) && a !== 0 && Number.isFinite(b)) {
      const pct = (b - a) / Math.abs(a);
      if (Math.abs(pct) >= CLOSE_JUMP_WARN_PCT) {
        jumpRows.push({
          id: row.id,
          instrument_id: row.instrument_id,
          session_date: row.session_date,
          observation_seq: row.observation_seq,
          close: row.close,
          display_ticker: row.display_ticker,
          prevClose: prev.close,
          prevSessionDate: d0,
          jumpPct: pct,
        });
      }
    }
    let weekdays = 0;
    const start = new Date(`${d0}T12:00:00+02:00`);
    const end = new Date(`${d1}T12:00:00+02:00`);
    if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())) {
      const cur = new Date(start.getTime() + 86400000);
      while (cur < end) {
        const y = cur.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
        if (isEgxWeekday(y)) weekdays += 1;
        cur.setTime(cur.getTime() + 86400000);
      }
    }
    if (weekdays >= SUSPICIOUS_GAP_WEEKDAYS) {
      gapRows.push({
        id: row.id,
        instrument_id: row.instrument_id,
        session_date: row.session_date,
        observation_seq: row.observation_seq,
        close: row.close,
        display_ticker: row.display_ticker,
        prevSessionDate: d0,
        egxWeekdaysSkipped: weekdays,
      });
    }
    prev = row;
  }

  failures.close_jump_25pct = await persistFailures(
    snapshot.id,
    "close_jump_25pct",
    "warn",
    jumpRows,
    (r) => ({
      ticker: r.display_ticker,
      sessionDate: ymd(r.session_date),
      prevSessionDate: r.prevSessionDate,
      close: r.close,
      prevClose: r.prevClose,
      jumpPct: r.jumpPct,
      note: "Not auto-labeled as a corporate action",
    })
  );

  failures.suspicious_session_gap = await persistFailures(
    snapshot.id,
    "suspicious_session_gap",
    "warn",
    gapRows,
    (r) => ({
      ticker: r.display_ticker,
      sessionDate: ymd(r.session_date),
      prevSessionDate: r.prevSessionDate,
      egxWeekdaysSkipped: r.egxWeekdaysSkipped,
      note: "Holidays UNKNOWN; gap is not proof of missing provider sessions",
    })
  );

  const caRows = await listCorporateActions();
  const caCapability = {
    table: "corporate_action",
    rowCount: caRows.length,
    ingestion: "not_available_from_mubasher",
    detail:
      "Mubasher historical CSV and live quote JSON have no split, bonus, dividend, or adjClose fields. corporate_action storage and in-memory deriveAdjustedCloses exist; no CA rows were invented.",
  };

  if (caRows.length > 0) {
    failures.ca_unadjusted = 0;
  }

  return {
    snapshotId: snapshot.id,
    barsEvaluated: counts[0]?.bars ?? 0,
    instrumentsEvaluated: counts[0]?.instruments ?? 0,
    failures,
    corporateActions: caCapability,
  };
}
