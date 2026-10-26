/**
 * Walk-forward backtest of the live analysis (src/lib/indicators.js) on stored history.
 *
 * Each session D: rebuild the quotes the app would have seen (last WINDOW daily bars up to D),
 * run analyzeUniverse(), then measure what happened next. Orders fill at the NEXT session's
 * close (EGX settlement skips one session; Mubasher's CSV "open" is the previous close, so it
 * cannot be used as a fill price).
 *
 * Usage: npm run backtest -- [--from 2020-01-02] [--to 2026-10-25] [--fee 0.25] [--symbols COMI,TMGH]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig, OUTPUT_DIR } from "../src/config.js";
import { closePool, getPool, isDbConfigured } from "../src/lib/db/pool.js";
import { analyzeUniverse } from "../src/lib/indicators.js";

// ≈ RANGE=1y, what the live scrape feeds the analysis (--window 63 replays the old 3mo setup)
const WINDOW = Number(argValue(process.argv.slice(2), "--window") || 250);
const HORIZONS = [1, 5, 20];
const PLAN_HORIZON = { trade: 10, week: 5, scalp: 2 };
// EGX daily price limits are well under this; a bigger one-day move is a split/bonus artefact.
const EVENT_MOVE = 0.25;

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

const argv = process.argv.slice(2);
const FROM = argValue(argv, "--from") || "2020-01-02";
// Load earlier bars so the first evaluated session already has a full WINDOW of history.
const LOAD_FROM = new Date(Date.parse(`${FROM}T00:00:00Z`) - Math.ceil(WINDOW * 1.6) * 86400000)
  .toISOString()
  .slice(0, 10);
const TO = argValue(argv, "--to") || null;
const FEE_PCT = Number(argValue(argv, "--fee") ?? 0.25); // per side, % of value
const universe = getConfig().symbols;
const tickers = parseCsvList(argValue(argv, "--symbols")) || universe.map((s) => s.ticker);
const names = new Map(universe.map((s) => [s.ticker, s]));

async function loadBars() {
  // One row per instrument/session: the first raw CSV observation (later ones are re-scrapes).
  const { rows } = await getPool().query(
    `SELECT DISTINCT ON (i.display_ticker, b.session_date)
            i.display_ticker AS ticker, b.session_date::text AS d,
            b.open::float8 AS o, b.high::float8 AS h, b.low::float8 AS l,
            b.close::float8 AS c, b.volume::float8 AS v
       FROM ohlcv_bar_raw b
       JOIN instrument i ON i.id = b.instrument_id
      WHERE b.source_kind = 'csv'
        AND i.display_ticker = ANY($1)
        AND b.session_date >= $2::date
        AND ($3::date IS NULL OR b.session_date <= $3::date)
        AND b.close > 0
      ORDER BY i.display_ticker, b.session_date, b.observation_seq`,
    [tickers, LOAD_FROM, TO]
  );
  const byTicker = new Map();
  for (const r of rows) {
    if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []);
    // Keep high/low consistent with the close (rounding noise in the CSV).
    const h = Math.max(r.h ?? r.c, r.c);
    const l = Math.min(r.l ?? r.c, r.c);
    byTicker.get(r.ticker).push({ d: r.d, t: Date.parse(`${r.d}T00:00:00Z`), o: r.o, h, l, c: r.c, v: r.v });
  }
  return byTicker;
}

/** Index of bars whose move from the previous close looks like a corporate action. */
function eventIndexes(bars) {
  const out = [];
  for (let i = 1; i < bars.length; i++) {
    if (Math.abs(bars[i].c / bars[i - 1].c - 1) > EVENT_MOVE) out.push(i);
  }
  return out;
}

/** True when [from, to] (bar indexes) contains an event bar. */
function touchesEvent(events, from, to) {
  return events.some((e) => e >= from && e <= to);
}

function buildQuote(ticker, bars, i) {
  const candles = bars.slice(Math.max(0, i - WINDOW + 1), i + 1);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const meta = names.get(ticker) || {};
  return {
    ticker,
    name: meta.nameAr || ticker,
    nameAr: meta.nameAr,
    nameEn: meta.nameEn,
    price: last.c,
    previousClose: prev?.c ?? null,
    change: prev ? last.c - prev.c : null,
    changePercent: prev ? ((last.c - prev.c) / prev.c) * 100 : null,
    currency: "EGP",
    candles: candles.map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v })),
  };
}

