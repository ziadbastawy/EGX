import { closePool, isDbConfigured } from "../src/lib/db/pool.js";
import { auditHistoricalQuality } from "../src/persistence/auditHistoricalQuality.js";

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

if (!isDbConfigured()) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const tickers =
  parseCsvList(argValue(process.argv, "--symbols")) || parseCsvList(process.env.SYMBOLS);
const sourceKind = argValue(process.argv, "--source-kind") || process.env.SOURCE_KIND || null;

try {
  const report = await auditHistoricalQuality({ tickers, sourceKind });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await closePool();
}
