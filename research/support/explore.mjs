/**
 * Exploratory test: do EGX30 stocks show a "support buying" footprint on down days?
 *
 * We cannot see who buys — only daily OHLCV. The footprint we look for on a day the
 * EGX30 index falls: a stock beats the index, on heavy volume, closing near its high.
 * Without support, strong-buy and strong-sell footprints on down days should be roughly
 * symmetric; support would tilt them toward strong buys.
 *
 * Usage: node research/support/explore.mjs [--from 2020-01-02] [--down -1.0]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig, OUTPUT_DIR } from "../../src/config.js";
import { closePool, getPool } from "../../src/lib/db/pool.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function argValue(name, fallback) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
}

const FROM = argValue("--from", "2020-01-02");
const DOWN_DAY = Number(argValue("--down", -1.0)) / 100; // index close-to-close return
const EXCESS = 0.015; // stock return minus index return
const VOL_X = 1.5; // volume vs prior 20-day average
const CLV_HI = 0.6; // close location in the day's range (0 = low, 1 = high)
const CLV_LO = 0.4;
const EVENT_MOVE = 0.25; // split/bonus artefacts

async function loadIndex() {
  const meta = await (
    await fetch("https://www.mubasher.info/api/1/markets/EGX/indices/EGX30", {
      headers: { "User-Agent": UA, Accept: "application/json" },
    })
  ).json();
  const text = await (await fetch(meta.indexOverview.historicalDataUrl, { headers: { "User-Agent": UA } })).text();
  const out = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const [dt, , h, l, c] = line.split(",");
    const d = dt.slice(0, 10);
    out.set(d, { h: +h, l: +l, c: +c });
  }
  return out;
}

async function loadBars(tickers) {
  const { rows } = await getPool().query(
    `SELECT DISTINCT ON (i.display_ticker, b.session_date)
            i.display_ticker AS ticker, b.session_date::text AS d,
            b.high::float8 AS h, b.low::float8 AS l, b.close::float8 AS c, b.volume::float8 AS v
       FROM ohlcv_bar_raw b JOIN instrument i ON i.id = b.instrument_id
      WHERE b.source_kind = 'csv' AND i.display_ticker = ANY($1)
        AND b.session_date >= ($2::date - 60) AND b.close > 0
      ORDER BY i.display_ticker, b.session_date, b.observation_seq`,
    [tickers, FROM]
  );
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.ticker)) by.set(r.ticker, []);
    by.get(r.ticker).push({ ...r, h: Math.max(r.h ?? r.c, r.c), l: Math.min(r.l ?? r.c, r.c) });
  }
  return by;
}

const clv = (b) => (b.h > b.l ? (b.c - b.l) / (b.h - b.l) : 0.5);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const pct = (x, d = 2) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);

const tickers = getConfig().symbols.map((s) => s.ticker).filter((t) => t !== "VLMR.CA"); // USD line
const [index, byTicker] = await Promise.all([loadIndex(), loadBars(tickers)]);
await closePool();

const idxDates = [...index.keys()].sort();
const idxRet = new Map();
for (let i = 1; i < idxDates.length; i++) {
  const a = index.get(idxDates[i - 1]);
  const b = index.get(idxDates[i]);
  idxRet.set(idxDates[i], { ret: b.c / a.c - 1, clv: clv(b), lowRet: b.l / a.c - 1 });
}

// Per stock-day features
const rows = [];
for (const [ticker, bars] of byTicker) {
  for (let i = 21; i < bars.length; i++) {
    const b = bars[i];
    if (b.d < FROM) continue;
    const ix = idxRet.get(b.d);
    if (!ix) continue;
    const prev = bars[i - 1];
    const ret = b.c / prev.c - 1;
    if (Math.abs(ret) > EVENT_MOVE) continue;
    const avgVol = mean(bars.slice(i - 20, i).map((x) => x.v || 0));
    const fwd = (n) => (i + n < bars.length && Math.abs(bars[i + n].c / b.c - 1) < EVENT_MOVE ? bars[i + n].c / b.c - 1 : null);
    const fwdIdx = (n) => {
      const j = idxDates.indexOf(b.d);
      const e = idxDates[j + n];
      return e ? index.get(e).c / index.get(b.d).c - 1 : null;
    };
    const back = (n) => (i - n >= 0 ? b.c / bars[i - n].c - 1 : null);
    const low20 = Math.min(...bars.slice(i - 20, i).map((x) => x.l));
    rows.push({
      ticker,
      d: b.d,
      ret,
      idx: ix.ret,
      excess: ret - ix.ret,
      volX: avgVol ? (b.v || 0) / avgVol : null,
      clv: clv(b),
      value20: mean(bars.slice(i - 20, i).map((x) => (x.v || 0) * x.c)),
      back5: back(5),
      back10: back(10),
      distLow20: low20 ? b.c / low20 - 1 : null,
      fwd1: fwd(1),
      fwd5: fwd(5),
      fwdIdx5: fwdIdx(5),
    });
  }
}

const isBuy = (r) => r.excess >= EXCESS && r.volX >= VOL_X && r.clv >= CLV_HI;
const isSell = (r) => r.excess <= -EXCESS && r.volX >= VOL_X && r.clv <= CLV_LO;
const down = rows.filter((r) => r.idx <= DOWN_DAY);
const up = rows.filter((r) => r.idx >= -DOWN_DAY);
const flat = rows.filter((r) => r.idx > DOWN_DAY && r.idx < -DOWN_DAY);

function asym(list) {
  const b = list.filter(isBuy).length;
  const s = list.filter(isSell).length;
  return { n: list.length, buy: b, sell: s, buyRate: b / list.length, sellRate: s / list.length, ratio: s ? b / s : null };
}

const downDays = new Set(down.map((r) => r.d));
const report = {
  params: { from: FROM, downDayPct: DOWN_DAY * 100, excess: EXCESS, volX: VOL_X, clvHi: CLV_HI, clvLo: CLV_LO },
  coverage: { stockDays: rows.length, sessions: new Set(rows.map((r) => r.d)).size, downDays: downDays.size },
  asymmetry: { downDays: asym(down), flatDays: asym(flat), upDays: asym(up) },
};

// Which stocks show the buy footprint on down days (rate per down day traded)
const perTicker = new Map();
for (const r of down) {
  const t = perTicker.get(r.ticker) || { downDays: 0, buy: 0, sell: 0 };
  t.downDays++;
  if (isBuy(r)) t.buy++;
  if (isSell(r)) t.sell++;
  perTicker.set(r.ticker, t);
}
report.byTicker = [...perTicker.entries()]
  .map(([ticker, t]) => ({ ticker, ...t, buyRate: t.buy / t.downDays, sellRate: t.sell / t.downDays }))
  .sort((a, b) => b.buyRate - a.buyRate);

// What did chosen stocks look like before, vs the other stocks on the same down days?
const chosen = down.filter(isBuy);
const others = down.filter((r) => !isBuy(r));
const profile = (list) => ({
  n: list.length,
  back5: mean(list.map((r) => r.back5).filter((x) => x != null)),
  back10: mean(list.map((r) => r.back10).filter((x) => x != null)),
  distLow20: mean(list.map((r) => r.distLow20).filter((x) => x != null)),
  medianValue20: (() => {
    const v = list.map((r) => r.value20).filter((x) => x != null).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  })(),
});
// back5/back10 include the event day; compare the pre-event window instead
const preProfile = (list) => {
  const p = profile(list.map((r) => ({ ...r, back5: r.back5 != null ? (1 + r.back5) / (1 + r.ret) - 1 : null, back10: r.back10 != null ? (1 + r.back10) / (1 + r.ret) - 1 : null })));
  return p;
};
report.beforeEvent = { chosen: preProfile(chosen), others: preProfile(others) };

// What happened after (excess vs index over the next 5 sessions)
const after = (list) => ({
  n: list.length,
  fwd1: mean(list.map((r) => r.fwd1).filter((x) => x != null)),
  fwd5: mean(list.map((r) => r.fwd5).filter((x) => x != null)),
  fwd5Excess: mean(list.filter((r) => r.fwd5 != null && r.fwdIdx5 != null).map((r) => r.fwd5 - r.fwdIdx5)),
});
report.afterEvent = { chosen: after(chosen), others: after(others) };

// Repeat support: same ticker again within 10 sessions?
const sessions = [...new Set(rows.map((r) => r.d))].sort();
const pos = new Map(sessions.map((d, i) => [d, i]));
const byTickerChosen = new Map();
for (const r of chosen) {
  if (!byTickerChosen.has(r.ticker)) byTickerChosen.set(r.ticker, []);
  byTickerChosen.get(r.ticker).push(pos.get(r.d));
}
let repeats = 0;
for (const list of byTickerChosen.values()) {
  list.sort((a, b) => a - b);
  for (let i = 1; i < list.length; i++) if (list[i] - list[i - 1] <= 10) repeats++;
}
report.repeatWithin10 = { events: chosen.length, repeats, share: chosen.length ? repeats / chosen.length : null };

// Per down day: how many stocks were "supported"? (concentration)
const perDay = new Map();
for (const r of chosen) perDay.set(r.d, (perDay.get(r.d) || 0) + 1);
const counts = [...downDays].map((d) => perDay.get(d) || 0);
report.perDownDay = {
  withAny: counts.filter((c) => c > 0).length,
  mean: mean(counts),
  histogram: counts.reduce((h, c) => ((h[c] = (h[c] || 0) + 1), h), {}),
};

const outDir = path.join(OUTPUT_DIR, "research");
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, "support-explore.json"), JSON.stringify(report, null, 2));

// ── Summary ──
const a = report.asymmetry;
console.log(`Support footprint — ${report.coverage.stockDays} stock-days · ${report.coverage.sessions} sessions · ${report.coverage.downDays} index down days (≤ ${DOWN_DAY * 100}%)`);
console.log(`Footprint: excess ≥ ${EXCESS * 100}% vs index · volume ≥ ${VOL_X}× · close in top ${100 - CLV_HI * 100}% of range (mirror for sell)\n`);
for (const [k, v] of Object.entries(a)) {
  console.log(`  ${k.padEnd(9)} n=${String(v.n).padStart(6)}  strong-buy ${pct(v.buyRate)}  strong-sell ${pct(v.sellRate)}  buy/sell ${v.ratio?.toFixed(2)}`);
}
console.log("\nStrong-buy rate on index down days, by stock (top 10 / bottom 5):");
const fmtT = (t) => `  ${t.ticker.padEnd(9)} ${pct(t.buyRate, 1).padStart(6)}  (${t.buy}/${t.downDays})  sell ${pct(t.sellRate, 1)}`;
report.byTicker.slice(0, 10).forEach((t) => console.log(fmtT(t)));
console.log("  …");
report.byTicker.slice(-5).forEach((t) => console.log(fmtT(t)));
const b = report.beforeEvent;
console.log("\nBefore the event (chosen vs other stocks, same down days):");
console.log(`  prior 5d return   ${pct(b.chosen.back5)} vs ${pct(b.others.back5)}`);
console.log(`  prior 10d return  ${pct(b.chosen.back10)} vs ${pct(b.others.back10)}`);
console.log(`  above 20d low     ${pct(b.chosen.distLow20)} vs ${pct(b.others.distLow20)}`);
console.log(`  median value/day  ${(b.chosen.medianValue20 / 1e6).toFixed(1)}M vs ${(b.others.medianValue20 / 1e6).toFixed(1)}M EGP`);
const f = report.afterEvent;
console.log("\nAfter the event:");
console.log(`  next day          ${pct(f.chosen.fwd1)} vs ${pct(f.others.fwd1)}`);
console.log(`  next 5 days       ${pct(f.chosen.fwd5)} vs ${pct(f.others.fwd5)}  (excess vs index ${pct(f.chosen.fwd5Excess)} vs ${pct(f.others.fwd5Excess)})`);
console.log(`\nSame stock again within 10 sessions: ${report.repeatWithin10.repeats}/${report.repeatWithin10.events} (${pct(report.repeatWithin10.share, 0)})`);
console.log(`Down days with ≥1 footprint: ${report.perDownDay.withAny}/${report.coverage.downDays} · stocks per down day ${report.perDownDay.mean.toFixed(2)} · histogram ${JSON.stringify(report.perDownDay.histogram)}`);
