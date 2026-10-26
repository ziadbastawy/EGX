/**
 * Cash-flow model: probability that a stock gets an "inflow day" in the next session.
 *
 * Inflow day = traded value ≥ 2× its prior 20-day average, close in the top 40% of the
 * day's range, and price up. Features use only data known at that session's close, and are
 * computed the same way for training (DB history) and live ranking (latest.json candles).
 */
import { inferSector } from "./companyContext.js";

export const INFLOW_VALUE_X = 2;
export const INFLOW_CLV = 0.6;
const EVENT_MOVE = 0.25; // split/bonus artefacts
const MIN_BARS = 25;

export const FEATURES = [
  "inflowToday",
  "inflows3",
  "inflows5",
  "logValueX",
  "logValueX3",
  "clv",
  "ret1",
  "ret5",
  "ret20",
  "rsi",
  "fromHigh20",
  "atrPct",
  "daysSinceInflow",
  "logValue20",
  "peerInflowShare",
  "peerRet1",
  "peerLogValueX",
  "mktRet1",
  "mktBreadth",
  "mktInflowShare",
  "mktLogValueX",
  "dowSun",
  "dowMon",
  "dowTue",
  "dowWed",
];

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const clvOf = (b) => (b.h > b.l ? (b.c - b.l) / (b.h - b.l) : 0.5);

