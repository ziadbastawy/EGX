import { round4 } from "./utils.js";

export function parseCsvNum(str) {
  if (str == null || str === "") return null;
  const m = String(str).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** RANGE token → start epoch ms. Compatible with fetchMubasherQuote rangeStartMs. */
export function rangeStartMs(range) {
  const now = Date.now();
  const day = 86400000;
  switch (String(range || "3mo")) {
    case "5d":
      return now - 5 * day;
    case "1mo":
      return now - 31 * day;
    case "3mo":
      return now - 93 * day;
    case "6mo":
      return now - 186 * day;
    case "1y":
      return now - 366 * day;
    case "2y":
      return now - 732 * day;
    case "5y":
      return now - 5 * 366 * day;
    case "ytd": {
      const d = new Date();
      return Date.UTC(d.getUTCFullYear(), 0, 1);
    }
    case "max":
      return 0;
    default:
      return now - 93 * day;
  }
}

export function isoDateStartMs(ymd) {
  if (!ymd) return null;
  const t = Date.parse(`${String(ymd).slice(0, 10)}T00:00:00+02:00`);
  return Number.isFinite(t) ? t : null;
}

/**
 * Parse Mubasher historical CSV. Overlay is not applied here.
 * @param {string} text
 * @param {string} [range]
 * @param {{ fromMs?: number|null, toMs?: number|null }} [bounds]
 */
export function parseCsvCandles(text, range, bounds = {}) {
  const start =
    bounds.fromMs != null && Number.isFinite(bounds.fromMs)
      ? bounds.fromMs
      : rangeStartMs(range);
  const end =
    bounds.toMs != null && Number.isFinite(bounds.toMs) ? bounds.toMs : Infinity;
  const candles = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const parts = line.split(",");
    if (parts.length < 5) continue;
    const datePart = parts[0].split("/")[0];
    const t = Date.parse(`${datePart}T00:00:00+02:00`);
    if (!Number.isFinite(t) || t < start || t > end) continue;
    const o = parseCsvNum(parts[1]);
    const h = parseCsvNum(parts[2]);
    const l = parseCsvNum(parts[3]);
    const c = parseCsvNum(parts[4]);
    const v = parts[5] != null ? parseCsvNum(parts[5]) : null;
    if ([o, h, l, c].some((x) => x == null)) continue;
    candles.push({ t, o: round4(o), h: round4(h), l: round4(l), c: round4(c), v });
  }
  return candles;
}
