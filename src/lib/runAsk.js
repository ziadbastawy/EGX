import { Agent } from "@cursor/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

function askPrompt(question, lang) {
  const langLabel = lang === "en" ? "English" : "Arabic";
  return `You help with Egyptian Thndr mutual funds and EGX context. Educational only, not investment advice.
Settlement: buys and sells skip ONE trading session (order today → next session). Never suggest same-session execution. This is processing delay, NOT a forecast that the next session will rise.

Question:
${question}

Reply in ${langLabel} inside JSON only:
{"answer":"..."}`;
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
      max_tokens: 2000,
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
    const withJson = candidates.find((t) => extractJson(t)?.answer);
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

export async function runAsk(body, ai = {}) {
  const question = String(body.question || body.q || "").trim();
  if (!question) {
    throw Object.assign(new Error("question is required"), { status: 400 });
  }
  if (question.length > 2000) {
    throw Object.assign(new Error("question too long"), { status: 400 });
  }
  const lang = body.lang === "en" ? "en" : "ar";
  const prompt = askPrompt(question, lang);
  const text =
    providerOf(ai) === "openai" ? await runOpenAi(prompt, ai) : await runCursor(prompt, ai);
  const parsed = extractJson(text);
  const answer = String(parsed?.answer || text || "").trim();
  if (!answer) {
    throw Object.assign(new Error("empty AI answer"), { status: 502 });
  }
  return { answer: answer.slice(0, 4000), source: "agent" };
}

export async function handleAskHttp(req, res) {
  const body = await readJsonBody(req, { maxBytes: 80_000 });
  const ai = {
    provider: req.headers["x-ai-provider"] || body.provider,
    apiKey: req.headers["x-ai-key"] || body.apiKey,
    model: req.headers["x-ai-model"] || body.model,
  };
  const result = await runAsk(body, ai);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(result));
}
