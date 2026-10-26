/**
 * Phase 2C PostgreSQL persistence adapters.
 * Production scrape ingest is not hooked; call these from a later dual-write increment.
 * latest.json schema and fetchMubasherQuote overlay are unchanged.
 */
export { seedUniverse } from "./seedUniverse.js";
export { persistSnapshot } from "./persistSnapshot.js";
export { persistRawBars } from "./persistRawBars.js";
export { persistQuoteLive } from "./persistQuoteLive.js";
export { persistValidation, persistValidationMany } from "./persistValidation.js";
export { persistCorporateAction, listCorporateActions, deriveAdjustedCloses } from "./persistCorporateAction.js";
export { auditHistoricalQuality } from "./auditHistoricalQuality.js";
export { persistFundamentals } from "./persistFundamentals.js";
export { persistScrapeRun } from "./persistScrapeRun.js";
export { persistHistoricalRun, loadMappedInstruments } from "./persistHistoricalRun.js";
export { persistFundamentalsRun } from "./persistFundamentalsRun.js";
export { isDbConfigured } from "../lib/db/pool.js";
