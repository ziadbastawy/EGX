import { getPool } from "../lib/db/pool.js";

export async function persistSnapshot({
  scrapedAt,
  range,
  priceSource,
  watchIntervalSec = null,
  errors = [],
  universeFileSha256 = null,
  hostingContext = null,
  payloadHash = null,
  rawManifest = null,
} = {}) {
  const pool = getPool();
  const errorList = Array.isArray(errors) ? errors : [];
  const { rows } = await pool.query(
    `INSERT INTO data_snapshot (
       scraped_at, range, price_source, watch_interval_sec, error_count,
       errors, universe_file_sha256, hosting_context, payload_hash, raw_manifest
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb)
     RETURNING *`,
    [
      scrapedAt,
      range,
      priceSource,
      watchIntervalSec,
      errorList.length,
      JSON.stringify(errorList),
      universeFileSha256,
      hostingContext,
      payloadHash,
      rawManifest == null ? null : JSON.stringify(rawManifest),
    ]
  );
  return rows[0];
}
