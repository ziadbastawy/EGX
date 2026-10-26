import { getPool } from "../lib/db/pool.js";
import { persistSnapshot } from "./persistSnapshot.js";
import { persistRawBars } from "./persistRawBars.js";

export async function loadMappedInstruments({ providerCode = "mubasher", tickers = null } = {}) {
  const pool = getPool();
  const params = [providerCode];
  let tickerFilter = "";
  if (tickers?.length) {
    params.push(tickers);
    tickerFilter = "AND i.display_ticker = ANY($2::text[])";
  }
  const { rows } = await pool.query(
    `SELECT i.id AS instrument_id, i.display_ticker AS ticker,
            p.id AS provider_id, p.code AS provider_code,
            psm.provider_symbol
       FROM instrument i
       JOIN provider_symbol_mapping psm ON psm.instrument_id = i.id
       JOIN provider p ON p.id = psm.provider_id
      WHERE p.code = $1
        AND psm.role = 'fetch'
        AND (psm.valid_to IS NULL OR psm.valid_to >= CURRENT_DATE)
        ${tickerFilter}
      ORDER BY i.display_ticker`,
    params
  );
  return rows;
}

/**
 * Persist one historical ingest snapshot. Caller fetches bars; this only writes.
 * Each instrument is committed independently.
 */
export async function persistHistoricalRun({
  range,
  fromDate = null,
  toDate = null,
  priceSource = "mubasher",
  items = [],
  rangeTruncated = false,
} = {}) {
  const snapshot = await persistSnapshot({
    scrapedAt: new Date().toISOString(),
    range: range || "custom",
    priceSource,
    errors: [],
    hostingContext: "local",
    rawManifest: {
      kind: "historical_ingest",
      fromDate,
      toDate,
      instrumentCount: items.length,
    },
  });

  const report = {
    snapshotId: snapshot.id,
    instrumentsProcessed: 0,
    barsFetched: 0,
    barsInserted: 0,
    barsSkipped: 0,
    failures: [],
    missingHistory: [],
  };

  const pool = getPool();

  for (const item of items) {
    const ticker = item.ticker;
    report.instrumentsProcessed += 1;

    if (item.failure) {
      report.failures.push({ ticker, error: item.failure });
      continue;
    }
    if (item.missingHistory) {
      report.missingHistory.push(item.missingHistory);
      continue;
    }

    const bars = item.bars || [];
    report.barsFetched += bars.length;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await persistRawBars({
        instrumentId: item.instrumentId,
        ticker,
        providerId: item.providerId,
        providerCode: item.providerCode,
        snapshotId: snapshot.id,
        sourceKind: item.sourceKind,
        tzParseRule: "plus_02",
        bars: bars.map((b) => ({
          t: b.t,
          open: b.o ?? b.open,
          high: b.h ?? b.high,
          low: b.l ?? b.low,
          close: b.c ?? b.close,
          volume: b.v ?? b.volume,
          sourceTimestampRaw: b.t != null ? String(b.t) : null,
        })),
        rangeTruncated,
        skipExactDuplicates: true,
        client,
      });
      await client.query("COMMIT");
      report.barsInserted += result.inserted?.length || 0;
      report.barsSkipped += result.skipped || 0;
      if (result.unresolved) {
        report.failures.push({ ticker, error: "mapping_unresolved" });
      }
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      report.failures.push({ ticker, error: err.message || String(err) });
    } finally {
      client.release();
    }
  }

  return report;
}
