/** Volume-at-price ladder from daily candles. Not a live L2 order book. */

function roundTo(n, tick) {
  if (n == null || !Number.isFinite(n) || !tick) return null;
  return Math.round(n / tick) * tick;
}

function decimalsForTick(tick) {
  const s = Number(tick)
    .toFixed(8)
    .replace(/0+$/, "")
    .split(".")[1];
  return s ? s.length : 0;
}

export function egxTickSize(price) {
  const p = Number(price) || 0;
  if (p < 1) return 0.001;
  if (p < 10) return 0.01;
  if (p < 50) return 0.05;
  if (p < 100) return 0.1;
  return 0.25;
}

function fmtPrice(n, tick) {
  if (n == null || !Number.isFinite(n)) return null;
  const d = decimalsForTick(tick);
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

/**
 * Spread each candle's volume across its [low, high] range in tick steps.
 */
export function buildPriceDepth(quote, { levels = 10 } = {}) {
  const candles = (quote?.candles || []).filter(
    (c) => c && Number.isFinite(c.c) && Number.isFinite(c.v) && c.v > 0
  );
  const last = Number(quote?.price ?? candles.at(-1)?.c);
  if (!candles.length || !Number.isFinite(last)) {
    return {
      last: last ?? null,
      tick: null,
      poc: null,
      bids: [],
      asks: [],
      candleCount: 0,
      totalVolume: 0,
    };
  }

  const tick = egxTickSize(last);
  const lastTick = fmtPrice(roundTo(last, tick), tick);
  const buckets = new Map();
  let totalVolume = 0;

  for (const c of candles) {
    const lo = Number.isFinite(c.l) ? c.l : c.c;
    const hi = Number.isFinite(c.h) ? c.h : c.c;
    const low = Math.min(lo, hi);
    const high = Math.max(lo, hi);
    const start = roundTo(low, tick);
    const end = roundTo(high, tick);
    const steps = Math.max(1, Math.round((end - start) / tick) + 1);
    const share = c.v / steps;
    for (let i = 0; i < steps; i++) {
      const px = fmtPrice(start + i * tick, tick);
      buckets.set(px, (buckets.get(px) || 0) + share);
    }
    totalVolume += c.v;
  }

  let poc = last;
  let pocVol = 0;
  for (const [px, vol] of buckets) {
    if (vol > pocVol) {
      pocVol = vol;
      poc = px;
    }
  }

  const n = Math.max(4, Math.min(15, Number(levels) || 10));
  const asks = [];
  const bids = [];
  for (let i = 1; i <= n; i++) {
    const askPx = fmtPrice(lastTick + i * tick, tick);
    const bidPx = fmtPrice(lastTick - i * tick, tick);
    asks.push({ price: askPx, volume: buckets.get(askPx) || 0 });
    bids.push({ price: bidPx, volume: buckets.get(bidPx) || 0 });
  }

  const maxVol = Math.max(1, ...asks.map((r) => r.volume), ...bids.map((r) => r.volume));
  const decorate = (row) => ({
    ...row,
    share: totalVolume > 0 ? row.volume / totalVolume : 0,
    bar: row.volume / maxVol,
  });

  return {
    last,
    tick,
    poc: fmtPrice(poc, tick),
    pocVolume: pocVol,
    candleCount: candles.length,
    totalVolume,
    currency: quote.currency || "EGP",
    bids: bids.map(decorate),
    asks: asks.map(decorate),
    source: "volume-at-price",
  };
}

/** Compact features for scalp/week scoring. */
export function summarizeDepth(depth) {
  if (!depth?.bids?.length || !depth?.asks?.length) return null;
  const nearN = 3;
  const sum = (rows) => rows.reduce((s, r) => s + (r.volume || 0), 0);
  const bidNear = sum(depth.bids.slice(0, nearN));
  const askNear = sum(depth.asks.slice(0, nearN));
  const bidAll = sum(depth.bids);
  const askAll = sum(depth.asks);
  const near = bidNear + askNear;
  const ratio = askNear > 0 ? bidNear / askNear : bidNear > 0 ? 3 : 1;
  const ladderVol = bidAll + askAll;
  const thin = near <= 0 || (ladderVol > 0 && near / ladderVol < 0.06);
  const askWall = askNear > bidNear * 1.8 && askNear > 0;
  const bidCushion = bidNear > askNear * 1.25 && bidNear > 0;
  const last = depth.last;
  const poc = depth.poc;
  const pocDistPct =
    last && poc != null && last !== 0 ? ((poc - last) / last) * 100 : null;
  const wallAsk = (depth.asks || []).find((r) => r.volume > 0 && (r.bar || 0) >= 0.65);

  return {
    bidNear,
    askNear,
    bidAll,
    askAll,
    ratio: Math.round(ratio * 100) / 100,
    thin,
    askWall,
    bidCushion,
    poc,
    pocDistPct: pocDistPct != null ? Math.round(pocDistPct * 100) / 100 : null,
    wallAskPrice: wallAsk?.price ?? null,
  };
}
