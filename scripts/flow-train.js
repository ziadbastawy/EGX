/**
 * Train and evaluate the cash-flow model (src/lib/flowModel.js) on stored daily history.
 *
 * Train on sessions before --split, test on sessions from --split on (never seen in training).
 * Writes the model + test metrics to data/flow-model.json for the API to use.
 *
 * Usage: npm run flow:train -- [--from 2020-01-02] [--split 2025-01-01]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig, ROOT } from "../src/config.js";
import { closePool, getPool, isDbConfigured } from "../src/lib/db/pool.js";
import { buildFlowRows, FEATURES, predictProba, toVector, trainLogistic } from "../src/lib/flowModel.js";

function argValue(name, fallback) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
}

const FROM = argValue("--from", "2020-01-02");
const SPLIT = argValue("--split", "2025-01-01");
const TOP_K = 3;

if (!isDbConfigured()) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const tickers = getConfig().symbols.map((s) => s.ticker).filter((t) => t !== "VLMR.CA"); // USD line
const { rows: raw } = await getPool().query(
  `SELECT DISTINCT ON (i.display_ticker, b.session_date)
          i.display_ticker AS ticker, b.session_date::text AS d,
          b.high::float8 AS h, b.low::float8 AS l, b.close::float8 AS c, b.volume::float8 AS v
     FROM ohlcv_bar_raw b JOIN instrument i ON i.id = b.instrument_id
    WHERE b.source_kind = 'csv' AND i.display_ticker = ANY($1)
      AND b.session_date >= ($2::date - 90) AND b.close > 0
    ORDER BY i.display_ticker, b.session_date, b.observation_seq`,
  [tickers, FROM]
);
await closePool();

const series = new Map();
for (const r of raw) {
  if (!series.has(r.ticker)) series.set(r.ticker, []);
  series.get(r.ticker).push({ d: r.d, h: Math.max(r.h ?? r.c, r.c), l: Math.min(r.l ?? r.c, r.c), c: r.c, v: r.v || 0 });
}

const all = buildFlowRows(series).filter((r) => r.d >= FROM && r.y != null);
const train = all.filter((r) => r.d < SPLIT);
const test = all.filter((r) => r.d >= SPLIT);
console.log(`Cash-flow model — ${series.size} stocks · train ${train.length} rows (${FROM} → ${SPLIT}) · test ${test.length} rows (${SPLIT} →)`);

const model = trainLogistic(
  train.map((r) => toVector(r.x)),
  train.map((r) => r.y)
);
for (const r of test) r.p = predictProba(model, r.x);

// ── Evaluation on the unseen test period ──
function auc(rows) {
  const s = [...rows].sort((a, b) => a.p - b.p);
  let rank = 0;
  let pos = 0;
  s.forEach((r, i) => {
    if (r.y) {
      rank += i + 1;
      pos++;
    }
  });
  const neg = s.length - pos;
  return (rank - (pos * (pos + 1)) / 2) / (pos * neg);
}

const byDay = new Map();
for (const r of test) {
  if (!byDay.has(r.d)) byDay.set(r.d, []);
  byDay.get(r.d).push(r);
}

function topK(score) {
  let hits = 0;
  let picks = 0;
  const hitDays = [];
  for (const list of byDay.values()) {
    const top = [...list].sort((a, b) => score(b) - score(a)).slice(0, TOP_K);
    const h = top.filter((r) => r.y).length;
    hits += h;
    picks += top.length;
    hitDays.push(h > 0 ? 1 : 0);
  }
  return { precision: hits / picks, dayAnyHit: hitDays.reduce((s, x) => s + x, 0) / hitDays.length };
}

const baseRate = test.filter((r) => r.y).length / test.length;
const results = {
  model: topK((r) => r.p),
  ruleYesterdayInflow: topK((r) => r.x.inflowToday * 10 + r.x.logValueX),
  ruleValueSpike: topK((r) => r.x.logValueX),
};

// Calibration: predicted vs actual by probability decile
const sorted = [...test].sort((a, b) => a.p - b.p);
const calibration = [];
for (let k = 0; k < 10; k++) {
  const slice = sorted.slice(Math.floor((k * sorted.length) / 10), Math.floor(((k + 1) * sorted.length) / 10));
  calibration.push({
    decile: k + 1,
    predicted: slice.reduce((s, r) => s + r.p, 0) / slice.length,
    actual: slice.filter((r) => r.y).length / slice.length,
  });
}

const weights = FEATURES.map((f, j) => ({ feature: f, weight: model.weights[j] })).sort(
  (a, b) => Math.abs(b.weight) - Math.abs(a.weight)
);

const out = {
  ...model,
  trainedAt: new Date().toISOString(),
  target: "next-session inflow day (value ≥ 2× 20d avg, close in top 40% of range, price up)",
  train: { from: FROM, to: SPLIT, rows: train.length },
  test: {
    from: SPLIT,
    to: test.at(-1)?.d,
    rows: test.length,
    sessions: byDay.size,
    baseRate,
    auc: auc(test),
    topK: TOP_K,
    ...Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v])),
    calibration,
  },
};
await fs.writeFile(path.join(ROOT, "data", "flow-model.json"), `${JSON.stringify(out, null, 2)}\n`);

const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log(`\nTest period ${SPLIT} → ${out.test.to} · ${byDay.size} sessions · base rate ${pct(baseRate)} · AUC ${out.test.auc.toFixed(3)}`);
console.log(`\nTop ${TOP_K} per day — share that got an inflow next session (and days with ≥1 hit):`);
console.log(`  model                     ${pct(results.model.precision).padStart(6)}  (${pct(results.model.dayAnyHit)} of days)`);
console.log(`  rule: had inflow today    ${pct(results.ruleYesterdayInflow.precision).padStart(6)}  (${pct(results.ruleYesterdayInflow.dayAnyHit)} of days)`);
console.log(`  rule: biggest value spike ${pct(results.ruleValueSpike.precision).padStart(6)}  (${pct(results.ruleValueSpike.dayAnyHit)} of days)`);
console.log(`  random pick               ${pct(baseRate).padStart(6)}`);
console.log("\nCalibration (predicted → actual, by decile):");
console.log(`  ${calibration.map((c) => `${pct(c.predicted)}→${pct(c.actual)}`).join("  ")}`);
console.log("\nWeights (standardised, largest first):");
for (const w of weights) console.log(`  ${w.feature.padEnd(16)} ${w.weight >= 0 ? "+" : ""}${w.weight.toFixed(3)}`);
console.log("\nSaved data/flow-model.json");
