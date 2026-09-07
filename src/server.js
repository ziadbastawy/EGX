import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Agent, CursorAgentError, JsonlLocalAgentStore } from "@cursor/sdk";
import {
  analyzeQuote,
  analyzeUniverse,
  applyFundamentalScalpBoost,
  compactForAi,
  scanAnalyses,
} from "./lib/indicators.js";
import { buildCompanyProfile } from "./lib/companyContext.js";
import { fetchMubasherStock } from "./lib/mubasher.js";
import { buildPriceDepth } from "./lib/priceDepth.js";
import { scoreThndrFunds } from "./lib/thndrFunds.js";
import { runFundsPhotoExtract } from "./lib/runFundsPhoto.js";
import { runFundsAdvice } from "./lib/runFundsAdvice.js";
import { runAiPing } from "./lib/runAiPing.js";
import {
  LATEST_PATH,
  ensureMarketData,
  marketStatus,
  readLatestMeta,
  startScrape,
} from "./lib/ensureMarketData.js";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const AGENT_STORE_PATH = path.join(ROOT, ".cursor-agents");
// Render/Railway set PORT; local/dev uses API_PORT (default 8787).
const PORT = Number(process.env.PORT || process.env.API_PORT) || 8787;
const agentStore = new JsonlLocalAgentStore(AGENT_STORE_PATH);

// Mubasher scrape cache: code -> { ts, data }. 10-minute TTL.
const mubasherCache = new Map();
const MUBASHER_TTL_MS = 10 * 60_000;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-ai-provider, x-ai-key, x-ai-model",
  });
  res.end(payload);
}

function readBody(req, { maxBytes = 8_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("Request too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeTicker(raw) {
  const t = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\.CA$/i, "");
  return t ? `${t}.CA` : "";
}

/** Normalize a provider string to one of the supported ids. */
function normalizeProvider(raw) {
  const p = String(raw || process.env.AI_PROVIDER || "cursor")
    .trim()
    .toLowerCase();
  if (p === "openai" || p === "chatgpt" || p === "gpt") return "openai";
  return "cursor";
}

/**
 * Extract the AI provider config from a request. The frontend sends the
 * user-configured provider/key/model via headers (preferred) or JSON body,
 * so the key never has to live in the server .env.
 */
function aiConfigFromReq(req, body = {}) {
  const provider = req.headers["x-ai-provider"] || body.provider;
  const apiKey = req.headers["x-ai-key"] || body.apiKey;
  const model = req.headers["x-ai-model"] || body.model;
  return {
    provider: provider ? String(provider) : undefined,
    apiKey: apiKey ? String(apiKey) : undefined,
    model: model ? String(model) : undefined,
  };
}

/** Get Mubasher data via the shared cache; never throws so AI still works if it fails. */
async function getMubasherCached(ticker) {
  const code = normalizeTicker(ticker).replace(/\.CA$/i, "");
  if (!code) return null;
  const hit = mubasherCache.get(code);
  if (hit && Date.now() - hit.ts < MUBASHER_TTL_MS) return hit.data;
  try {
    const data = await fetchMubasherStock(ticker);
    mubasherCache.set(code, { ts: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

/** Compact real fundamentals (from Mubasher) to feed the AI prompt. */
function fundamentalsForAi(mub) {
  if (!mub) return null;
  const f = mub.fundamentals || {};
  const has = ["marketCap", "pe", "eps", "bookValue", "pb", "capital"].some((k) => f[k] != null);
  if (!has) return null;
  return {
    source: "mubasher.info (delayed ~15m)",
    marketCap: f.marketCap ?? null,
    pe: f.pe ?? null,
    eps: f.eps ?? null,
    bookValue: f.bookValue ?? null,
    pb: f.pb ?? null,
    parValue: f.parValue ?? null,
    shares: f.shares ?? null,
    capital: f.capital ?? null,
    currency: f.currency ?? null,
    latestNews: (mub.news || []).slice(0, 5).map((n) => n.title),
    latestAnnouncements: (mub.announcements || [])
      .slice(0, 5)
      .map((a) => ({ date: a.date, title: a.title })),
  };
}

/** Prompt block that surfaces real fundamentals when available (else empty). */
function fundamentalsBlock(fundamentals) {
  if (!fundamentals) return "";
  return (
    `\nReal fundamentals from Mubasher (USE THESE — cite the numbers; only say "غير متاح"/"n/a" for metrics NOT listed here):\n` +
    `${JSON.stringify(fundamentals, null, 2)}\n`
  );
}

async function loadMarket() {
  try {
    const raw = await fs.readFile(LATEST_PATH, "utf8");
    const data = JSON.parse(raw);
    const results = data.results || [];
    if (!results.length) {
      const err = new Error("Market data is empty — scrape in progress or failed");
      err.status = 503;
      err.retryable = true;
      ensureMarketData().catch(() => {});
      throw err;
    }
    return {
      results,
      scrapedAt: data.scrapedAt,
      range: data.range,
    };
  } catch (err) {
    if (err.status) throw err;
    if (err.code === "ENOENT") {
      const missing = new Error(
        "Market data not ready — scrape has been started; retry in a minute"
      );
      missing.status = 503;
      missing.retryable = true;
      ensureMarketData().catch(() => {});
      throw missing;
    }
    throw err;
  }
}

const FUNDAMENTALS_PATH = path.join(ROOT, "web", "public", "fundamentals.json");
const FUNDAMENTALS_TTL_MS = 5 * 60 * 1000;
let fundamentalsCache = { ts: 0, map: null };

/** Load the bulk Mubasher fundamentals (from scrape:fundamentals) as a code→metrics map. */
async function loadFundamentalsMap() {
  if (fundamentalsCache.map && Date.now() - fundamentalsCache.ts < FUNDAMENTALS_TTL_MS) {
    return fundamentalsCache.map;
  }
  const map = new Map();
  try {
    const raw = await fs.readFile(FUNDAMENTALS_PATH, "utf8");
    const data = JSON.parse(raw);
    for (const row of data.results || []) {
      const code = String(row.code || row.ticker || "")
        .replace(/\.CA$/i, "")
        .toUpperCase();
      if (!code) continue;
      const f = row.fundamentals || {};
      map.set(code, {
        marketCap: f.marketCap ?? null,
        pe: f.pe ?? null,
        eps: f.eps ?? null,
        bookValue: f.bookValue ?? null,
        pb: f.pb ?? null,
        capital: f.capital ?? null,
        shares: f.shares ?? null,
        currency: f.currency ?? null,
      });
    }
  } catch {
    /* fundamentals.json may not exist yet — degrade to technicals only */
  }
  fundamentalsCache = { ts: Date.now(), map };
  return map;
}

/** Attach scraped fundamentals onto a list of items keyed by ticker/code. */
function attachFundamentals(list, fundMap) {
  if (!fundMap || !fundMap.size) return list;
  return (list || []).map((item) => {
    if (!item) return item;
    const code = String(item.ticker || "")
      .replace(/\.CA$/i, "")
      .toUpperCase();
    const f = fundMap.get(code);
    const withFund = f ? { ...item, fundamentals: f } : item;
    return applyFundamentalScalpBoost(withFund);
  });
}

const SCAN_TYPES = ["top", "rsi", "macd", "breakout", "accumulation", "scalp", "week"];

function findQuote(results, ticker) {
  const needle = normalizeTicker(ticker);
  return (results || []).find(
    (q) => normalizeTicker(q.ticker) === needle || q.ticker === ticker
  );
}

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Provider dispatch. Runs the prompt through the user-selected AI provider:
 *  - "cursor" (default) → Cursor Agent SDK (composer models)
 *  - "openai"           → ChatGPT via the OpenAI Chat Completions API
 * Returns the raw text reply (expected to contain a single JSON object).
 */
async function runAgent(prompt, ai = {}, opts = {}) {
  const provider = normalizeProvider(ai.provider);
  if (provider === "openai") return runOpenAiChat(prompt, ai, opts);
  return runCursorAgent(prompt, ai, opts);
}

/** OpenAI ChatGPT completion — asks for a single JSON object back. */
async function runOpenAiChat(prompt, ai = {}, opts = {}) {
  const apiKey = ai.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(new Error("OpenAI API key is missing (set it in Settings)"), {
      status: 400,
    });
  }
  const model = ai.model?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const userContent = opts.imageDataUrl
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: opts.imageDataUrl, detail: "high" } },
      ]
    : prompt;

  let res;


  console.log("Model:", model);
console.log("API Key starts with:", apiKey.slice(0, 15));
console.log("API Key length:", apiKey.length);
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: opts.imageDataUrl ? 0.1 : 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a rigorous Egyptian Exchange (EGX) market analyst. Follow the user's instructions exactly and reply with a SINGLE JSON object only — no markdown, no code fences, no preamble.",
          },
          { role: "user", content: userContent },
        ],
      }),
    });
  } catch (err) {
    throw Object.assign(new Error(`OpenAI request failed: ${err.message}`), { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 401) {
      throw Object.assign(new Error("OpenAI rejected the API key (401). Check the key in Settings."), {
        status: 400,
      });
    }
    throw Object.assign(new Error(`OpenAI HTTP ${res.status}: ${detail.slice(0, 200)}`), {
      status: 502,
    });
  }

  const data = await res.json().catch(() => ({}));
  return data.choices?.[0]?.message?.content || "";
}

