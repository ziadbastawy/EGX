import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../config.js";
import { runScrape } from "../scrape.js";

export const LATEST_PATH = path.join(ROOT, "web", "public", "latest.json");

/** Max age before a boot-time refresh is considered (default 24h). */
const STALE_MS = Number(process.env.MARKET_STALE_MS) || 24 * 60 * 60 * 1000;

let scrapePromise = null;
let lastError = null;

export function marketStatus() {
  return {
    scraping: Boolean(scrapePromise),
    lastError: lastError ? String(lastError.message || lastError) : null,
  };
}

export async function readLatestMeta() {
  try {
    const raw = await fs.readFile(LATEST_PATH, "utf8");
    const data = JSON.parse(raw);
    const count = Array.isArray(data.results) ? data.results.length : 0;
    const scrapedAt = data.scrapedAt || null;
    const ageMs = scrapedAt ? Date.now() - new Date(scrapedAt).getTime() : null;
    return {
      exists: true,
      count,
      scrapedAt,
      ageMs,
      stale: count === 0 || ageMs == null || ageMs > STALE_MS,
    };
  } catch {
    return { exists: false, count: 0, scrapedAt: null, ageMs: null, stale: true };
  }
}

/**
 * Start a scrape if none is running. Resolves with the scrape result.
 * Concurrent callers share the same promise.
 */
export function startScrape(reason = "manual") {
  if (scrapePromise) return scrapePromise;

  console.log(`[market] starting scrape (${reason})…`);
  lastError = null;
  scrapePromise = runScrape()
    .then((result) => {
      console.log(
        `[market] scrape done — ${result.payload?.results?.length ?? 0} quotes in ${result.ms}ms`
      );
      return result;
    })
    .catch((err) => {
      lastError = err;
      console.error("[market] scrape failed:", err?.message || err);
      throw err;
    })
    .finally(() => {
      scrapePromise = null;
    });

  return scrapePromise;
}

/**
 * Ensure latest.json exists (and optionally refresh if missing/empty).
 * Used on boot and when API handlers hit a missing file.
 */
export async function ensureMarketData({ refreshIfMissing = true } = {}) {
  const meta = await readLatestMeta();
  if (meta.exists && meta.count > 0) {
    return { ready: true, meta, scraping: Boolean(scrapePromise) };
  }

  if (!refreshIfMissing) {
    return { ready: false, meta, scraping: Boolean(scrapePromise) };
  }

  if (!scrapePromise) {
    startScrape(meta.exists ? "empty-latest" : "missing-latest").catch(() => {});
  }

  return { ready: false, meta, scraping: true };
}
