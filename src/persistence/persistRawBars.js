import { getPool } from "../lib/db/pool.js";
import { persistValidation } from "./persistValidation.js";
import {
  isEgxWeekday,
  negativePrice,
  ohlcInvalid,
  sessionDateFromMs,
  sha256Hex,
  volumeInvalid,
} from "./integrity.js";

function numKey(x) {
  if (x == null || x === "") return "";
  const n = Number(x);
  return Number.isFinite(n) ? String(n) : "";
}

function ohlcvKey(bar) {
  return [
    numKey(bar.open ?? bar.o),
    numKey(bar.high ?? bar.h),
    numKey(bar.low ?? bar.l),
    numKey(bar.close ?? bar.c),
    numKey(bar.volume ?? bar.v),
  ].join("|");
}

async function resolveProviderId(pool, providerId, providerCode) {
  if (providerId) return providerId;
  const { rows } = await pool.query("SELECT id FROM provider WHERE code = $1", [providerCode]);
  if (!rows[0]) throw new Error(`Unknown provider: ${providerCode}`);
  return rows[0].id;
}

async function resolveInstrumentId(pool, instrumentId, ticker) {
  if (instrumentId) return instrumentId;
  const { rows } = await pool.query(
    "SELECT id FROM instrument WHERE display_ticker = $1",
    [ticker]
  );
  if (!rows[0]) return null;
  return rows[0].id;
}

/**
 * Insert-only raw OHLCV. Never writes live overlay bars.
 * observation_seq starts after existing max for the uniqueness key so re-scrapes
 * keep duplicate observations instead of colliding or dropping them.
 *
 * skipExactDuplicates: historical ingest only. Match unused existing rows with the
 * same session_date + OHLC+volume so a second ingest of the same provider bars
 * does not insert. Intra-file duplicate dates still keep observation_seq on first ingest.
 * Live scrape dual-write must leave this false (default).
 */