/** Collect assistant text + any createPlan body (plan mode often parks JSON only in the plan). */
async function runCursorAgent(prompt, ai = {}, opts = {}) {
  const apiKey = ai.apiKey?.trim() || process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(
      new Error("Cursor API key is missing (set it in Settings or the server .env)"),
      { status: 400 }
    );
  }
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = apiKey;
  let agent;
  try {
    agent = await Agent.create({
      apiKey,
      model: { id: ai.model?.trim() || "composer-2.5" },
      local: { cwd: ROOT, store: agentStore },
      tools: opts.imagePath ? ["read"] : [],
    });
  } catch (err) {
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
    throw err;
  }

  try {
    const run = await agent.send(prompt);
    let assistantText = "";
    let planText = "";

    for await (const event of run.stream()) {
      if (event.type === "assistant") {
        for (const block of event.message?.content || []) {
          if (block.type === "text" && block.text) assistantText += block.text;
        }
        continue;
      }
      if (event.type === "tool_call" && event.name === "createPlan") {
        const plan = event.args?.plan;
        if (typeof plan === "string" && plan.length > planText.length) planText = plan;
      }
    }

    const result = await run.wait();
    if (result.status !== "finished") {
      throw Object.assign(
        new Error(result.error?.message || `Agent status: ${result.status}`),
        { status: 502 }
      );
    }

    const candidates = [result.result || "", assistantText, planText].filter(Boolean);
    const withJson = candidates.find((t) => extractJson(t)?.action || extractJson(t)?.holdings);
    return withJson || candidates.sort((a, b) => b.length - a.length)[0] || "";
  } finally {
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
    try {
      if (agent && typeof agent[Symbol.asyncDispose] === "function") {
        await agent[Symbol.asyncDispose]();
      } else if (agent && typeof agent.close === "function") {
        await agent.close();
      }
    } catch {
      /* ignore dispose errors */
    }
  }
}

function normalizePick(p, fallbackConfidence = 50) {
  if (!p || typeof p !== "object") return null;
  const ticker = String(p.ticker || "")
    .toUpperCase()
    .replace(/\.CA$/i, "");
  if (!ticker) return null;
  const nameAr = String(p.nameAr || p.name || "").trim();
  const nameEn = String(p.nameEn || p.name || "").trim();
  return {
    ticker,
    nameAr: nameAr ? nameAr.slice(0, 120) : undefined,
    nameEn: nameEn ? nameEn.slice(0, 120) : undefined,
    action: ["buy", "sell", "hold"].includes(p.action) ? p.action : "hold",
    confidence: Math.max(0, Math.min(100, Number(p.confidence) || fallbackConfidence)),
    entry: p.entry ?? null,
    stopLoss: p.stopLoss ?? p.sl ?? null,
    target1: p.target1 ?? p.t1 ?? null,
    target2: p.target2 ?? p.t2 ?? null,
    reason: String(p.reason || p.summary || "").slice(0, 320),
    signals: Array.isArray(p.signals) ? p.signals.map(String).slice(0, 8) : [],
  };
}

/**
 * Output criteria for the agent — methods are THEIRS; we only require full coverage.
 * Every factor below must appear in `considerations` (honest "insufficient data" is OK).
 */
const SUGGEST_OUTPUT_CRITERIA = `Analyze the RAW market data yourself (your own methods).
We do NOT provide a precomputed score or our internal formula — do not invent that we did.

PRIORITY FUNDAMENTAL LENS (must address even when numbers are missing — never invent ratios):
A. Valuation (highest priority) — is the stock cheap or expensive vs economic value?
   Address: P/E, PEG, EV/EBITDA, Price/Book; vs sector average; vs the company's own history.
   If none of these appear in the payload: say so clearly and DO NOT invent PE/PEG/EV/EBITDA/P/B.
   Effect on stance: a strong chart does NOT justify a buy if valuation would likely be stretched —
   reduce confidence / prefer hold until valuation data exists.
B. Earnings quality — not all profits are equal.
   Separate sustainable operating earnings from one-offs (asset sales, FX gains, revaluations, accounting items).
   If income-statement detail is absent from the payload: state that and avoid high-confidence buys
   that assume durable earnings.
C. Capital allocation — how does management use cash/profits?
   Expansion / capex, dividends, buybacks, M&A / acquisitions — and what that implies for long-term quality.
   If cash-flow / dividend / buyback data is absent: say so; still note what you can infer only if present.

You MUST also weigh ALL of these technical/market considerations (cite numbers from the payload):
1. Trend / structure — multi-bar direction, higher-highs/lows or range, moving-average style reads you choose
2. Momentum — short vs medium thrust (e.g. 1d / ~5d / longer if candles allow)
3. Volume & liquidity — vs recent average, dry-ups, climaxes; thin names = lower conviction
4. Volatility — recent range / ATR-style size; stops and targets MUST fit it
5. Support & resistance — swing levels, range edges, prior highs/lows from OHLCV
6. Candle structure — latest bars: body/wicks, engulfing/pin/doji-style reads, consecutive thrust
7. Gaps — open vs prior close where visible; filled vs open gap risk
8. Breakout / fakeout — close through a level with/without volume confirmation
9. Consolidation / compression — tight range then expansion risk or continuation
10. Relative strength — stock day% vs peer day% and vs market tape median in payload
11. Sector / peer cluster — are peers confirming or diverging?
12. Currency listing — EGP vs USD names; FX-sensitivity caveat when USD-listed
13. Risk/reward — entry, stop, targets with approximate R:R; reject poor R:R for buy
14. Divergences — price vs momentum/volume when readable from the series
15. Horizon fit — what works for same-session scalp vs week vs month vs long (may differ);
    valuation + earnings quality + capital allocation matter most for month/long; scalp may still note them as context
16. Data limits — explicitly name gaps (order book, earnings calendar, free float, live FX, EGX30 membership,
    and any missing fundamentals: P/E, PEG, EV/EBITDA, P/B, sector/historical multiples, income quality, FCF/dividends/buybacks)

Then produce:
- Stance: buy | sell | hold with honest confidence 0-100
  (do NOT give high confidence buy when A/B are unknown or clearly adverse)
- Four horizons with buy & sell (& stop): scalp, week, month, long
- Fill every key in the required \`considerations\` object (short sentences; use "غير متاح من البيانات" / "n/a from payload" when blocked)

Rules for the OUTPUT only:
- Be concrete; cite prices, %, volumes, candle highs/lows — and any fundamental metrics ONLY if present in the payload
- Never fabricate valuation ratios or earnings-quality claims
- No fantasy prices far outside recent ranges without justification
- Educational only — not financial advice
- Do NOT call createPlan or write files
- Your entire reply must be ONE JSON object (first char \`{\`, last char \`}\`) — no preamble`;

