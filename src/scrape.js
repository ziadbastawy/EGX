import { getConfig } from "./config.js";
import { fetchQuote as fetchYahooQuote } from "./lib/yahoo.js";
import { fetchMubasherQuote } from "./lib/mubasherQuote.js";
import { saveResults } from "./lib/storage.js";
import { isMain, sleep } from "./lib/utils.js";

const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 8;
const BATCH_DELAY_MS = Number(process.env.BATCH_DELAY_MS) || 250;

async function mapSettledInBatches(items, batchSize, fn) {
  const settled = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const part = await Promise.allSettled(batch.map(fn));
    settled.push(...part);
    if (i + batchSize < items.length && BATCH_DELAY_MS > 0) {
      await sleep(BATCH_DELAY_MS);
    }
  }
  return settled;
}

async function fetchQuote(symbol, range, source) {
  if (source === "yahoo") return fetchYahooQuote(symbol, range);
  if (source === "mubasher") return fetchMubasherQuote(symbol, range);

  // default: mubasher first, yahoo fallback
  try {
    return await fetchMubasherQuote(symbol, range);
  } catch (err) {
    try {
      const q = await fetchYahooQuote(symbol, range);
      q.source = `${q.source || "yahoo"}-fallback`;
      return q;
    } catch {
      throw err;
    }
  }
}

export async function runScrape(options = {}) {
  const cfg = getConfig();
  const source = options.priceSource || cfg.priceSource || "mubasher";
  const watchIntervalSec = options.watchIntervalSec ?? cfg.intervalSec;
  const started = performance.now();

  console.log(
    `EGX scrape — ${cfg.symbols.length} symbols · range=${cfg.range} · source=${source} · batch=${BATCH_SIZE}`
  );

  const settled = await mapSettledInBatches(cfg.symbols, BATCH_SIZE, (symbol) =>
    fetchQuote(symbol, cfg.range, source)
  );

  const results = [];
  const errors = [];

  settled.forEach((item, i) => {
    const ticker = cfg.symbols[i].ticker;
    if (item.status === "fulfilled") {
      const quote = item.value;
      results.push(quote);
      const pct =
        quote.changePercent != null ? ` (${quote.changePercent.toFixed(2)}%)` : "";
      console.log(`  ✓ ${ticker} ${quote.price} ${quote.currency}${pct}`);
    } else {
      errors.push({ ticker, error: item.reason?.message || String(item.reason) });
      console.log(`  ✗ ${ticker} FAILED: ${item.reason?.message || item.reason}`);
    }
  });

  const payload = {
    scrapedAt: new Date().toISOString(),
    range: cfg.range,
    priceSource: source,
    watchIntervalSec: watchIntervalSec || null,
    results,
    errors,
  };

  const { latestPath, webLatestPath } = await saveResults(payload, {
    keepHistory: cfg.keepHistory,
  });

  const ms = Math.round(performance.now() - started);
  console.log(`\nSaved ${results.length} quotes in ${ms}ms → ${latestPath}`);
  console.log(`Vue data → ${webLatestPath}`);
  if (errors.length) console.log(`Failed: ${errors.length}`);

  return { payload, webLatestPath, errors, ms };
}

if (isMain(import.meta.url)) {
  runScrape()
    .then(({ payload, errors }) => {
      // Partial symbol failures are normal — only fail the process if nothing saved.
      if (!(payload?.results?.length)) {
        console.error("No quotes saved — treating scrape as failed.");
        process.exitCode = 1;
      } else if (errors.length) {
        console.warn(`Completed with ${errors.length} symbol error(s).`);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
