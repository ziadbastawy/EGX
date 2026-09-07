import { fundsPhotoPrompt, normalizeExtractedHoldings } from "../../../src/lib/thndrFunds.js";

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function holdingsFromAiText(text) {
  const parsed = extractJson(text) || {};
  return normalizeExtractedHoldings(parsed.holdings || parsed.funds || []);
}

export async function extractWithOpenAI(imageDataUrl, { apiKey, model } = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("missing openai key");
  const prompt = fundsPhotoPrompt();

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: String(model || "").trim() || "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 8000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You read Thndr fund screenshots. Extract EVERY visible fund row. Reply with a SINGLE JSON object only.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
          ],
        },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI HTTP ${res.status}`);
  }
  return holdingsFromAiText(data.choices?.[0]?.message?.content || "");
}

async function extractViaApi(imageDataUrl, apiUrl, headers) {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify({ image: imageDataUrl }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 404 || res.status === 405) {
    const err = new Error("api missing");
    err.code = "API_MISSING";
    throw err;
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.holdings || [];
}

function photoEndpoints(apiUrl) {
  const urls = [];
  const add = (u) => {
    const s = String(u || "").trim();
    if (s && !urls.includes(s)) urls.push(s);
  };
  add(apiUrl);
  add("/api/funds-photo");
  return urls;
}

/**
 * Read a Thndr screenshot with AI (Cursor or OpenAI). Tries the configured
 * API host, then the local Vite /api route that uses the Settings key.
 */
export async function extractHoldingsFromPhoto(
  imageDataUrl,
  { apiUrl, headers, openaiKey, openaiModel } = {}
) {
  let apiMissing = false;
  let lastErr = null;
  for (const url of photoEndpoints(apiUrl)) {
    try {
      const holdings = await extractViaApi(imageDataUrl, url, headers);
      return { holdings, apiMissing: false };
    } catch (err) {
      lastErr = err;
      if (err.code === "API_MISSING" || /failed to fetch|networkerror|load failed/i.test(String(err.message))) {
        apiMissing = true;
        continue;
      }
      throw err;
    }
  }

  const key = String(openaiKey || "").trim();
  if (key) {
    const holdings = await extractWithOpenAI(imageDataUrl, { apiKey: key, model: openaiModel });
    return { holdings, apiMissing: false };
  }

  if (lastErr && lastErr.code !== "API_MISSING") throw lastErr;
  return { holdings: [], apiMissing };
}
