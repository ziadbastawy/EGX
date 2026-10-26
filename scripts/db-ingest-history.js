import { closePool, isDbConfigured } from "../src/lib/db/pool.js";
import { isoDateStartMs, rangeStartMs } from "../src/lib/mubasherCsv.js";
import { fetchHistoricalBars } from "../src/lib/fetchHistoricalBars.js";
import {
  loadMappedInstruments,
  persistHistoricalRun,
} from "../src/persistence/persistHistoricalRun.js";

function argValue(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return null;
  return argv[i + 1];
}

function parseCsvList(value) {
  if (!value) return null;
  const list = String(value)
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.includes(".") ? s.toUpperCase() : `${s.toUpperCase()}.CA`));
  return list.length ? list : null;
}

function parseArgs(argv) {
  const range = argValue(argv, "--range") || process.env.RANGE || null;
  const fromDate = argValue(argv, "--from") || process.env.FROM || null;
  const toDate = argValue(argv, "--to") || process.env.TO || null;
  const limitRaw = argValue(argv, "--limit") || process.env.LIMIT || null;
  const symbols =
    parseCsvList(argValue(argv, "--symbols")) || parseCsvList(process.env.SYMBOLS);
  const providerCode = (
    argValue(argv, "--provider") ||
    process.env.PROVIDER ||
    "mubasher"
  ).toLowerCase();

  if (!range && !fromDate) {
    throw new Error("Provide --range / RANGE or --from / FROM (optional --to / TO)");
  }

  let fromMs = fromDate ? isoDateStartMs(fromDate) : null;
  if (fromMs == null && fromDate) throw new Error(`Invalid --from date: ${fromDate}`);
  const toMs = toDate ? isoDateStartMs(toDate) : null;
  if (toMs == null && toDate) throw new Error(`Invalid --to date: ${toDate}`);

  if (range) {
    const rangeFrom = rangeStartMs(range);
    fromMs = fromMs == null ? rangeFrom : Math.max(fromMs, rangeFrom);
  }

  const limit = limitRaw != null && limitRaw !== "" ? Number(limitRaw) : null;
  if (limit != null && (!Number.isFinite(limit) || limit < 1)) {
    throw new Error("Invalid --limit");
  }

  return {
    range: range || (fromDate || toDate ? "custom" : "5d"),
    fromDate,
    toDate,
    fromMs,
    toMs,
    limit,
    symbols,
    providerCode,
  };
}

function pickInstruments(rows, { symbols, limit }) {
  let list = rows;
  if (symbols?.length) {
    const want = new Set(symbols);
    list = list.filter((r) => want.has(r.ticker));
  }
  if (limit != null) {
    const comi = list.filter((r) => r.ticker === "COMI.CA");
    const rest = list.filter((r) => r.ticker !== "COMI.CA");
    list = [...comi, ...rest].slice(0, limit);
  }
  return list;
}

if (!isDbConfigured()) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const opts = parseArgs(process.argv.slice(2));
const mapped = await loadMappedInstruments({ providerCode: opts.providerCode });
const instruments = pickInstruments(mapped, opts);

if (!instruments.length) {
  console.error("No mapped instruments (run npm run db:seed first)");
  await closePool();
  process.exit(1);
}

const rangeLabel = opts.fromDate || opts.toDate
  ? `${opts.range} from=${opts.fromDate || "-"} to=${opts.toDate || "-"}`
  : opts.range;

console.log(
  `Historical ingest — ${instruments.length} instruments · ${rangeLabel} · provider=${opts.providerCode}`
);

const items = [];
for (const inst of instruments) {
  try {
    const fetched = await fetchHistoricalBars({
      ticker: inst.ticker,
      providerCode: inst.provider_code,
      providerSymbol: inst.provider_symbol,
      range: opts.range,
      fromMs: opts.fromMs,
      toMs: opts.toMs,
    });
    items.push({
      ticker: inst.ticker,
      instrumentId: inst.instrument_id,
      providerId: inst.provider_id,
      providerCode: inst.provider_code,
      sourceKind: fetched.sourceKind,
      bars: fetched.bars,
      missingHistory: fetched.missingHistory,
    });
    const n = fetched.bars?.length || 0;
    const miss = fetched.missingHistory ? ` missing:${fetched.missingHistory.reason}` : "";
    console.log(`  · ${inst.ticker} fetched ${n}${miss}`);
  } catch (err) {
    items.push({
      ticker: inst.ticker,
      instrumentId: inst.instrument_id,
      providerId: inst.provider_id,
      providerCode: inst.provider_code,
      failure: err.message || String(err),
    });
    console.log(`  ✗ ${inst.ticker} ${err.message || err}`);
  }
}

try {
  const report = await persistHistoricalRun({
    range: opts.range,
    fromDate: opts.fromDate,
    toDate: opts.toDate,
    priceSource: opts.providerCode,
    items,
    rangeTruncated: opts.range !== "max" || Boolean(opts.fromDate || opts.toDate),
  });
  console.log(
    JSON.stringify(
      {
        snapshotId: report.snapshotId,
        instrumentsProcessed: report.instrumentsProcessed,
        barsFetched: report.barsFetched,
        barsInserted: report.barsInserted,
        barsSkipped: report.barsSkipped,
        failures: report.failures,
        missingHistory: report.missingHistory,
      },
      null,
      2
    )
  );
} finally {
  await closePool();
}