/** Follow a long plan from the entry bar: stop first if both levels trade the same day. */
function simulatePlan(bars, entryIdx, stop, target, horizon) {
  const entry = bars[entryIdx].c;
  if (!(stop < entry && target > entry)) return null;
  const last = Math.min(bars.length - 1, entryIdx + horizon);
  if (last <= entryIdx) return null;
  for (let j = entryIdx + 1; j <= last; j++) {
    if (bars[j].l <= stop) return { exit: stop, outcome: "stop", days: j - entryIdx };
    if (bars[j].h >= target) return { exit: target, outcome: "target", days: j - entryIdx };
  }
  return { exit: bars[last].c, outcome: "time", days: last - entryIdx };
}

function stats(values) {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return { n: 0 };
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sorted = [...v].sort((a, b) => a - b);
  return {
    n: v.length,
    meanPct: +(mean * 100).toFixed(3),
    medianPct: +(sorted[Math.floor(sorted.length / 2)] * 100).toFixed(3),
    hitRate: +((v.filter((x) => x > 0).length / v.length) * 100).toFixed(1),
  };
}

function bucket(map, key) {
  if (!map.has(key)) map.set(key, Object.fromEntries(HORIZONS.map((h) => [h, []])));
  return map.get(key);
}

function scoreBucket(score) {
  if (score < 35) return "a  <35";
  if (score < 50) return "b 35–49";
  if (score < 60) return "c 50–59";
  if (score < 70) return "d 60–69";
  return "e 70+";
}

if (!isDbConfigured()) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const byTicker = await loadBars();
await closePool();

const series = new Map();
for (const [ticker, bars] of byTicker) {
  if (bars.length < WINDOW + 2) continue;
  series.set(ticker, {
    bars,
    events: eventIndexes(bars),
    idx: new Map(bars.map((b, i) => [b.d, i])),
  });
}

const dates = [...new Set([...series.values()].flatMap((s) => s.bars.map((b) => b.d)))]
  .filter((d) => d >= FROM)
  .sort();
console.log(
  `Backtest — ${series.size} tickers · ${dates[0]} → ${dates.at(-1)} · ${dates.length} sessions · fee ${FEE_PCT}%/side`
);

const fee = (FEE_PCT / 100) * 2;
const byAction = new Map();
const byScore = new Map();
const bySignal = new Map();
const baseline = bucket(new Map(), "all");
const topPicks = Object.fromEntries(HORIZONS.map((h) => [h, []]));
const plans = { trade: [], week: [], scalp: [] };
let skippedEvent = 0;
let analysed = 0;

for (const d of dates) {
  const quotes = [];
  const where = new Map();
  for (const [ticker, s] of series) {
    const i = s.idx.get(d);
    if (i == null || i < WINDOW - 1) continue;
    // Indicators on a window that spans a split/bonus artefact are meaningless.
    if (touchesEvent(s.events, i - WINDOW + 2, i)) {
      skippedEvent++;
      continue;
    }
    quotes.push(buildQuote(ticker, s.bars, i));
    where.set(ticker, i);
  }
  if (quotes.length < 5) continue;

  const analyses = analyzeUniverse(quotes);
  const dayTop = [...analyses].sort((a, b) => b.score - a.score).slice(0, 5).map((a) => a.ticker);

  for (const a of analyses) {
    const s = series.get(a.ticker);
    const i = where.get(a.ticker);
    const entryIdx = i + 1; // next session
    if (entryIdx >= s.bars.length) continue;
    analysed++;
    const entry = s.bars[entryIdx].c;

    for (const h of HORIZONS) {
      const exitIdx = entryIdx + h;
      if (exitIdx >= s.bars.length || touchesEvent(s.events, entryIdx + 1, exitIdx)) continue;
      const r = s.bars[exitIdx].c / entry - 1;
      baseline[h].push(r);
      bucket(byAction, a.actionHint)[h].push(r);
      bucket(byScore, scoreBucket(a.score))[h].push(r);
      for (const sig of a.signals) bucket(bySignal, sig)[h].push(r);
      if (dayTop.includes(a.ticker)) topPicks[h].push(r);
    }

    const tryPlan = (kind, stop, target) => {
      const horizon = PLAN_HORIZON[kind];
      if (touchesEvent(s.events, entryIdx + 1, entryIdx + horizon)) return;
      const res = simulatePlan(s.bars, entryIdx, stop, target, horizon);
      if (res) plans[kind].push({ ...res, ret: res.exit / entry - 1 - fee });
    };
    if (a.actionHint === "buy") tryPlan("trade", a.trade.stopLoss, a.trade.target1);
    if (a.week?.eligible) tryPlan("week", a.week.stop, a.week.sell);
    if (a.scalp?.eligible) tryPlan("scalp", a.scalp.stop, a.scalp.sell);
  }
}

