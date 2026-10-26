import { round4 } from "./utils.js";
import { mubasherCode } from "./mubasher.js";
import { parseCsvCandles } from "./mubasherCsv.js";

const API = "https://www.mubasher.info/api/1/markets/EGX/stocks";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** In-memory daily candle cache so 20s watch doesn't re-download huge CSVs. */
const candleCache = new Map(); // code -> { scrapedDay, url, candles }
const CACHE_TTL_MS = Number(process.env.MUBASHER_CANDLE_TTL_MS) || 6 * 60 * 60 * 1000;

function parseNum(str) {
  if (str == null || str === "") return null;
  const m = String(str).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function dayKeyCairo(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }); // YYYY-MM-DD
}

async function fetchJson(code, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}/${encodeURIComponent(code)}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "Accept-Language": "ar,en;q=0.8",
      },
    });
    if (!res.ok) {
      throw Object.assign(new Error(`Mubasher HTTP ${res.status} for ${code}`), {
        status: res.status === 404 ? 404 : 502,
      });
    }
    return await res.json();
  } catch (err) {
    if (err?.status) throw err;
    const aborted = err?.name === "AbortError";
    throw Object.assign(
      new Error(aborted ? "Mubasher quote timed out" : `Mubasher quote failed: ${err.message}`),
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}

async function loadCandles(code, histUrl, range) {
  const today = dayKeyCairo();
  const cached = candleCache.get(code);
  if (
    cached &&
    cached.url === histUrl &&
    cached.scrapedDay === today &&
    Date.now() - cached.at < CACHE_TTL_MS &&
    cached.candles?.length
  ) {
    // Still filter by requested range from full cached set if we stored unfiltered —
    // we store range-filtered; refresh if range differs.
    if (cached.range === range) return cached.candles;
  }

  const res = await fetch(histUrl, {
    headers: { "User-Agent": UA, Accept: "text/csv,*/*" },
  });
  if (!res.ok) throw new Error(`Mubasher CSV HTTP ${res.status}`);
  const text = await res.text();
  const candles = parseCsvCandles(text, range);
  candleCache.set(code, { url: histUrl, scrapedDay: today, range, candles, at: Date.now() });
  return candles;
}

/**
 * Fetch EGX quote + daily candles from Mubasher (same shape as yahoo.fetchQuote).
 */
export async function fetchMubasherQuote(symbol, range = "3mo", { timeoutMs = 12000 } = {}) {
  const { ticker, nameAr, nameEn, name } = symbol;
  const code = mubasherCode(ticker);
  if (!code) throw new Error("Invalid ticker");

  const data = await fetchJson(code, timeoutMs);
  const bar = data?.companyTab?.priceBar;
  if (!bar) throw new Error(`No Mubasher priceBar for ${code}`);

  const histUrl = data?.stocks?.[0]?.historicalFileUrl;
  if (!histUrl) throw new Error(`No Mubasher historical CSV for ${code}`);

  let candles = await loadCandles(code, histUrl, range);
  // Pre-overlay CSV bars for DB dual-write only. Overlay below is unchanged.
  const rawCsvCandles = process.env.DATABASE_URL
    ? candles.map((c) => ({ ...c }))
    : null;

  const price = parseNum(bar.value);
  const open = parseNum(bar.open);
  const high = parseNum(bar.high);
  const low = parseNum(bar.low);
  const volume = parseNum(bar.volume);
  let previousClose = parseNum(bar.close); // Mubasher uses "close" as prev close on the live bar
  const change = parseNum(bar.change);
  let changePercent = parseNum(bar.changePercentage);

  // Ensure today's bar reflects live priceBar (CSV may lag slightly).
  if (price != null) {
    const today = dayKeyCairo();
    const todayMs = Date.parse(`${today}T00:00:00+02:00`);
    const last = candles.at(-1);
    const lastDay =
      last &&
      new Date(last.t).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
    const live = {
      t: Number.isFinite(todayMs) ? todayMs : Date.now(),
      o: round4(open ?? price),
      h: round4(high ?? price),
      l: round4(low ?? price),
      c: round4(price),
      v: volume,
    };
    if (lastDay === today) candles = [...candles.slice(0, -1), live];
    else candles = [...candles, live];
  }

  if (!candles.length) throw new Error(`No Mubasher candles for ${code}`);

  const last = candles.at(-1);
  const prev = candles.at(-2);
  const finalPrice = last.c;
  if (previousClose == null) previousClose = prev?.c ?? null;
  // Prefer computed change from last vs prev when bar change missing.
  const finalChange =
    change != null
      ? change
      : previousClose != null
        ? finalPrice - previousClose
        : null;
  const finalChangePct =
    changePercent != null
      ? changePercent
      : finalChange != null && previousClose
        ? (finalChange / previousClose) * 100
        : null;

  let asOf = new Date(last.t).toISOString();
  if (bar.updatedAt) {
    // "2026-08-09 13:29:09" Cairo wall time
    const m = String(bar.updatedAt).match(
      /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/
    );
    if (m) {
      const parsed = Date.parse(`${m[1]}T${m[2]}+02:00`);
      if (Number.isFinite(parsed)) asOf = new Date(parsed).toISOString();
    }
  }

  const resolvedEn = nameEn || name || data?.name || code;
  const resolvedAr = nameAr || data?.tradingName || resolvedEn;

  return {
    ticker,
    name: resolvedAr,
    nameAr: resolvedAr,
    nameEn: resolvedEn,
    price: round4(finalPrice),
    previousClose: previousClose != null ? round4(previousClose) : null,
    change: finalChange != null ? round4(finalChange) : null,
    changePercent: finalChangePct != null ? round4(finalChangePct) : null,
    currency: "EGP",
    exchange: "EGX",
    asOf,
    candles,
    source: "mubasher",
    scrapedAt: new Date().toISOString(),
    ...(rawCsvCandles ? { rawCsvCandles } : {}),
  };
}