/** Compact decision guide for the free-form Q&A agent path. */
const DECISION_CHECKLIST = `Decision checklist (weigh together — never rely on one signal alone):
- Combine technicals (trend, EMAs, RSI, MACD, volume, support/resistance, ATR/volatility, R:R)
  with company/sector context (liquidity tier, relative strength vs market, peers, listing currency).
- Prefer HOLD when signals conflict, liquidity is thin, or key data is missing — say so honestly.
- Never invent fundamentals (P/E, PEG, EV/EBITDA, P/B) that are absent from the payload.
- Every pick must be logical, cite concrete numbers, and stay within realistic recent ranges.
- Educational only — not financial advice.`;

const CONSIDERATION_KEYS = [
  "valuation",
  "earningsQuality",
  "capitalAllocation",
  "trend",
  "momentum",
  "volumeLiquidity",
  "volatility",
  "supportResistance",
  "candleStructure",
  "gaps",
  "breakoutFakeout",
  "consolidation",
  "relativeStrength",
  "sectorPeers",
  "currencyListing",
  "riskReward",
  "divergences",
  "horizonFit",
  "dataLimits",
];

function sanitizeConsiderations(raw, lang) {
  const fallback =
    lang === "en" ? "Not assessed in this reply." : "لم يُقيَّم في هذا الرد.";
  const out = {};
  const src = raw && typeof raw === "object" ? raw : {};
  for (const key of CONSIDERATION_KEYS) {
    const v = src[key];
    const max = key === "valuation" || key === "earningsQuality" || key === "capitalAllocation" ? 420 : 280;
    out[key] = String(v != null && String(v).trim() ? v : fallback).slice(0, max);
  }
  return out;
}

function marketTapeForAi(results) {
  const pcts = (results || [])
    .map((q) => q.changePercent)
    .filter((n) => n != null && Number.isFinite(Number(n)))
    .map(Number)
    .sort((a, b) => a - b);
  if (!pcts.length) {
    return { universeSize: (results || []).length, medianDayChangePct: null, advancers: 0, decliners: 0 };
  }
  const mid = Math.floor(pcts.length / 2);
  const median =
    pcts.length % 2 ? pcts[mid] : Math.round(((pcts[mid - 1] + pcts[mid]) / 2) * 100) / 100;
  return {
    universeSize: (results || []).length,
    medianDayChangePct: median,
    advancers: pcts.filter((p) => p > 0).length,
    decliners: pcts.filter((p) => p < 0).length,
    usdListedCount: (results || []).filter((q) => String(q.currency || "").toUpperCase() === "USD").length,
  };
}

const HORIZONS = ["scalp", "week", "month", "long"];

function roundPx(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 100) / 100;
}

function sanitizeSuggestion(parsed) {
  if (!parsed) return parsed;
  const action = ["buy", "sell", "hold"].includes(parsed.action) ? parsed.action : "hold";
  const confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 50));
  return { ...parsed, action, confidence };
}

/** Raw quote blob for the agent — no local scores/indicators/signals. */
function rawQuoteForAi(quote, { candleLimit = 90 } = {}) {
  if (!quote) return null;
  const candles = Array.isArray(quote.candles) ? quote.candles.slice(-candleLimit) : [];
  const company = buildCompanyProfile(quote);
  return {
    ticker: quote.ticker,
    nameAr: quote.nameAr || quote.name || "",
    nameEn: quote.nameEn || quote.name || "",
    price: quote.price,
    previousClose: quote.previousClose ?? null,
    change: quote.change ?? null,
    changePercent: quote.changePercent ?? null,
    currency: quote.currency || "EGP",
    exchange: quote.exchange || "EGX",
    asOf: quote.asOf || null,
    sector: { id: company.sectorId, ar: company.sectorAr, en: company.sectorEn },
    candles,
  };
}

function rawPeersForAi(results, quote, limit = 6) {
  const company = buildCompanyProfile(quote);
  const sid = company.sectorId;
  const peers = (results || [])
    .filter((q) => q.ticker !== quote.ticker && buildCompanyProfile(q).sectorId === sid)
    .slice(0, limit)
    .map((q) => ({
      ticker: q.ticker,
      nameAr: q.nameAr || q.name || "",
      price: q.price,
      changePercent: q.changePercent ?? null,
      currency: q.currency || "EGP",
    }));
  if (peers.length) return peers;
  return (results || [])
    .filter((q) => q.ticker !== quote.ticker)
    .slice(0, limit)
    .map((q) => ({
      ticker: q.ticker,
      nameAr: q.nameAr || q.name || "",
      price: q.price,
      changePercent: q.changePercent ?? null,
      currency: q.currency || "EGP",
    }));
}

function normalizePlan(raw) {
  const horizonMap = {
    scalp: "scalp",
    session: "scalp",
    مضاربة: "scalp",
    week: "week",
    أسبوع: "week",
    month: "month",
    شهر: "month",
    long: "long",
    long_term: "long",
    طويل: "long",
  };
  const horizon =
    HORIZONS.includes(raw?.horizon)
      ? raw.horizon
      : horizonMap[String(raw?.horizon || raw?.type || "").toLowerCase()];
  if (!horizon) return null;
  const action = ["buy", "sell", "hold"].includes(raw?.action) ? raw.action : "hold";
  return {
    horizon,
    action,
    buy: roundPx(raw?.buy ?? raw?.entry),
    sell: roundPx(raw?.sell ?? raw?.target ?? raw?.target1),
    sell2: roundPx(raw?.sell2 ?? raw?.target2),
    stop: roundPx(raw?.stop ?? raw?.stopLoss),
    note: String(raw?.note || "").slice(0, 120),
  };
}