export async function persistRawBars({
  instrumentId = null,
  ticker = null,
  providerId = null,
  providerCode = null,
  snapshotId = null,
  sourceKind,
  tzParseRule = "plus_02",
  bars = [],
  rangeTruncated = false,
  skipExactDuplicates = false,
  client = null,
} = {}) {
  const pool = client || getPool();
  const resolvedProviderId = await resolveProviderId(pool, providerId, providerCode);
  const resolvedInstrumentId = await resolveInstrumentId(pool, instrumentId, ticker);
  if (!resolvedInstrumentId) {
    await persistValidation({
      snapshotId,
      checkCode: "mapping_unresolved",
      severity: "fail",
      passed: false,
      payload: { ticker, providerCode },
      client,
    });
    return { inserted: [], skipped: 0, unresolved: true };
  }

  const seqCursor = new Map();
  async function nextSeq(sessionDate) {
    const key = `${resolvedInstrumentId}|${resolvedProviderId}|${sourceKind}|${sessionDate}`;
    if (!seqCursor.has(key)) {
      const { rows } = await pool.query(
        `SELECT COALESCE(MAX(observation_seq), 0) AS max_seq
         FROM ohlcv_bar_raw
         WHERE instrument_id = $1 AND provider_id = $2
           AND source_kind = $3 AND session_date = $4`,
        [resolvedInstrumentId, resolvedProviderId, sourceKind, sessionDate]
      );
      seqCursor.set(key, Number(rows[0].max_seq));
    }
    const n = seqCursor.get(key) + 1;
    seqCursor.set(key, n);
    return n;
  }

  const unusedExisting = [];
  if (skipExactDuplicates) {
    const { rows: existing } = await pool.query(
      `SELECT id, session_date::text AS session_date, open, high, low, close, volume
         FROM ohlcv_bar_raw
        WHERE instrument_id = $1 AND provider_id = $2 AND source_kind = $3`,
      [resolvedInstrumentId, resolvedProviderId, sourceKind]
    );
    for (const row of existing) {
      unusedExisting.push({
        sessionDate: String(row.session_date).slice(0, 10),
        key: ohlcvKey(row),
      });
    }
  }

  const inserted = [];
  let skipped = 0;
  for (const bar of bars) {
    const sessionDate =
      bar.sessionDate || sessionDateFromMs(bar.t, tzParseRule);
    if (!sessionDate) {
      await persistValidation({
        snapshotId,
        instrumentId: resolvedInstrumentId,
        checkCode: "invalid_date_parse",
        severity: "fail",
        passed: false,
        payload: { ticker, t: bar.t, sourceTimestampRaw: bar.sourceTimestampRaw },
        client,
      });
      continue;
    }

    if (skipExactDuplicates) {
      const key = ohlcvKey({
        open: bar.open ?? bar.o,
        high: bar.high ?? bar.h,
        low: bar.low ?? bar.l,
        close: bar.close ?? bar.c,
        volume: bar.volume ?? bar.v,
      });
      const idx = unusedExisting.findIndex(
        (row) => row.sessionDate === sessionDate && row.key === key
      );
      if (idx !== -1) {
        unusedExisting.splice(idx, 1);
        skipped += 1;
        continue;
      }
    }

    const observationSeq = await nextSeq(sessionDate);
    const rowHash =
      bar.rowHash ??
      sha256Hex(
        [sessionDate, bar.open, bar.high, bar.low, bar.close, bar.volume, observationSeq].join("|")
      );

    const { rows } = await pool.query(
      `INSERT INTO ohlcv_bar_raw (
         instrument_id, provider_id, snapshot_id, session_date, observation_seq,
         source_kind, open, high, low, close, volume,
         source_timestamp_raw, tz_parse_rule, row_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        resolvedInstrumentId,
        resolvedProviderId,
        snapshotId,
        sessionDate,
        observationSeq,
        sourceKind,
        bar.open ?? bar.o ?? null,
        bar.high ?? bar.h ?? null,
        bar.low ?? bar.l ?? null,
        bar.close ?? bar.c ?? null,
        bar.volume ?? bar.v ?? null,
        bar.sourceTimestampRaw ?? (bar.t != null ? String(bar.t) : null),
        tzParseRule,
        rowHash,
      ]
    );
    const row = rows[0];
    inserted.push(row);

    const invalid = ohlcInvalid({
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
    });
    if (invalid) {
      await persistValidation({
        snapshotId,
        instrumentId: resolvedInstrumentId,
        ohlcvBarRawId: row.id,
        checkCode: "ohlc_invalid",
        severity: "fail",
        passed: false,
        payload: { sessionDate, observationSeq, open: row.open, high: row.high, low: row.low, close: row.close },
        client,
      });
    }
    if (
      negativePrice({
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
      })
    ) {
      await persistValidation({
        snapshotId,
        instrumentId: resolvedInstrumentId,
        ohlcvBarRawId: row.id,
        checkCode: "negative_price",
        severity: "fail",
        passed: false,
        payload: { sessionDate, observationSeq, open: row.open, high: row.high, low: row.low, close: row.close },
        client,
      });
    }
    if (volumeInvalid(row)) {
      await persistValidation({
        snapshotId,
        instrumentId: resolvedInstrumentId,
        ohlcvBarRawId: row.id,
        checkCode: "volume_invalid",
        severity: "fail",
        passed: false,
        payload: { sessionDate, observationSeq, volume: row.volume },
        client,
      });
    }
    if (sessionDate && !isEgxWeekday(sessionDate)) {
      await persistValidation({
        snapshotId,
        instrumentId: resolvedInstrumentId,
        ohlcvBarRawId: row.id,
        checkCode: "weekend_session_date",
        severity: "warn",
        passed: false,
        payload: { sessionDate, observationSeq },
        client,
      });
    }
    if (observationSeq > 1) {
      await persistValidation({
        snapshotId,
        instrumentId: resolvedInstrumentId,
        ohlcvBarRawId: row.id,
        checkCode: "duplicate_session_date",
        severity: "warn",
        passed: false,
        payload: { sessionDate, observationSeq },
        client,
      });
    }
  }

  if (rangeTruncated) {
    await persistValidation({
      snapshotId,
      instrumentId: resolvedInstrumentId,
      checkCode: "range_truncated",
      severity: "info",
      passed: true,
      payload: { barCount: inserted.length, sourceKind },
      client,
    });
  }

  return { inserted, skipped, unresolved: false };
}
