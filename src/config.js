import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SYMBOLS } from "../data/symbols.js";
import { EGX30_TICKERS } from "../data/egx30.js";

const EGX30 = new Set(EGX30_TICKERS);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.join(__dirname, "..");
export const OUTPUT_DIR = path.join(ROOT, "output");

export function getConfig() {
  // 1y so EMA50/EMA200 and MACD are warmed up (3mo ≈ 63 bars never reached EMA200)
  const range = process.env.RANGE || "1y";
  const intervalSec = process.env.INTERVAL ? Number(process.env.INTERVAL) : null;
  const keepHistory = process.env.KEEP_HISTORY === "1";
  // mubasher (default) | yahoo | auto (mubasher then yahoo fallback)
  const priceSource = (process.env.PRICE_SOURCE || "mubasher").toLowerCase();

  // egx30 (default) | all — SYMBOLS overrides both
  const universe = (process.env.UNIVERSE || "egx30").toLowerCase();

  const symbols = process.env.SYMBOLS
    ? process.env.SYMBOLS.split(",").map((s) => {
        const raw = s.trim();
        const ticker = raw.includes(".") ? raw : `${raw}.CA`;
        return { ticker, nameAr: raw, nameEn: raw };
      })
    : universe === "all"
      ? DEFAULT_SYMBOLS
      : DEFAULT_SYMBOLS.filter((s) => EGX30.has(s.ticker));

  return { range, intervalSec, keepHistory, symbols, priceSource, universe };
}