/** Prefer AI plans only — no merge with our scoring engine. */
function plansFromAi(parsedPlans) {
  const byH = new Map();
  if (Array.isArray(parsedPlans)) {
    for (const raw of parsedPlans) {
      const plan = normalizePlan(raw);
      if (plan) byH.set(plan.horizon, plan);
    }
  }
  return HORIZONS.map((h) => byH.get(h)).filter(Boolean);
}

async function buildScalpSuggestion(quote, lang, ai = {}) {
  const market = await loadMarket();
  const langLabel = lang === "en" ? "English" : "Arabic";
  const raw = rawQuoteForAi(quote, { candleLimit: 60 });
  const peers = rawPeersForAi(market.results, quote, 8);
  const tape = marketTapeForAi(market.results);
  const fundamentals = fundamentalsForAi(await getMubasherCached(quote.ticker));

  const prompt = `You are an independent EGX same-session SCALP analyst.
Do NOT modify files. Do NOT call createPlan. Reply with a single JSON object only (no narration).

You receive RAW session data (OHLCV candles + peers + market tape). Analyze with YOUR methods.
Do not assume any precomputed score from us.

${SUGGEST_OUTPUT_CRITERIA}

Focus LEVELS and action on SAME-SESSION scalp, but still fill EVERY considerations key.

Raw stock:
${JSON.stringify(raw, null, 2)}
${fundamentalsBlock(fundamentals)}
Raw sector/market peers (prices only):
${JSON.stringify(peers)}

Market tape (raw breadth — no scores):
${JSON.stringify(tape)}

Market scrapedAt: ${market.scrapedAt || "n/a"} · range: ${market.range || "n/a"}

Return ONLY JSON:
{
  "action": "buy"|"sell"|"hold",
  "confidence": 0-100,
  "summary": "1-2 honest sentences in ${langLabel}",
  "buy": number,
  "sell": number,
  "stop": number,
  "reasons": ["in ${langLabel}", "... up to 10 — each tied to a consideration"],
  "considerations": {
    "valuation": "P/E PEG EV/EBITDA P/B vs sector & history — or n/a from payload; in ${langLabel}",
    "earningsQuality": "operating vs one-off earnings — or n/a; in ${langLabel}",
    "capitalAllocation": "expand / dividend / buyback / M&A — or n/a; in ${langLabel}",
    "trend": "in ${langLabel}",
    "momentum": "...",
    "volumeLiquidity": "...",
    "volatility": "...",
    "supportResistance": "...",
    "candleStructure": "...",
    "gaps": "...",
    "breakoutFakeout": "...",
    "consolidation": "...",
    "relativeStrength": "...",
    "sectorPeers": "...",
    "currencyListing": "...",
    "riskReward": "...",
    "divergences": "...",
    "horizonFit": "scalp-session focus in ${langLabel}",
    "dataLimits": "..."
  },
  "signals": ["label", "..."]
}`;

  try {
    const text = await runAgent(prompt, ai);
    const parsed = extractJson(text);
    if (!parsed || !["buy", "sell", "hold"].includes(parsed.action)) {
      throw Object.assign(new Error("AI scalp reply was not valid JSON with action buy|sell|hold"), {
        status: 502,
      });
    }
    const safe = sanitizeSuggestion(parsed);
    return {
      action: safe.action,
      confidence: safe.confidence,
      summary: String(parsed.summary || "").slice(0, 320),
      buy: roundPx(parsed.buy),
      sell: roundPx(parsed.sell),
      stop: roundPx(parsed.stop),
      reasons: Array.isArray(parsed.reasons)
        ? parsed.reasons.map((r) => String(r).slice(0, 180)).slice(0, 10)
        : [],
      considerations: sanitizeConsiderations(parsed.considerations, lang),
      signals: Array.isArray(parsed.signals) ? parsed.signals.map(String).slice(0, 12) : [],
      source: "agent",
    };
  } catch (err) {
    console.error("[suggest-scalp]", err.message);
    throw err.status ? err : Object.assign(err, { status: 502 });
  }
}

async function buildSuggestion(quote, lang, ai = {}) {
  const market = await loadMarket();
  const langLabel = lang === "en" ? "English" : "Arabic";
  const raw = rawQuoteForAi(quote, { candleLimit: 90 });
  const peers = rawPeersForAi(market.results, quote, 8);
  const tape = marketTapeForAi(market.results);
  const fundamentals = fundamentalsForAi(await getMubasherCached(quote.ticker));

  const prompt = `You are an independent multi-factor EGX analyst.
Do NOT modify any files. Do NOT call createPlan. Reply with a single JSON object only (no narration).

You receive RAW market data only (quotes + daily OHLCV + peer tape). Analyze with YOUR own methods.
We are NOT sending our internal scoring formula, signals, or action hints.

${SUGGEST_OUTPUT_CRITERIA}

Raw stock:
${JSON.stringify(raw, null, 2)}
${fundamentalsBlock(fundamentals)}
Raw peers (no scores — prices/moves only):
${JSON.stringify(peers)}

Market tape (raw breadth — no scores):
${JSON.stringify(tape)}

Market scrapedAt: ${market.scrapedAt || "n/a"} · range: ${market.range || "n/a"}

Respond ONLY with valid JSON:
{
  "action": "buy" | "sell" | "hold",
  "confidence": 0-100,
  "summary": "2-3 honest sentences in ${langLabel} that weave the main considerations",
  "reasons": ["in ${langLabel}", "... up to 12 — cover distinct factors"],
  "entry": number,
  "stopLoss": number,
  "target1": number,
  "target2": number,
  "plans": [
    {"horizon":"scalp","action":"buy|sell|hold","buy":0,"sell":0,"stop":0,"note":"in ${langLabel}"},
    {"horizon":"week","action":"buy|sell|hold","buy":0,"sell":0,"stop":0,"note":"..."},
    {"horizon":"month","action":"buy|sell|hold","buy":0,"sell":0,"sell2":0,"stop":0,"note":"..."},
    {"horizon":"long","action":"buy|sell|hold","buy":0,"sell":0,"stop":0,"note":"..."}
  ],
  "considerations": {
    "valuation": "P/E PEG EV/EBITDA P/B vs sector & history — or n/a from payload; in ${langLabel}",
    "earningsQuality": "operating vs one-off earnings — or n/a; in ${langLabel}",
    "capitalAllocation": "expand / dividend / buyback / M&A — or n/a; in ${langLabel}",
    "trend": "in ${langLabel}",
    "momentum": "...",
    "volumeLiquidity": "...",
    "volatility": "...",
    "supportResistance": "...",
    "candleStructure": "...",
    "gaps": "...",
    "breakoutFakeout": "...",
    "consolidation": "...",
    "relativeStrength": "...",
    "sectorPeers": "...",
    "currencyListing": "...",
    "riskReward": "...",
    "divergences": "...",
    "horizonFit": "...",
    "dataLimits": "..."
  },
  "signals": ["your labels", "..."]
}`;

  try {
    const text = await runAgent(prompt, ai);
    const parsed = extractJson(text);
    if (!parsed || !["buy", "sell", "hold"].includes(parsed.action)) {
      throw Object.assign(new Error("AI suggestion reply was not valid JSON with action buy|sell|hold"), {
        status: 502,
      });
    }

    const safe = sanitizeSuggestion(parsed);
    const plans = plansFromAi(parsed.plans);
    return {
      action: safe.action,
      confidence: safe.confidence,
      summary: String(parsed.summary || "").slice(0, 520),
      reasons: Array.isArray(parsed.reasons)
        ? parsed.reasons.map((r) => String(r).slice(0, 200)).slice(0, 12)
        : [],
      entry: roundPx(parsed.entry),
      stopLoss: roundPx(parsed.stopLoss),
      target1: roundPx(parsed.target1),
      target2: roundPx(parsed.target2),
      plans,
      considerations: sanitizeConsiderations(parsed.considerations, lang),
      signals: Array.isArray(parsed.signals) ? parsed.signals.map(String).slice(0, 12) : [],
      source: "agent",
    };
  } catch (err) {
    console.error("[suggest]", err.message);
    throw err.status ? err : Object.assign(err, { status: 502 });
  }
}

