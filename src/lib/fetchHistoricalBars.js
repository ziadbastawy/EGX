import { mubasherCode } from "./mubasher.js";
import { parseCsvCandles } from "./mubasherCsv.js";
import { fetchQuote as fetchYahooQuote } from "./yahoo.js";

const API = "https://www.mubasher.info/api/1/markets/EGX/stocks";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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

function inBounds(t, fromMs, toMs) {
  if (fromMs != null && Number.isFinite(fromMs) && t < fromMs) return false;
  if (toMs != null && Number.isFinite(toMs) && t > toMs) return false;
  return true;
}

/**
 * Fetch raw historical OHLCV. Never applies live overlay.
 * Missing provider history is returned as missingHistory, not thrown.
 */
export async function fetchHistoricalBars({
  ticker,
  providerCode = "mubasher",
  providerSymbol = null,
  range = "5d",
  fromMs = null,
  toMs = null,
  timeoutMs = 20000,
} = {}) {
  if (providerCode === "yahoo") {
    try {
      const quote = await fetchYahooQuote(
        { ticker, yahoo: providerSymbol && providerSymbol !== ticker ? providerSymbol : undefined },
        range || "3mo"
      );
      const candles = (quote.candles || []).filter((c) => inBounds(c.t, fromMs, toMs));
      if (!candles.length) {
        return {
          bars: [],
          sourceKind: "yahoo_chart",
          missingHistory: { ticker, reason: "empty_history" },
        };
      }
      return { bars: candles, sourceKind: "yahoo_chart", missingHistory: null };
    } catch (err) {
      const msg = err?.message || String(err);
      if (/No candle data|HTTP 404/i.test(msg)) {
        return {
          bars: [],
          sourceKind: "yahoo_chart",
          missingHistory: { ticker, reason: msg },
        };
      }
      throw err;
    }
  }

  const code = providerSymbol || mubasherCode(ticker);
  const data = await fetchJson(code, timeoutMs);
  const histUrl = data?.stocks?.[0]?.historicalFileUrl;
  if (!histUrl) {
    return {
      bars: [],
      sourceKind: "csv",
      missingHistory: { ticker, reason: "no_historical_csv_url" },
    };
  }

  const res = await fetch(histUrl, {
    headers: { "User-Agent": UA, Accept: "text/csv,*/*" },
  });
  if (!res.ok) {
    if (res.status === 404) {
      return {
        bars: [],
        sourceKind: "csv",
        missingHistory: { ticker, reason: `csv_http_${res.status}` },
      };
    }
    throw new Error(`Mubasher CSV HTTP ${res.status}`);
  }
  const text = await res.text();
  const bars = parseCsvCandles(text, range, { fromMs, toMs });
  if (!bars.length) {
    return {
      bars: [],
      sourceKind: "csv",
      missingHistory: { ticker, reason: "empty_history" },
    };
  }
  return { bars, sourceKind: "csv", missingHistory: null };
}