function rsiAt(bars, i, period = 14) {
  if (i < period) return 50;
  let gain = 0;
  let loss = 0;
  for (let k = i - period + 1; k <= i; k++) {
    const d = bars[k].c - bars[k - 1].c;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

/** Per-bar stock-only features for one ticker. bars: [{d, h, l, c, v}] sorted by date. */
function stockFeatures(bars) {
  const value = bars.map((b) => (b.v || 0) * b.c);
  const out = new Array(bars.length).fill(null);
  let lastInflow = -Infinity;
  const inflow = new Array(bars.length).fill(false);
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const ret1 = b.c / bars[i - 1].c - 1;
    const avg20 = i >= 20 ? mean(value.slice(i - 20, i)) : null;
    const valueX = avg20 ? value[i] / avg20 : null;
    const clv = clvOf(b);
    inflow[i] = valueX != null && valueX >= INFLOW_VALUE_X && clv >= INFLOW_CLV && ret1 > 0;
    if (i < MIN_BARS) continue;

    const valueX3 = mean(
      [0, 1, 2].map((k) => {
        const a = mean(value.slice(i - k - 20, i - k));
        return a ? value[i - k] / a : 1;
      })
    );
    const high20 = Math.max(...bars.slice(i - 19, i + 1).map((x) => x.h));
    const trs = [];
    for (let k = i - 13; k <= i; k++) {
      const p = bars[k - 1].c;
      trs.push(Math.max(bars[k].h - bars[k].l, Math.abs(bars[k].h - p), Math.abs(bars[k].l - p)));
    }
    if (inflow[i]) lastInflow = i;
    else if (lastInflow === -Infinity) {
      for (let k = i - 1; k >= 1; k--) if (inflow[k]) { lastInflow = k; break; }
    }
    out[i] = {
      inflow: inflow[i],
      event: Math.abs(ret1) > EVENT_MOVE,
      inflowToday: inflow[i] ? 1 : 0,
      inflows3: inflow.slice(i - 2, i + 1).filter(Boolean).length,
      inflows5: inflow.slice(i - 4, i + 1).filter(Boolean).length,
      logValueX: Math.log(Math.max(valueX ?? 1, 0.05)),
      logValueX3: Math.log(Math.max(valueX3 ?? 1, 0.05)),
      clv,
      ret1,
      ret5: b.c / bars[i - 5].c - 1,
      ret20: b.c / bars[i - 20].c - 1,
      rsi: rsiAt(bars, i) / 100,
      fromHigh20: b.c / high20 - 1,
      atrPct: mean(trs) / b.c,
      daysSinceInflow: Math.min(20, lastInflow === -Infinity ? 20 : i - lastInflow) / 20,
      logValue20: Math.log10(Math.max(avg20 || 1, 1)),
    };
  }
  return out;
}

function dowFlags(d) {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay(); // EGX trades Sun–Thu
  return { dowSun: day === 0 ? 1 : 0, dowMon: day === 1 ? 1 : 0, dowTue: day === 2 ? 1 : 0, dowWed: day === 3 ? 1 : 0 };
}

/**
 * Build feature rows for every (ticker, session) plus the next-session label when known.
 * series: Map<ticker, bars[]>. Returns [{ticker, d, x: {...}, y: 0|1|null}].
 */
export function buildFlowRows(series) {
  const perTicker = new Map();
  const sector = new Map();
  for (const [ticker, bars] of series) {
    if (bars.length < MIN_BARS + 1) continue;
    perTicker.set(ticker, { bars, f: stockFeatures(bars), idx: new Map(bars.map((b, i) => [b.d, i])) });
    sector.set(ticker, inferSector({ ticker }).id);
  }
  const dates = [...new Set([...perTicker.values()].flatMap((s) => s.bars.map((b) => b.d)))].sort();

  const rows = [];
  for (const d of dates) {
    const today = [];
    for (const [ticker, s] of perTicker) {
      const i = s.idx.get(d);
      const f = i != null ? s.f[i] : null;
      if (f) today.push({ ticker, s, i, f });
    }
    if (today.length < 5) continue;
    const mkt = {
      mktRet1: mean(today.map((t) => t.f.ret1)),
      mktBreadth: today.filter((t) => t.f.ret1 > 0).length / today.length,
      mktInflowShare: today.filter((t) => t.f.inflow).length / today.length,
      mktLogValueX: mean(today.map((t) => t.f.logValueX)),
    };
    const dow = dowFlags(d);
    for (const t of today) {
      if (t.f.event) continue;
      const peers = today.filter((p) => p.ticker !== t.ticker && sector.get(p.ticker) === sector.get(t.ticker));
      const next = t.s.f[t.i + 1];
      const x = {
        ...pick(t.f),
        peerInflowShare: peers.length ? peers.filter((p) => p.f.inflow).length / peers.length : 0,
        peerRet1: peers.length ? mean(peers.map((p) => p.f.ret1)) : 0,
        peerLogValueX: peers.length ? mean(peers.map((p) => p.f.logValueX)) : 0,
        ...mkt,
        ...dow,
      };
      const y = next && !next.event ? (next.inflow ? 1 : 0) : null;
      rows.push({ ticker: t.ticker, d, x, y });
    }
  }
  return rows;
}

function pick(f) {
  const out = {};
  for (const k of FEATURES) if (k in f) out[k] = f[k];
  return out;
}

export function toVector(x) {
  return FEATURES.map((k) => x[k] ?? 0);
}

/** L2-regularised logistic regression, full-batch Adam on standardised features. */
export function trainLogistic(X, y, { epochs = 400, lr = 0.05, l2 = 1e-3 } = {}) {
  const n = X.length;
  const m = X[0].length;
  const mu = new Array(m).fill(0);
  const sd = new Array(m).fill(0);
  for (const r of X) r.forEach((v, j) => (mu[j] += v / n));
  for (const r of X) r.forEach((v, j) => (sd[j] += (v - mu[j]) ** 2 / n));
  for (let j = 0; j < m; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j]));

  const w = new Array(m).fill(0);
  let b = Math.log(mean(y) / (1 - mean(y)));
  const mw = new Array(m).fill(0);
  const vw = new Array(m).fill(0);
  let mb = 0;
  let vb = 0;
  const b1 = 0.9;
  const b2 = 0.999;
  for (let e = 1; e <= epochs; e++) {
    const gw = new Array(m).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let s = b;
      for (let j = 0; j < m; j++) s += w[j] * Z[i][j];
      const err = 1 / (1 + Math.exp(-s)) - y[i];
      gb += err / n;
      for (let j = 0; j < m; j++) gw[j] += (err * Z[i][j]) / n;
    }
    for (let j = 0; j < m; j++) {
      gw[j] += l2 * w[j];
      mw[j] = b1 * mw[j] + (1 - b1) * gw[j];
      vw[j] = b2 * vw[j] + (1 - b2) * gw[j] ** 2;
      w[j] -= (lr * (mw[j] / (1 - b1 ** e))) / (Math.sqrt(vw[j] / (1 - b2 ** e)) + 1e-8);
    }
    mb = b1 * mb + (1 - b1) * gb;
    vb = b2 * vb + (1 - b2) * gb ** 2;
    b -= (lr * (mb / (1 - b1 ** e))) / (Math.sqrt(vb / (1 - b2 ** e)) + 1e-8);
  }
  return { features: FEATURES, mean: mu, std: sd, weights: w, bias: b };
}

export function predictProba(model, x) {
  const v = toVector(x);
  let s = model.bias;
  for (let j = 0; j < v.length; j++) s += model.weights[j] * ((v[j] - model.mean[j]) / model.std[j]);
  return 1 / (1 + Math.exp(-s));
}

/** Live: quotes from latest.json (candles with t in ms) → rows for the latest session. */
export function latestFlowRows(quotes) {
  const series = new Map();
  for (const q of quotes || []) {
    const bars = (q.candles || [])
      .filter((c) => c && c.c > 0)
      .map((c) => ({
        // Candle t is Cairo midnight; toISOString() would give the previous UTC day.
        d: new Date(c.t).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }),
        h: Math.max(c.h ?? c.c, c.c),
        l: Math.min(c.l ?? c.c, c.c),
        c: c.c,
        v: c.v || 0,
      }));
    if (bars.length) series.set(q.ticker, bars);
  }
  const rows = buildFlowRows(series);
  const lastByTicker = new Map();
  for (const r of rows) {
    const prev = lastByTicker.get(r.ticker);
    if (!prev || r.d > prev.d) lastByTicker.set(r.ticker, r);
  }
  return [...lastByTicker.values()];
}