function compactScreenForAi(rows, planKey) {
  return (rows || []).map((a) => {
    const plan = a[planKey] || {};
    return {
      ticker: a.ticker.replace(/\.CA$/i, ""),
      nameAr: a.nameAr,
      nameEn: a.nameEn,
      price: a.price,
      buy: plan.buy,
      sell: plan.sell,
      stop: plan.stop,
      rr: plan.rr,
      score: plan.score,
      trend: a.indicators?.trend,
      rsi: a.indicators?.rsi,
      volX: a.indicators?.volumeRatio,
      fundamentals: a.fundamentals || undefined,
    };
  });
}

function bindPicksToScreen(picks, screen, planKey) {
  const byCode = new Map(
    (screen || []).map((a) => [String(a.ticker || "").replace(/\.CA$/i, "").toUpperCase(), a])
  );
  const out = [];
  const seen = new Set();
  for (const pick of picks || []) {
    const code = String(pick.ticker || "")
      .replace(/\.CA$/i, "")
      .toUpperCase();
    if (!code || seen.has(code)) continue;
    const row = byCode.get(code);
    if (!row) continue;
    seen.add(code);
    const plan = row[planKey] || {};
    out.push(
      pickFromAnalysis(row, {
        action: "buy",
        confidence: plan.score || pick.confidence,
        entry: plan.buy,
        stopLoss: plan.stop,
        target1: plan.sell,
        reason: pick.reason || (plan.reasons || []).join(" · "),
      })
    );
  }
  return out;
}

function mentionTickers(question, analyses) {
  const upper = String(question || "").toUpperCase();
  return analyses.filter((a) => {
    const code = a.ticker.replace(/\.CA$/i, "");
    return upper.includes(code);
  });
}

function detectIntent(question) {
  const q = String(question || "").toLowerCase();
  const ar = String(question || "");

  if (/rsi|أقل من 30|اقل من 30|ارتداد/.test(q + ar)) return { type: "rsi", limit: 10 };
  if (/macd/.test(q)) return { type: "macd", limit: 10 };
  if (/أسبوع|اسبوع|week|weekly/.test(q + ar)) return { type: "week", limit: 8 };
  if (/مضارب|جلسة|scalp|day.?trade|سكلب/.test(q + ar)) return { type: "scalp", limit: 8 };
  if (/مقاوم|breakout|كسر/.test(q + ar)) return { type: "breakout", limit: 10 };
  if (/تجميع|accumulation|تجمع/.test(ar + q)) return { type: "accumulation", limit: 10 };
  if (/بيع\s*قوي|أسوأ|اسوا|weakest|sell.?list/.test(ar + q)) return { type: "weak", limit: 8 };

  const countMatch = ar.match(/(?:رشح|رشّح|أفضل|افضل|top)\D{0,12}(\d{1,2})/) ||
    q.match(/(?:recommend|pick|top)\D{0,12}(\d{1,2})/);
  if (countMatch || /رشح|رشّح|أفضل|افضل|اشتري|شراء|recommend|pick/.test(ar + q)) {
    const n = countMatch ? Number(countMatch[1]) : 5;
    return { type: "top", limit: Math.max(1, Math.min(10, n)) };
  }
  return null;
}

function pickFromAnalysis(a, { action, confidence, entry, stopLoss, target1, target2, reason } = {}) {
  return normalizePick({
    ticker: a.ticker,
    nameAr: a.nameAr,
    nameEn: a.nameEn,
    action:
      action ||
      (a.score >= 60 ? "buy" : a.score <= 35 ? "sell" : "hold"),
    confidence: confidence ?? a.score,
    entry: entry ?? a.trade?.entry,
    stopLoss: stopLoss ?? a.trade?.stopLoss,
    target1: target1 ?? a.trade?.target1,
    target2: target2 ?? a.trade?.target2,
    reason: reason ?? (a.reasons || []).join(" · "),
    signals: a.signals,
  });
}

