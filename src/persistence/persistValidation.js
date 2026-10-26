import { getPool } from "../lib/db/pool.js";

export async function persistValidation({
  snapshotId = null,
  instrumentId = null,
  ohlcvBarRawId = null,
  quoteLiveId = null,
  checkCode,
  severity,
  passed,
  payload = null,
  client = null,
} = {}) {
  const db = client || getPool();
  const { rows } = await db.query(
    `INSERT INTO data_validation_result (
       snapshot_id, instrument_id, ohlcv_bar_raw_id, quote_live_id,
       check_code, severity, passed, payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      snapshotId,
      instrumentId,
      ohlcvBarRawId,
      quoteLiveId,
      checkCode,
      severity,
      passed,
      payload == null ? null : JSON.stringify(payload),
    ]
  );
  return rows[0];
}

export async function persistValidationMany(rows) {
  const out = [];
  for (const row of rows) out.push(await persistValidation(row));
  return out;
}
