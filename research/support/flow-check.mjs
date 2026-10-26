/**
 * Is "where cash goes next" predictable from daily data?
 *
 * Inflow day (stock, D): traded value ≥ 2× its prior 20-day average, close in the top 40%
 * of the day's range, and price up. We check simple conditional rates against the base rate.
 *
 * Usage: node research/support/flow-check.mjs [--from 2020-01-02]
 */
import { getConfig } from "../../src/config.js";
import { closePool, getPool } from "../../src/lib/db/pool.js";
import { inferSector } from "../../src/lib/companyContext.js";

const FROM = (() => {
  const i = process.argv.indexOf("--from");
  return i === -1 ? "2020-01-02" : process.argv[i + 1];
})();
const VALUE_X = 2;
const CLV_MIN = 0.6;
const EVENT_MOVE = 0.25;

const symbols = getConfig().symbols.filter((s) => s.ticker !== "VLMR.CA"); // USD line
const sectorOf = new Map(symbols.map((s) => [s.ticker, inferSector(s).id]));

const { rows } = await getPool().query(
  `SELECT DISTINCT ON (i.display_ticker, b.session_date)
          i.display_ticker AS ticker, b.session_date::text AS d,
          b.high::float8 AS h, b.low::float8 AS l, b.close::float8 AS c, b.volume::float8 AS v
     FROM ohlcv_bar_raw b JOIN instrument i ON i.id = b.instrument_id
    WHERE b.source_kind = 'csv' AND i.display_ticker = ANY($1)
      AND b.session_date >= ($2::date - 60) AND b.close > 0
    ORDER BY i.display_ticker, b.session_date, b.observation_seq`,
  [symbols.map((s) => s.ticker), FROM]
);
await closePool();

const byTicker = new Map();
for (const r of rows) {
  if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []);
  byTicker.get(r.ticker).push({ ...r, h: Math.max(r.h ?? r.c, r.c), l: Math.min(r.l ?? r.c, r.c) });
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// day → ticker → features
const days = new Map();
for (const [ticker, bars] of byTicker) {
  for (let i = 21; i < bars.length; i++) {
    const b = bars[i];
    const ret = b.c / bars[i - 1].c - 1;
    if (Math.abs(ret) > EVENT_MOVE) continue;
    const value = (b.v || 0) * b.c;
    const avg = mean(bars.slice(i - 20, i).map((x) => (x.v || 0) * x.c));
    const valueX = avg ? value / avg : null;
    const clv = b.h > b.l ? (b.c - b.l) / (b.h - b.l) : 0.5;
    // Quiet build-up: value rising 3 sessions in a row while price moved < 2% over them
    const v3 = bars.slice(i - 3, i + 1).map((x) => (x.v || 0) * x.c);
    const rising = v3.every((x, k) => k === 0 || x > v3[k - 1]);
    const flat = Math.abs(b.c / bars[i - 3].c - 1) < 0.02;
    if (!days.has(b.d)) days.set(b.d, new Map());
    days.get(b.d).set(ticker, {
      inflow: valueX != null && valueX >= VALUE_X && clv >= CLV_MIN && ret > 0,
      buildUp: rising && flat,
      valueX,
    });
  }
}

const dates = [...days.keys()].filter((d) => d >= FROM).sort();
const tally = () => ({ n: 0, hit: 0 });
const t = { base: tally(), afterOwn: tally(), afterPeer: tally(), afterPeerNotOwn: tally(), afterBuildUp: tally(), afterOtherSector: tally() };
const add = (k, hit) => {
  t[k].n++;
  if (hit) t[k].hit++;
};

for (let k = 0; k < dates.length - 1; k++) {
  const today = days.get(dates[k]);
  const next = days.get(dates[k + 1]);
  const inflowSectors = new Map();
  for (const [ticker, f] of today) {
    if (!f.inflow) continue;
    const s = sectorOf.get(ticker);
    inflowSectors.set(s, (inflowSectors.get(s) || 0) + 1);
  }
  for (const [ticker, f] of today) {
    const tomorrow = next.get(ticker);
    if (!tomorrow) continue;
    const hit = tomorrow.inflow;
    const s = sectorOf.get(ticker);
    const peerInflow = (inflowSectors.get(s) || 0) - (f.inflow ? 1 : 0) > 0;
    const otherInflow = [...inflowSectors.entries()].some(([sec, n]) => sec !== s && n > 0);
    add("base", hit);
    if (f.inflow) add("afterOwn", hit);
    if (peerInflow) add("afterPeer", hit);
    if (peerInflow && !f.inflow) add("afterPeerNotOwn", hit);
    if (f.buildUp) add("afterBuildUp", hit);
    if (otherInflow && !peerInflow && !f.inflow) add("afterOtherSector", hit);
  }
}

const labels = {
  base: "any stock, any day (base rate)",
  afterOwn: "after its OWN inflow day (momentum)",
  afterPeer: "after a SAME-SECTOR peer's inflow (rotation)",
  afterPeerNotOwn: "  …peer had inflow, stock itself did not",
  afterOtherSector: "after inflows only in OTHER sectors",
  afterBuildUp: "after a quiet build-up (value ↑3 days, price flat)",
};
const base = t.base.hit / t.base.n;
console.log(`Inflow next session — ${dates.length} sessions from ${dates[0]} · ${symbols.length} stocks`);
console.log(`Inflow day = value ≥ ${VALUE_X}× 20d avg · close in top ${100 - CLV_MIN * 100}% of range · price up\n`);
for (const [k, v] of Object.entries(t)) {
  const rate = v.n ? v.hit / v.n : 0;
  console.log(`  ${labels[k].padEnd(52)} ${(rate * 100).toFixed(2).padStart(6)}%  ×${(rate / base).toFixed(2)}  n=${v.n}`);
}
const sectors = [...new Set(sectorOf.values())];
console.log(`\nSectors: ${sectors.length} → ${sectors.map((s) => `${s}(${[...sectorOf.values()].filter((x) => x === s).length})`).join(" ")}`);
