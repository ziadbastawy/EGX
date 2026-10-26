import { getPool } from "../lib/db/pool.js";
import { persistValidation } from "./persistValidation.js";
import {
  changeFieldsTrusted,
  derivedChange,
  isEgxWeekday,
} from "./integrity.js";

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
  return rows[0]?.id ?? null;
}

export async function persistQuoteLive({
  instrumentId = null,
  ticker,
  snapshotId,
  providerId = null,
  providerCode = null,
  lastPrice = null,
  previousCloseVendor = null,
  currency = null,
  asOf = null,
  quoteSource,
  cairoDayAtScrape = null,
  csvLastSessionDate = null,
  csvLastClose = null,
  overlayPath = null,
  vendorChange = null,
  vendorChangePercentage = null,
} = {}) {
  const pool = getPool();
  const resolvedProviderId = await resolveProviderId(pool, providerId, providerCode);
  const resolvedInstrumentId = await resolveInstrumentId(pool, instrumentId, ticker);
  if (!resolvedInstrumentId) {
    await persistValidation({
      snapshotId,
      checkCode: "mapping_unresolved",
      severity: "fail",
      passed: false,
      payload: { ticker },
    });
    return { row: null, unresolved: true };
  }

  const derived = derivedChange(lastPrice, previousCloseVendor);
  const trusted = changeFieldsTrusted(
    vendorChange,
    vendorChangePercentage,
    derived.derivedChange,
    derived.derivedChangePercentage
  );

  const { rows } = await pool.query(
    `INSERT INTO quote_live (
       instrument_id, snapshot_id, provider_id, ticker, last_price,
       previous_close_vendor, currency, as_of, quote_source,
       cairo_day_at_scrape, csv_last_session_date, overlay_path,
       vendor_change, vendor_change_percentage, derived_change,
       derived_change_percentage, change_fields_trusted
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      resolvedInstrumentId,
      snapshotId,
      resolvedProviderId,
      ticker,
      lastPrice,
      previousCloseVendor,
      currency,
      asOf,
      quoteSource,
      cairoDayAtScrape,
      csvLastSessionDate,
      overlayPath,
      vendorChange,
      vendorChangePercentage,
      derived.derivedChange,
      derived.derivedChangePercentage,
      trusted,
    ]
  );
  const row = rows[0];

  if (vendorChange == null && vendorChangePercentage == null && derived.derivedChange != null) {
    await persistValidation({
      snapshotId,
      instrumentId: resolvedInstrumentId,
      quoteLiveId: row.id,
      checkCode: "missing_vendor_change",
      severity: "info",
      passed: true,
      payload: { derivedChange: derived.derivedChange },
    });
  }
  if (vendorChange != null && derived.derivedChange != null && !trusted) {
    await persistValidation({
      snapshotId,
      instrumentId: resolvedInstrumentId,
      quoteLiveId: row.id,
      checkCode: "vendor_change_mismatch",
      severity: "warn",
      passed: false,
      payload: { vendorChange, derivedChange: derived.derivedChange },
    });
  }
  if (vendorChangePercentage != null && derived.derivedChangePercentage != null) {
    const pctOk =
      Math.abs(Number(vendorChangePercentage) - Number(derived.derivedChangePercentage)) <= 0.05;
    if (!pctOk) {
      await persistValidation({
        snapshotId,
        instrumentId: resolvedInstrumentId,
        quoteLiveId: row.id,
        checkCode: "vendor_change_pct_mismatch",
        severity: "warn",
        passed: false,
        payload: {
          vendorChangePercentage,
          derivedChangePercentage: derived.derivedChangePercentage,
        },
      });
    }
  }

  if (
    lastPrice != null &&
    csvLastClose != null &&
    Number(lastPrice) !== Number(csvLastClose)
  ) {
    await persistValidation({
      snapshotId,
      instrumentId: resolvedInstrumentId,
      quoteLiveId: row.id,
      checkCode: "last_ne_csv_close",
      severity: "info",
      passed: false,
      payload: { lastPrice, csvLastClose, csvLastSessionDate, overlayPath },
    });
  }

  if (cairoDayAtScrape && overlayPath && overlayPath !== "none" && !isEgxWeekday(cairoDayAtScrape)) {
    await persistValidation({
      snapshotId,
      instrumentId: resolvedInstrumentId,
      quoteLiveId: row.id,
      checkCode: "overlay_non_session_date",
      severity: "warn",
      passed: false,
      payload: { cairoDayAtScrape, overlayPath },
    });
  }

  return { row, unresolved: false };
}