function table(map) {
  return Object.fromEntries(
    [...map.entries()]
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([k, hs]) => [k, Object.fromEntries(HORIZONS.map((h) => [`${h}d`, stats(hs[h])]))])
  );
}

function planSummary(list) {
  const out = stats(list.map((p) => p.ret));
  const count = (o) => list.filter((p) => p.outcome === o).length;
  return {
    ...out,
    targetHits: count("target"),
    stopHits: count("stop"),
    timeExits: count("time"),
    avgDays: list.length ? +(list.reduce((s, p) => s + p.days, 0) / list.length).toFixed(1) : null,
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  params: { from: dates[0], to: dates.at(-1), window: WINDOW, feePctPerSide: FEE_PCT, eventMove: EVENT_MOVE },
  coverage: { tickers: series.size, sessions: dates.length, stockDays: analysed, skippedEvent },
  note: "Forward returns are next-session close → close after N sessions, before fees. Plan returns are after round-trip fees.",
  baseline: Object.fromEntries(HORIZONS.map((h) => [`${h}d`, stats(baseline[h])])),
  top5ByScore: Object.fromEntries(HORIZONS.map((h) => [`${h}d`, stats(topPicks[h])])),
  byAction: table(byAction),
  byScore: table(byScore),
  bySignal: table(bySignal),
  plans: Object.fromEntries(Object.entries(plans).map(([k, v]) => [k, { horizon: PLAN_HORIZON[k], ...planSummary(v) }])),
};

const outDir = path.join(OUTPUT_DIR, "backtest");
await fs.mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, "backtest-latest.json");
await fs.writeFile(outPath, JSON.stringify(report, null, 2));

// ── Console summary ──
const fmt = (s) => (s?.n ? `${String(s.meanPct).padStart(7)}%  hit ${String(s.hitRate).padStart(5)}%  n=${s.n}` : "—");
const vsBase = (s, h) => (s?.n ? `${(s.meanPct - report.baseline[h].meanPct >= 0 ? "+" : "")}${(s.meanPct - report.baseline[h].meanPct).toFixed(3)}` : "");
function printTable(title, rows) {
  console.log(`\n${title}  (mean 5d return · hit rate · vs all-stocks baseline · 20d mean)`);
  for (const [k, v] of Object.entries(rows)) {
    console.log(`  ${k.padEnd(20)} ${fmt(v["5d"])}  Δ ${vsBase(v["5d"], "5d").padStart(7)}   20d ${v["20d"]?.n ? `${v["20d"].meanPct}%` : "—"}`);
  }
}
printTable("Baseline + top 5 by score", { "all stock-days": report.baseline, "top 5 / day": report.top5ByScore });
printTable("By actionHint", report.byAction);
printTable("By score bucket", report.byScore);
printTable("By signal", report.bySignal);
console.log("\nTrade plans (next-session entry, stop checked before target, after fees)");
for (const [k, p] of Object.entries(report.plans)) {
  console.log(
    `  ${k.padEnd(6)} ≤${p.horizon}d  n=${p.n}  mean ${p.meanPct ?? "—"}%  win ${p.hitRate ?? "—"}%  target ${p.targetHits} · stop ${p.stopHits} · time ${p.timeExits} · avg ${p.avgDays}d`
  );
}
console.log(`\nSaved ${path.relative(process.cwd(), outPath)}`);
