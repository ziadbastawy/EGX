import fs from "node:fs/promises";
import path from "node:path";
import { getConfig, OUTPUT_DIR, ROOT } from "./config.js";
import { fetchMubasherStock } from "./lib/mubasher.js";
import { isMain, sleep } from "./lib/utils.js";
import { isDbConfigured, closePool } from "./lib/db/pool.js";
import { persistFundamentalsRun } from "./persistence/persistFundamentalsRun.js";

// Mubasher pages are heavy (~300 KB) — keep concurrency low and polite.
const BATCH_SIZE = Number(process.env.FUND_BATCH) || 6;
const BATCH_DELAY_MS = Number(process.env.FUND_DELAY) || 400;

const WEB_PUBLIC = path.join(ROOT, "web", "public");

/** Keep only fundamentals + session stats (drop news/announcements). */
function pickFundamentals(symbol, data) {
  return {
    ticker: symbol.ticker,
    code: data.code,
    nameAr: symbol.nameAr || symbol.ticker,
    nameEn: symbol.nameEn || symbol.ticker,
    url: data.url,
    fundamentals: data.fundamentals,
    summary: data.summary,
    scrapedAt: data.scrapedAt,
  };
}

async function saveJson(payload) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(WEB_PUBLIC, { recursive: true });
  const json = JSON.stringify(payload, null, 2);
  const outPath = path.join(OUTPUT_DIR, "fundamentals.json");
  const webPath = path.join(WEB_PUBLIC, "fundamentals.json");
  await fs.writeFile(outPath, json, "utf8");
  await fs.writeFile(webPath, json, "utf8");
  return { outPath, webPath };
}

export async function runScrapeFundamentals() {
  const cfg = getConfig();
  const symbols = cfg.symbols;
  const started = performance.now();

  console.log(
    `EGX fundamentals scrape — ${symbols.length} symbols · source=mubasher · batch=${BATCH_SIZE}`
  );

  const results = [];
  const errors = [];

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map((symbol) => fetchMubasherStock(symbol.ticker))
    );

    settled.forEach((item, j) => {
      const symbol = batch[j];
      if (item.status === "fulfilled") {
        const row = pickFundamentals(symbol, item.value);
        results.push(row);
        const pe = row.fundamentals?.pe ?? "—";
        const eps = row.fundamentals?.eps ?? "—";
        console.log(`  ✓ ${symbol.ticker}  P/E ${pe} · EPS ${eps}`);
      } else {
        const msg = item.reason?.message || String(item.reason);
        errors.push({ ticker: symbol.ticker, error: msg });
        console.log(`  ✗ ${symbol.ticker} FAILED: ${msg}`);
      }
    });

    if (i + BATCH_SIZE < symbols.length && BATCH_DELAY_MS > 0) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  const payload = {
    scrapedAt: new Date().toISOString(),
    source: "mubasher.info",
    count: results.length,
    results,
    errors,
  };

  const { outPath, webPath } = await saveJson(payload);

  const ms = Math.round(performance.now() - started);
  console.log(`\nSaved ${results.length} fundamentals in ${ms}ms → ${outPath}`);
  console.log(`Vue data → ${webPath}`);
  if (errors.length) console.log(`Failed: ${errors.length}`);

  if (isDbConfigured()) {
    try {
      const db = await persistFundamentalsRun(payload);
      console.log(
        `PostgreSQL persist → ${db.inserted} fundamental snapshots` +
          (db.unmatched ? ` · ${db.unmatched} unmatched` : "")
      );
    } catch (err) {
      console.warn(`PostgreSQL persist failed (JSON already saved): ${err.message}`);
    }
  }

  return { payload, outPath, webPath, errors, ms };
}

if (isMain(import.meta.url)) {
  runScrapeFundamentals()
    .then(({ errors }) => {
      if (errors.length) process.exitCode = 1;
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => closePool());
}
