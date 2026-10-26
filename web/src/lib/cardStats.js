/** Lightweight per-card stats from daily candles (same definitions as src/lib/indicators.js). */

function emaLast(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
  return ema;
}

function rsiLast(closes, period = 14) {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

export function cardStats(quote) {
  const candles = (quote?.candles || []).filter((c) => c && c.c != null);
  const closes = candles.map((c) => c.c);
  const last = candles[candles.length - 1] || null;
  const price = quote?.price ?? last?.c ?? null;

  const ema20 = emaLast(closes, 20);
  const ema50 = emaLast(closes, 50);
  const trend =
    ema20 == null || ema50 == null || price == null
      ? null
      : price > ema20 && ema20 > ema50
        ? "up"
        : price < ema20 && ema20 < ema50
          ? "down"
          : "sideways";

  const vols = candles.map((c) => c.v || 0);
  const prior = vols.slice(-21, -1).filter((v) => v > 0);
  const avgVol = prior.length ? prior.reduce((s, v) => s + v, 0) / prior.length : null;
  const volume = last?.v ?? null;

  const first = closes[0];
  const periodChangePct = first && price != null ? ((price - first) / first) * 100 : null;

  const lows = candles.map((c) => c.l ?? c.c);
  const highs = candles.map((c) => c.h ?? c.c);

  return {
    closes,
    trend,
    rsi: rsiLast(closes),
    volume,
    volRatio: avgVol && volume ? volume / avgVol : null,
    periodChangePct,
    dayLow: last?.l ?? null,
    dayHigh: last?.h ?? null,
    periodLow: lows.length ? Math.min(...lows) : null,
    periodHigh: highs.length ? Math.max(...highs) : null,
  };
}

/** SVG path data for a sparkline in a 100×32 box. */
export function sparkPaths(values, w = 100, h = 32, pad = 2) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    pad + (1 - (v - min) / span) * (h - pad * 2),
  ]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("");
  return { line, area: `${line}L${w},${h}L0,${h}Z` };
}
