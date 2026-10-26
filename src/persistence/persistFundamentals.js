import { getPool } from "../lib/db/pool.js";
import { persistValidation } from "./persistValidation.js";

const TYPED = {
  pe: "pe",
  eps: "eps",
  pb: "pb",
  bookValue: "book_value",
  marketCap: "market_cap",
  shares: "shares",
  capital: "capital",
  parValue: "par_value",
  currency: "currency",
};

export async function persistFundamentals({
  instrumentId = null,
  ticker = null,
  scrapedAt,
  sourceUrl = null,
  fundamentals = {},
  summary = null,
  extra = null,
  sourceProvider = "mubasher",
  periodType = null,
} = {}) {
  const pool = getPool();
  let resolvedInstrumentId = instrumentId;
  if (!resolvedInstrumentId && ticker) {
    const found = await pool.query(
      "SELECT id FROM instrument WHERE display_ticker = $1",
      [ticker]
    );
    resolvedInstrumentId = found.rows[0]?.id ?? null;
  }
  if (!resolvedInstrumentId) {
    await persistValidation({
      checkCode: "fundamental_name_unmatched",
      severity: "warn",
      passed: false,
      payload: { ticker },
    });
    return { row: null, unmatched: true };
  }

  const typed = {};
  const leftover = extra && typeof extra === "object" ? { ...extra } : {};
  for (const [srcKey, value] of Object.entries(fundamentals || {})) {
    if (TYPED[srcKey]) typed[TYPED[srcKey]] = value;
    else leftover[srcKey] = value;
  }

  const { rows } = await pool.query(
    `INSERT INTO fundamental_snapshot (
       instrument_id, scraped_at, source_url,
       pe, eps, pb, book_value, market_cap, shares, capital, par_value,
       currency, period_type, summary, extra, source_provider
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16)
     ON CONFLICT (instrument_id, scraped_at) DO UPDATE
       SET source_url = EXCLUDED.source_url,
           pe = EXCLUDED.pe,
           eps = EXCLUDED.eps,
           pb = EXCLUDED.pb,
           book_value = EXCLUDED.book_value,
           market_cap = EXCLUDED.market_cap,
           shares = EXCLUDED.shares,
           capital = EXCLUDED.capital,
           par_value = EXCLUDED.par_value,
           currency = EXCLUDED.currency,
           period_type = EXCLUDED.period_type,
           summary = EXCLUDED.summary,
           extra = EXCLUDED.extra,
           source_provider = EXCLUDED.source_provider
     RETURNING *`,
    [
      resolvedInstrumentId,
      scrapedAt,
      sourceUrl,
      typed.pe ?? fundamentals.pe ?? null,
      typed.eps ?? fundamentals.eps ?? null,
      typed.pb ?? fundamentals.pb ?? null,
      typed.book_value ?? fundamentals.bookValue ?? null,
      typed.market_cap ?? fundamentals.marketCap ?? null,
      typed.shares ?? fundamentals.shares ?? null,
      typed.capital ?? fundamentals.capital ?? null,
      typed.par_value ?? fundamentals.parValue ?? null,
      typed.currency ?? fundamentals.currency ?? null,
      periodType,
      summary == null ? null : JSON.stringify(summary),
      Object.keys(leftover).length ? JSON.stringify(leftover) : null,
      sourceProvider,
    ]
  );
  return { row: rows[0], unmatched: false };
}
