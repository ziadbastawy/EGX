import { Agent } from "@cursor/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THNDR_FUNDS } from "./thndrFunds.js";
import { readJsonBody } from "./runFundsPhoto.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function extractJson(text) {
  if (!text) return null;
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : String(text)).trim();
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

function providerOf(ai = {}) {
  const p = String(ai.provider || "").toLowerCase();
  if (p === "openai" || p === "chatgpt" || p === "gpt") return "openai";
  return "cursor";
}

function fundsAdvicePrompt({ lang, holdings, catalog, outside }) {
  const langLabel = lang === "en" ? "English" : "Arabic";
  return `You advise on Egyptian Thndr mutual funds. Educational only, not investment advice.
Settlement: buys and sells skip ONE trading session (order today → next session). Never suggest same-session execution. This is processing delay, NOT a forecast that the next session will rise.

USER HOLDINGS (current EGP, % P/L, local tape stance):
${JSON.stringify(holdings, null, 2)}

OUTSIDE BUY IDEAS (not in the list, tape says add):
${JSON.stringify(outside || [], null, 2)}

ALL FUNDS TAPE STANCE:
${JSON.stringify(catalog || [], null, 2)}

Look at EVERY holding and the rest of the catalog. Tell the user exactly what to do:
add / reduce / sell all / hold, with an EGP amount when not hold.
You may suggest buying a fund they do not hold if the tape supports it.

Reply in ${langLabel} inside JSON only:
{
  "summary": "short overall plan",
  "actions": [
    {"code":"AZO","name":"...","action":"add|reduce|sell_all|hold","egp":1500,"why":"..."}
  ]
}
action must be one of add, reduce, sell_all, hold. egp is 0 for hold.
Include an action for every holding, then optional extra buy-outside rows.`;
}

async function runOpenAi(prompt, ai) {
  const apiKey = ai.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(new Error("OpenAI API key is missing (set it in Settings)"), { status: 400 });
  }
  const model = ai.model?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Reply with a SINGLE JSON object only." },
        { role: "user", content: prompt },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error?.message || `OpenAI HTTP ${res.status}`), {
      status: res.status === 401 ? 400 : 502,
    });
  }
  return data.choices?.[0]?.message?.content || "";
}

async function runCursor(prompt, ai) {
  const apiKey = ai.apiKey?.trim() || process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(new Error("Cursor API key is missing (set it in Settings)"), { status: 400 });
  }
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = apiKey;
  let agent;
  try {
    agent = await Agent.create({
      apiKey,
      model: { id: ai.model?.trim() || "composer-2.5" },
      local: { cwd: ROOT },
    });
    const run = await agent.send(prompt);
    let assistantText = "";
    for await (const event of run.stream()) {
      if (event.type !== "assistant") continue;
      for (const block of event.message?.content || []) {
        if (block.type === "text" && block.text) assistantText += block.text;
      }
    }
    const result = await run.wait();
    if (result.status !== "finished") {
      throw Object.assign(
        new Error(result.error?.message || `Agent status: ${result.status}`),
        { status: 502 }
      );
    }
    const candidates = [result.result || "", assistantText].filter(Boolean);
    const withJson = candidates.find((t) => extractJson(t)?.actions || extractJson(t)?.summary);
    return withJson || candidates.sort((a, b) => b.length - a.length)[0] || "";
  } finally {
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
    try {
      if (agent && typeof agent[Symbol.asyncDispose] === "function") await agent[Symbol.asyncDispose]();
      else if (agent && typeof agent.close === "function") await agent.close();
    } catch {
      /* ignore */
    }
  }
}

function normalizeAdvice(parsed) {
  const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
  const allowed = new Set(["add", "reduce", "sell_all", "hold"]);
  return {
    summary: String(parsed?.summary || parsed?.summaryAr || parsed?.summaryEn || "").trim(),
    actions: actions.slice(0, 40).map((a) => {
      const code = String(a.code || "").toUpperCase().trim();
      const fund = THNDR_FUNDS.find((f) => f.code === code);
      const action = allowed.has(a.action) ? a.action : "hold";
      const egp = Number(a.egp);
      return {
        code: code || "—",
        name: String(a.name || fund?.nameAr || fund?.nameEn || "").trim(),
        action,
        egp: Number.isFinite(egp) && egp > 0 ? Math.round(egp) : 0,
        why: String(a.why || a.whyAr || a.whyEn || "").trim(),
      };
    }),
  };
}

export async function runFundsAdvice(body, ai = {}) {
  const lang = body.lang === "en" ? "en" : "ar";
  const holdings = Array.isArray(body.holdings) ? body.holdings.slice(0, 40) : [];
  if (!holdings.length) {
    throw Object.assign(new Error("holdings are required"), { status: 400 });
  }
  const prompt = fundsAdvicePrompt({
    lang,
    holdings,
    catalog: Array.isArray(body.catalog) ? body.catalog.slice(0, 50) : [],
    outside: Array.isArray(body.outside) ? body.outside.slice(0, 10) : [],
  });
  const text =
    providerOf(ai) === "openai" ? await runOpenAi(prompt, ai) : await runCursor(prompt, ai);
  const parsed = extractJson(text) || {};
  return normalizeAdvice(parsed);
}

export async function handleFundsAdviceHttp(req, res) {
  const body = await readJsonBody(req, { maxBytes: 400_000 });
  const ai = {
    provider: req.headers["x-ai-provider"] || body.provider,
    apiKey: req.headers["x-ai-key"] || body.apiKey,
    model: req.headers["x-ai-model"] || body.model,
  };
  const advice = await runFundsAdvice(body, ai);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(advice));
}
