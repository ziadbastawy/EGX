import { getPool } from "../lib/db/pool.js";

const CA_TYPES = new Set(["split", "bonus", "cash_dividend", "rights", "unknown_discontinuity"]);
const CA_SOURCES = new Set(["vendor", "manual", "research"]);
const CA_CONFIDENCE = new Set(["verified", "inferred", "disputed"]);

/**
 * Storage foundation for corporate_action. Does not invent events.
 * Mubasher CSV/quote currently has no split, dividend, or adjClose field —
 * callers must supply a cited row or this stays empty.
 */
export async function persistCorporateAction({
  instrumentId,
  type,
  exDate,
  recordDate = null,
  payDate = null,
  ratioNum = null,
  ratioDen = null,
  cashAmount = null,
  currency = null,
  source,
  citation = null,
  confidence,
  notes = null,
  client = null,
} = {}) {
  if (!instrumentId) throw new Error("instrumentId is required");
  if (!CA_TYPES.has(type)) throw new Error(`Invalid corporate_action type: ${type}`);
  if (!exDate) throw new Error("exDate is required");
  if (!CA_SOURCES.has(source)) throw new Error(`Invalid corporate_action source: ${source}`);
  if (!CA_CONFIDENCE.has(confidence)) {
    throw new Error(`Invalid corporate_action confidence: ${confidence}`);
  }

  const db = client || getPool();
  const { rows } = await db.query(
    `INSERT INTO corporate_action (
       instrument_id, type, ex_date, record_date, pay_date,
       ratio_num, ratio_den, cash_amount, currency, source, citation, confidence, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      instrumentId,
      type,
      exDate,
      recordDate,
      payDate,
      ratioNum,
      ratioDen,
      cashAmount,
      currency,
      source,
      citation,
      confidence,
      notes,
    ]
  );
  return rows[0];
}

export async function listCorporateActions({ instrumentId = null, client = null } = {}) {
  const db = client || getPool();
  if (instrumentId) {
    const { rows } = await db.query(
      `SELECT * FROM corporate_action WHERE instrument_id = $1 ORDER BY ex_date`,
      [instrumentId]
    );
    return rows;
  }
  const { rows } = await db.query(`SELECT * FROM corporate_action ORDER BY ex_date`);
  return rows;
}

/**
 * In-memory derived closes only. Never writes ohlcv_bar_raw.
 * Split/bonus: prices before ex_date are multiplied by ratio_den/ratio_num
 * (e.g. 1.1-for-1 stored as 11/10). Cash dividends are not applied (incomplete).
 */
export function deriveAdjustedCloses(rawBars, actions) {
  const events = (actions || []).filter(
    (a) => (a.type === "split" || a.type === "bonus") && a.ratio_num != null && a.ratio_den != null
  );
  if (!events.length) {
    return {
      quality: "incomplete_ca",
      reason: "no_split_bonus_rows",
      bars: (rawBars || []).map((b) => ({
        sessionDate: b.session_date || b.sessionDate,
        close: b.close,
        adjustedClose: null,
      })),
    };
  }

  const bars = [...(rawBars || [])].map((b) => {
    const sessionDate = String(b.session_date || b.sessionDate || "").slice(0, 10);
    let factor = 1;
    for (const ev of events) {
      const ex = String(ev.ex_date || ev.exDate).slice(0, 10);
      if (sessionDate && sessionDate < ex) {
        const num = Number(ev.ratio_num ?? ev.ratioNum);
        const den = Number(ev.ratio_den ?? ev.ratioDen);
        if (Number.isFinite(num) && Number.isFinite(den) && num !== 0) {
          factor *= den / num;
        }
      }
    }
    const close = b.close == null ? null : Number(b.close);
    return {
      sessionDate,
      close,
      adjustedClose: close == null || !Number.isFinite(close) ? null : close * factor,
    };
  });

  return { quality: "split_bonus_only", reason: null, bars };
}