function localAnswerFromScan(question, lang, analyses, screens) {
  const intent = detectIntent(question);
  const mentioned = mentionTickers(question, analyses);
  const arEn = String(question || "");

  if (mentioned.length === 1 && /بيع|أبيع|ابيع|sell|holding|مسك/.test(arEn)) {
    const a = mentioned[0];
    const action = a.score >= 65 ? "hold" : a.score <= 40 ? "sell" : "hold";
    const answer =
      lang === "en"
        ? `${a.ticker.replace(/\.CA$/i, "")} looks like a ${action} based on multi-factor score ${a.score}/100 (${a.reasons.slice(0, 2).join("; ")}).`
        : `${a.ticker.replace(/\.CA$/i, "")}: الإشارة الحالية أقرب لـ${action === "sell" ? "بيع" : "انتظار/متابعة"} بدرجة ${a.score}/100. ${a.reasons.slice(0, 2).join(" · ")}.`;
    return {
      answer,
      picks: [pickFromAnalysis(a, { action, confidence: a.score, reason: a.reasons.join(" · ") })],
    };
  }

  // Single-ticker explain: score / buy? / analysis
  if (mentioned.length === 1) {
    const a = mentioned[0];
    const action = a.score >= 60 ? "buy" : a.score <= 35 ? "sell" : "hold";
    const code = a.ticker.replace(/\.CA$/i, "");
    const answer =
      lang === "en"
        ? `${code}: local multi-factor score ${a.score}/100 → ${action}. Trend ${a.indicators?.trend || "n/a"}, RSI ${a.indicators?.rsi ?? "n/a"}, vol ${a.indicators?.volumeRatio ?? "n/a"}×. ${a.reasons.slice(0, 3).join("; ")}.`
        : `${code}: التقييم المحلي متعدد العوامل ${a.score}/100 → ${action === "buy" ? "شراء" : action === "sell" ? "بيع" : "انتظار"}. الاتجاه ${a.indicators?.trend || "—"} · RSI ${a.indicators?.rsi ?? "—"} · الحجم ${a.indicators?.volumeRatio ?? "—"}×. ${a.reasons.slice(0, 3).join(" · ")}.`;
    return {
      answer,
      picks: [pickFromAnalysis(a, { action, reason: a.reasons.join(" · ") })],
    };
  }

  if (mentioned.length >= 2 && /مقارن|compare|بين/.test(question)) {
    const picks = mentioned.slice(0, 5).map((a) => pickFromAnalysis(a));
    const ranked = [...mentioned].sort((a, b) => b.score - a.score);
    const best = ranked[0].ticker.replace(/\.CA$/i, "");
    const answer =
      lang === "en"
        ? `Compared on trend/EMAs/volume/RSI/MACD/S-R/ATR/R:R, ${best} ranks highest (${ranked[0].score}/100).`
        : `بالمقارنة متعدد العوامل (الاتجاه/EMA/الحجم/RSI/MACD/المستويات/ATR والعائدـمخاطرة)، الأعلى تقييمًا حاليًا: ${best} بـ ${ranked[0].score}/100.`;
    return { answer, picks };
  }

  if (intent) {
    const items =
      intent.type === "weak"
        ? [...analyses].sort((a, b) => a.score - b.score).slice(0, intent.limit)
        : scanAnalyses(analyses, intent.type, intent.limit);
    const titles = {
      top: lang === "en" ? "Top multi-factor candidates today" : "أفضل المرشحين اليوم حسب تقييم متعدد العوامل",
      rsi: lang === "en" ? "RSI under 30 (possible bounce)" : "أسهم RSI أقل من 30 (ارتداد محتمل)",
      macd: lang === "en" ? "MACD buy signals" : "أسهم بإشارة شراء من MACD",
      breakout: lang === "en" ? "Resistance breaks with high volume" : "كسر مقاومة مع حجم مرتفع",
      accumulation: lang === "en" ? "Exiting accumulation" : "خروج من مرحلة التجميع",
      scalp: lang === "en" ? "Same-session scalp candidates" : "أسهم مضاربة لنفس الجلسة",
      week: lang === "en" ? "Weekly swing candidates" : "ترشيحات أسبوعية",
      weak: lang === "en" ? "Weakest multi-factor scores now" : "أضعف التقييمات متعدد العوامل دلوقتي",
    };
    const planOf = (a) => (intent.type === "week" ? a.week : intent.type === "scalp" ? a.scalp : null);
    const list = items
      .map((a, i) => {
        const plan = planOf(a);
        if (plan) {
          return `${i + 1}) ${a.ticker.replace(/\.CA$/i, "")} — اشتري ${plan.buy} · ابيع ${plan.sell} · وقف ${plan.stop} (${plan.score || a.score}/100)`;
        }
        return `${i + 1}) ${a.ticker.replace(/\.CA$/i, "")} — ${a.score}/100 — دخول ${a.trade.entry} · وقف ${a.trade.stopLoss} · هدف1 ${a.trade.target1}`;
      })
      .join("\n");
    const answer =
      items.length === 0
        ? lang === "en"
          ? "No stocks matched this screen right now."
          : "مفيش أسهم مطابقة للفحص ده دلوقتي."
        : `${titles[intent.type] || titles.top}:\n${list}`;
    return {
      answer,
      picks: items.map((a) => {
        const plan = planOf(a);
        return pickFromAnalysis(a, {
          action:
            intent.type === "weak"
              ? a.score <= 35
                ? "sell"
                : "hold"
              : plan || a.score >= 60
                ? "buy"
                : a.score <= 35
                  ? "sell"
                  : "hold",
          confidence: plan?.score || a.score,
          entry: plan?.buy ?? a.trade.entry,
          stopLoss: plan?.stop ?? a.trade.stopLoss,
          target1: plan?.sell ?? a.trade.target1,
          reason: (plan?.reasons || a.reasons).join(" · "),
        });
      }),
    };
  }

  // Free-chat fallback for local assistant — never invent; teach usable phrases + show a few tops.
  const top = (screens?.top?.length ? screens.top : scanAnalyses(analyses, "top", 5)).slice(0, 5);
  const tip =
    lang === "en"
      ? "Local assistant only. Try: “pick 5”, “RSI under 30”, “MACD”, “breakout”, “accumulation”, “scalp”, “compare COMI ORAS”, or “COMI score”."
      : "المساعد المحلي بيفهم قواعد ثابتة فقط. جرّب: «رشحلي 5»، «RSI أقل من 30»، «MACD»، «كسر مقاومة»، «خروج من تجميع»، «مضاربة»، «قارن COMI وORAS»، أو «تحليل COMI».";
  const list = top
    .map((a, i) => `${i + 1}) ${a.ticker.replace(/\.CA$/i, "")} ${a.score}/100`)
    .join(lang === "en" ? ", " : "، ");
  return {
    answer:
      lang === "en"
        ? `${tip}\nCurrent top scores: ${list || "n/a"}.`
        : `${tip}\nأعلى التقييمات الآن: ${list || "—"}.`,
    picks: top.map((a) => pickFromAnalysis(a)),
  };
}

async function answerLocalQuestion(question, lang) {
  const market = await loadMarket();
  const analyses = analyzeUniverse(market.results);
  const screens = {
    top: scanAnalyses(analyses, "top", 10),
    rsi: scanAnalyses(analyses, "rsi", 10),
    macd: scanAnalyses(analyses, "macd", 10),
    breakout: scanAnalyses(analyses, "breakout", 10),
    accumulation: scanAnalyses(analyses, "accumulation", 10),
    scalp: scanAnalyses(analyses, "scalp", 8),
    week: scanAnalyses(analyses, "week", 8),
  };
  const fundMap = await loadFundamentalsMap();
  const local = localAnswerFromScan(question, lang, analyses, screens);
  return {
    ...local,
    picks: attachFundamentals(local.picks || [], fundMap),
    disclaimer:
      lang === "en"
        ? "Local rules engine — educational only, not investment advice."
        : "محرك قواعد محلي — تحليل تعليمي فقط، مش نصيحة استثمارية.",
    screens: {
      top: screens.top.length,
      rsi: screens.rsi.length,
      macd: screens.macd.length,
      breakout: screens.breakout.length,
      accumulation: screens.accumulation.length,
      scalp: screens.scalp.length,
      week: screens.week.length,
    },
    source: "scanner",
  };
}

