import { persistFundamentals } from "./persistFundamentals.js";

export async function persistFundamentalsRun(payload) {
  let inserted = 0;
  let unmatched = 0;
  for (const row of payload.results || []) {
    const result = await persistFundamentals({
      ticker: row.ticker,
      scrapedAt: row.scrapedAt || payload.scrapedAt,
      sourceUrl: row.url,
      fundamentals: row.fundamentals || {},
      summary: row.summary || null,
      sourceProvider: "mubasher",
    });
    if (result.unmatched) unmatched += 1;
    else inserted += 1;
  }
  return { inserted, unmatched };
}
