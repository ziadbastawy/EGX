/**
 * Local/env-gated dual-write after latest.json is saved.
 * Raw bars come from pre-overlay CSV (or Yahoo chart candles), never from mutated quote.candles.
 */
import {
  persistSnapshot,
  persistRawBars,
  persistQuoteLive,
} from "./index.js";
import { sessionDateFromMs, sha256Hex } from "./integrity.js";

function cairoDay(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
}

function overlayPathFor(quote, rawBars) {
  const src = String(quote.source || "");
  if (src.includes("yahoo")) return "none";
  if (quote.price == null || !rawBars?.length) return "none";
  const last = rawBars.at(-1);
  const lastDay = last?.t != null ? sessionDateFromMs(last.t) : last?.sessionDate;
  const today = cairoDay();
  if (lastDay === today) return "replace_last";
  return "append_today";
}

function sourceKindFor(quote) {
  const src = String(quote.source || "");
  if (src.includes("yahoo")) return "yahoo_chart";
  return "csv";
}

function providerCodeFor(quote) {
  const src = String(quote.source || "");
  if (src.includes("yahoo")) return "yahoo";
  return "mubasher";
}

function quoteSourceFor(quote) {
  const src = String(quote.source || "mubasher");
  if (src.includes("yahoo")) return "yahoo";
  return "mubasher";
}

/**
 * @param {object} payload latest.json-shaped payload (already written)
 * @param {Map<string, object[]>} rawBarsByTicker ticker -> pre-overlay bars {t,o,h,l,c,v}
 */
export async function persistScrapeRun(payload, rawBarsByTicker) {
  const snapshot = await persistSnapshot({
    scrapedAt: payload.scrapedAt,
    range: payload.range,
    priceSource: payload.priceSource,
    watchIntervalSec: payload.watchIntervalSec,
    errors: payload.errors || [],
    hostingContext: "local",
    payloadHash: sha256Hex(JSON.stringify(payload)),
  });

  let bars = 0;
  let quotes = 0;
  for (const quote of payload.results || []) {
    const ticker = quote.ticker;
    const rawBars = rawBarsByTicker?.get(ticker) || [];
    const providerCode = providerCodeFor(quote);
    const sourceKind = sourceKindFor(quote);
    const overlayPath = overlayPathFor(quote, rawBars);
    const lastRaw = rawBars.at(-1);
    const csvLastClose = lastRaw?.c ?? lastRaw?.close ?? null;
    const csvLastSessionDate =
      lastRaw?.sessionDate ||
      (lastRaw?.t != null ? sessionDateFromMs(lastRaw.t) : null);

    const barResult = await persistRawBars({
      ticker,
      providerCode,
      snapshotId: snapshot.id,
      sourceKind,
      tzParseRule: "plus_02",
      bars: rawBars.map((b) => ({
        t: b.t,
        open: b.o ?? b.open,
        high: b.h ?? b.high,
        low: b.l ?? b.low,
        close: b.c ?? b.close,
        volume: b.v ?? b.volume,
        sourceTimestampRaw: b.t != null ? String(b.t) : null,
      })),
    });
    bars += barResult.inserted?.length || 0;

    await persistQuoteLive({
      ticker,
      snapshotId: snapshot.id,
      providerCode,
      lastPrice: quote.price,
      previousCloseVendor: quote.previousClose,
      currency: quote.currency,
      asOf: quote.asOf,
      quoteSource: quoteSourceFor(quote),
      cairoDayAtScrape: cairoDay(new Date(payload.scrapedAt || Date.now())),
      csvLastSessionDate,
      csvLastClose,
      overlayPath,
      vendorChange: quote.change,
      vendorChangePercentage: quote.changePercent,
    });
    quotes += 1;
  }

  return { snapshotId: snapshot.id, bars, quotes };
}