async function answerQuestion(question, lang, ai = {}) {
  const market = await loadMarket();
  const analyses = analyzeUniverse(market.results);
  const langLabel = lang === "en" ? "English" : "Arabic";

  const screens = {
    top: scanAnalyses(analyses, "top", 10),
    rsi: scanAnalyses(analyses, "rsi", 10),
    macd: scanAnalyses(analyses, "macd", 10),
    breakout: scanAnalyses(analyses, "breakout", 10),
    accumulation: scanAnalyses(analyses, "accumulation", 10),
    scalp: scanAnalyses(analyses, "scalp", 8),
    week: scanAnalyses(analyses, "week", 8),
  };

  // Is a usable AI provider configured (user key via headers, or server .env)?
  const provider = normalizeProvider(ai.provider);
  const aiReady =
    provider === "openai"
      ? Boolean(ai.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim())
      : Boolean(ai.apiKey?.trim() || process.env.CURSOR_API_KEY?.trim());

  const fundMap = await loadFundamentalsMap();

  const local = localAnswerFromScan(question, lang, analyses, screens);
  // Fast path for common scan intents — only when NO AI is configured, so
  // that when a key is set the recommendations go through AI + fundamentals.
  if (local && detectIntent(question) && !aiReady) {
    return {
      ...local,
      picks: attachFundamentals(local.picks, fundMap),
      disclaimer:
        lang === "en"
          ? "Educational analysis only — not investment advice."
          : "تحليل تعليمي فقط — مش نصيحة استثمارية.",
      screens: {
        top: screens.top.length,
        rsi: screens.rsi.length,
        macd: screens.macd.length,
        breakout: screens.breakout.length,
        accumulation: screens.accumulation.length,
        scalp: screens.scalp.length,
      week: screens.week.length,
      },
      source: "scanner",
    };
  }

  const mentioned = mentionTickers(question, analyses);
  const intent = detectIntent(question);
  const planKey = intent?.type === "week" ? "week" : intent?.type === "scalp" ? "scalp" : null;
  const screenRows = planKey ? attachFundamentals(screens[planKey], fundMap) : [];
  const universe = planKey
    ? compactScreenForAi(screenRows, planKey)
    : attachFundamentals(compactForAi(analyses, 25), fundMap);
  const focus =
    mentioned.length > 0
      ? attachFundamentals(
          mentioned.slice(0, 6).map((a) => compactForAi([a], 1)[0]),
          fundMap
        )
      : [];

  const lockRule = planKey
    ? `LOCKED SCREEN: You MUST pick ONLY from Snapshot tickers. Copy buy/sell/stop EXACTLY from Snapshot (do not invent prices). You may reorder or drop names, never add new tickers.`
    : `picks max 8, from data only. Lower confidence when considerations.conflict, thin liquidity, or weak fundamentals.`;

  const prompt = `You are an EGX multi-factor assistant. Do NOT modify files.
Answers and picks must be LOGICAL and combine technicals WITH company fundamentals.

${DECISION_CHECKLIST}

Answer in ${langLabel}. Mention sector/liquidity/RS when relevant. Prefer hold when mixed.

Each snapshot/focus item may include a "fundamentals" object scraped from Mubasher:
{ marketCap, pe (P/E), eps (EPS), bookValue, pb (P/B), capital, shares, currency }.
USE these real numbers in your reasoning and cite them:
- Reward reasonable/low P/E with positive EPS and healthy technicals.
- Treat negative EPS, negative book value, or an extreme/negative P/E as a valuation RISK and lower confidence (or prefer hold/sell).
- Favor higher market-cap (more liquid) names when signals are otherwise similar.
Only say a metric is "غير متاح"/"n/a" if it is missing from that item's fundamentals.

${lockRule}

Question: ${question}

Screen counts: top=${screens.top.length}, rsi<30=${screens.rsi.length}, macdBuy=${screens.macd.length}, breakout=${screens.breakout.length}, exitAccum=${screens.accumulation.length}, scalp=${screens.scalp.length}, week=${screens.week.length}
Top tickers: ${screens.top.slice(0, 8).map((a) => a.ticker.replace(/\.CA$/i, "") + ":" + a.score).join(", ")}
Focus: ${JSON.stringify(focus)}
Snapshot: ${JSON.stringify(universe)}

Return ONLY JSON:
{"answer":"...","picks":[{"ticker":"COMI","action":"buy|sell|hold","confidence":85,"entry":0,"stopLoss":0,"target1":0,"target2":0,"reason":"...tech + fundamentals (cite P/E, EPS) + sector...","signals":["trend_up","high_volume"]}],"disclaimer":"..."}
${lockRule}`;

  try {
    const text = await runAgent(prompt, ai);
    const parsed = extractJson(text);
    let picks = Array.isArray(parsed?.picks)
      ? parsed.picks.map((p) => normalizePick(p)).filter(Boolean).slice(0, 10)
      : [];
    if (planKey) {
      picks = bindPicksToScreen(picks, screenRows, planKey);
      if (!picks.length) picks = local?.picks || [];
    }

    if (parsed?.answer || picks.length) {
      return {
        answer: String(parsed?.answer || "").slice(0, 2000) || (local?.answer ?? ""),
        picks: attachFundamentals(picks.length ? picks : local?.picks || [], fundMap),
        disclaimer:
          String(parsed?.disclaimer || "").slice(0, 240) ||
          (lang === "en"
            ? "Educational analysis only — not investment advice."
            : "تحليل تعليمي فقط — مش نصيحة استثمارية."),
        screens: {
          top: screens.top.length,
          rsi: screens.rsi.length,
          macd: screens.macd.length,
          breakout: screens.breakout.length,
          accumulation: screens.accumulation.length,
          scalp: screens.scalp.length,
      week: screens.week.length,
        },
        source: "agent",
      };
    }
  } catch (err) {
    console.error("[ask agent]", err.message);
  }

  if (local) {
    return {
      ...local,
      picks: attachFundamentals(local.picks, fundMap),
      disclaimer:
        lang === "en"
          ? "Educational analysis only — not investment advice."
          : "تحليل تعليمي فقط — مش نصيحة استثمارية.",
      screens: {
        top: screens.top.length,
        rsi: screens.rsi.length,
        macd: screens.macd.length,
        breakout: screens.breakout.length,
        accumulation: screens.accumulation.length,
        scalp: screens.scalp.length,
      week: screens.week.length,
      },
      source: "scanner-fallback",
    };
  }

  return {
    answer:
      lang === "en"
        ? `Top multi-factor picks: ${screens.top
            .slice(0, 5)
            .map((a) => a.ticker.replace(/\.CA$/i, ""))
            .join(", ")}`
        : `أفضل الترشيحات متعدد العوامل: ${screens.top
            .slice(0, 5)
            .map((a) => a.ticker.replace(/\.CA$/i, ""))
            .join("، ")}`,
    picks: attachFundamentals(
      screens.top.slice(0, 5).map((a) =>
        normalizePick({
          ticker: a.ticker,
          action: a.score >= 60 ? "buy" : "hold",
          confidence: a.score,
          entry: a.trade.entry,
          stopLoss: a.trade.stopLoss,
          target1: a.trade.target1,
          target2: a.trade.target2,
          reason: a.reasons.join(" · "),
          signals: a.signals,
        })
      ),
      fundMap
    ),
    disclaimer:
      lang === "en"
        ? "Educational analysis only — not investment advice."
        : "تحليل تعليمي فقط — مش نصيحة استثمارية.",
    screens: {
      top: screens.top.length,
      rsi: screens.rsi.length,
      macd: screens.macd.length,
      breakout: screens.breakout.length,
      accumulation: screens.accumulation.length,
      scalp: screens.scalp.length,
      week: screens.week.length,
    },
    source: "scanner-fallback",
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      const meta = await readLatestMeta();
      const scrape = marketStatus();
      return sendJson(res, 200, {
        ok: true,
        marketReady: meta.exists && meta.count > 0,
        market: {
          exists: meta.exists,
          quotes: meta.count,
          scrapedAt: meta.scrapedAt,
          stale: meta.stale,
          scraping: scrape.scraping,
          lastError: scrape.lastError,
        },
        hasKey: Boolean(process.env.CURSOR_API_KEY?.trim()),
        providers: {
          cursor: { serverKey: Boolean(process.env.CURSOR_API_KEY?.trim()) },
          openai: { serverKey: Boolean(process.env.OPENAI_API_KEY?.trim()) },
        },
        defaultProvider: normalizeProvider(),
        fundsPhoto: true,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/refresh") {
      const secret = process.env.REFRESH_SECRET?.trim();
      if (secret) {
        const provided =
          req.headers["x-refresh-secret"] || url.searchParams.get("secret") || "";
        if (provided !== secret) {
          return sendJson(res, 401, { error: "Unauthorized" });
        }
      }
      const scrape = marketStatus();
      if (scrape.scraping) {
        return sendJson(res, 202, { ok: true, scraping: true, message: "Scrape already running" });
      }
      startScrape("api-refresh").catch(() => {});
      return sendJson(res, 202, { ok: true, scraping: true, message: "Scrape started" });
    }

    if (req.method === "GET" && url.pathname === "/api/analyze") {
      const ticker = normalizeTicker(url.searchParams.get("ticker"));
      if (!ticker) return sendJson(res, 400, { error: "ticker is required" });
      const market = await loadMarket();
      const quote = findQuote(market.results, ticker);
      if (!quote) return sendJson(res, 404, { error: `Stock not found: ${ticker}` });
      const analyses = analyzeUniverse(market.results);
      const analysis = analyses.find((a) => normalizeTicker(a.ticker) === ticker);
      if (!analysis) {
        return sendJson(res, 422, { error: "Not enough candle data for analysis" });
      }
      return sendJson(res, 200, {
        scrapedAt: market.scrapedAt,
        range: market.range,
        analysis,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/company") {
      const ticker = normalizeTicker(url.searchParams.get("ticker"));
      if (!ticker) return sendJson(res, 400, { error: "ticker is required" });
      const code = ticker.replace(/\.CA$/i, "");
      const hit = mubasherCache.get(code);
      if (hit && Date.now() - hit.ts < MUBASHER_TTL_MS) {
        return sendJson(res, 200, { ...hit.data, cached: true });
      }
      const data = await fetchMubasherStock(ticker);
      mubasherCache.set(code, { ts: Date.now(), data });
      return sendJson(res, 200, { ...data, cached: false });
    }

    if (req.method === "GET" && url.pathname === "/api/depth") {
      const ticker = normalizeTicker(url.searchParams.get("ticker"));
      if (!ticker) return sendJson(res, 400, { error: "ticker is required" });
      const market = await loadMarket();
      const quote = findQuote(market.results, ticker);
      if (!quote) return sendJson(res, 404, { error: `Stock not found: ${ticker}` });
      const levels = Number(url.searchParams.get("levels") || 10);
      const depth = buildPriceDepth(quote, { levels });
      return sendJson(res, 200, {
        ticker: quote.ticker,
        nameAr: quote.nameAr,
        nameEn: quote.nameEn,
        scrapedAt: market.scrapedAt,
        range: market.range,
        ...depth,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/scan") {
      const rawType = url.searchParams.get("type") || "top";
      const type = SCAN_TYPES.includes(rawType) ? rawType : "top";
      const limit = Number(url.searchParams.get("limit") || 10);
      const market = await loadMarket();
      const analyses = analyzeUniverse(market.results);
      const fundMap = await loadFundamentalsMap();
      let items = attachFundamentals(scanAnalyses(analyses, type, limit), fundMap);
      if (type === "scalp") items = items.filter((i) => i.scalp?.eligible);
      if (type === "week") items = items.filter((i) => i.week?.eligible);
      return sendJson(res, 200, {
        type,
        scrapedAt: market.scrapedAt,
        range: market.range,
        count: items.length,
        items,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/funds") {
      const market = await loadMarket();
      const analyses = analyzeUniverse(market.results);
      const items = scoreThndrFunds(analyses);
      return sendJson(res, 200, {
        scrapedAt: market.scrapedAt,
        range: market.range,
        source: "thndr-public-catalog",
        note: "Stances use EGX tape, not live fund NAVs from Thndr.",
        count: items.length,
        items,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/funds-photo") {
      const body = await readBody(req);
      const image = String(body.image || "");
      const ai = aiConfigFromReq(req, body);
      const holdings = await runFundsPhotoExtract(image, ai);
      return sendJson(res, 200, { holdings, count: holdings.length });
    }

    if (req.method === "POST" && url.pathname === "/api/funds-advice") {
      const body = await readBody(req);
      const ai = aiConfigFromReq(req, body);
      const advice = await runFundsAdvice(body, ai);
      return sendJson(res, 200, advice);
    }

    if (req.method === "POST" && url.pathname === "/api/ai-ping") {
      const body = await readBody(req, { maxBytes: 8_000 });
      const ai = aiConfigFromReq(req, body);
      const result = await runAiPing(ai);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/ask") {
      const body = await readBody(req);
      const question = String(body.question || body.q || "").trim();
      if (!question) return sendJson(res, 400, { error: "question is required" });
      if (question.length > 2000) return sendJson(res, 400, { error: "question too long" });
      const lang = body.lang === "en" ? "en" : "ar";
      const mode = String(body.mode || "").toLowerCase() === "local" ? "local" : "ai";
      if (mode === "local") {
        const result = await answerLocalQuestion(question, lang);
        return sendJson(res, 200, result);
      }
      const ai = aiConfigFromReq(req, body);
      const result = await answerQuestion(question, lang, ai);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/suggest") {
      const body = await readBody(req);
      const ticker = normalizeTicker(body.ticker);
      if (!ticker) return sendJson(res, 400, { error: "ticker is required" });
      const lang = body.lang === "en" ? "en" : "ar";
      const market = await loadMarket();
      const quote = findQuote(market.results, ticker);
      if (!quote) return sendJson(res, 404, { error: `Stock not found: ${ticker}` });
      const ai = aiConfigFromReq(req, body);
      const suggestion = await buildSuggestion(quote, lang, ai);
      return sendJson(res, 200, { ticker: quote.ticker, suggestion });
    }

    if (req.method === "POST" && url.pathname === "/api/suggest-scalp") {
      const body = await readBody(req);
      const ticker = normalizeTicker(body.ticker);
      if (!ticker) return sendJson(res, 400, { error: "ticker is required" });
      const lang = body.lang === "en" ? "en" : "ar";
      const market = await loadMarket();
      const quote = findQuote(market.results, ticker);
      if (!quote) return sendJson(res, 404, { error: `Stock not found: ${ticker}` });
      const ai = aiConfigFromReq(req, body);
      const suggestion = await buildScalpSuggestion(quote, lang, ai);
      return sendJson(res, 200, { ticker: quote.ticker, suggestion });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    const status = err.status || (err instanceof CursorAgentError ? 502 : 500);
    console.error("[api]", err);
    return sendJson(res, status, {
      error: err.message || String(err),
      retryable:
        typeof err.retryable === "boolean"
          ? err.retryable
          : err instanceof CursorAgentError
            ? Boolean(err.isRetryable)
            : false,
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`EGX API listening on http://0.0.0.0:${PORT}`);
  console.log(`CURSOR_API_KEY ${process.env.CURSOR_API_KEY?.trim() ? "loaded" : "MISSING"}`);
  ensureMarketData()
    .then(({ ready, meta, scraping }) => {
      if (ready) {
        console.log(`[market] ready — ${meta.count} quotes · scrapedAt ${meta.scrapedAt}`);
      } else if (scraping) {
        console.log("[market] latest.json missing/empty — scrape started in background");
      } else {
        console.warn("[market] not ready and scrape not started");
      }
    })
    .catch((err) => console.error("[market] ensure failed:", err?.message || err));
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[api] port ${PORT} already in use — stop the other process or run: lsof -ti:${PORT} | xargs kill -9`);
    process.exit(1);
  }
  console.error("[api]", err);
  process.exit(1);
});
