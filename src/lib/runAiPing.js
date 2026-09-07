import { Agent } from "@cursor/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonBody } from "./runFundsPhoto.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function providerOf(ai = {}) {
  const p = String(ai.provider || "").toLowerCase();
  if (p === "openai" || p === "chatgpt" || p === "gpt") return "openai";
  return "cursor";
}

async function pingOpenAi(ai) {
  const apiKey = ai.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(new Error("OpenAI API key is missing"), { status: 400 });
  }
  const model = ai.model?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let res;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 16,
        messages: [
          { role: "system", content: "Reply with exactly: ok" },
          { role: "user", content: "ping" },
        ],
      }),
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw Object.assign(new Error("OpenAI ping timed out"), { status: 504 });
    }
    throw Object.assign(new Error(`OpenAI request failed: ${err.message}`), { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `OpenAI HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status === 401 ? 400 : 502 });
  }
  const text = String(data.choices?.[0]?.message?.content || "").trim();
  return { ok: true, provider: "openai", model, reply: text.slice(0, 80) || "ok" };
}

async function pingCursor(ai) {
  const apiKey = ai.apiKey?.trim() || process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(new Error("Cursor API key is missing"), { status: 400 });
  }
  const model = ai.model?.trim() || "composer-2.5";
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = apiKey;
  let agent;
  try {
    agent = await Agent.create({
      apiKey,
      model: { id: model },
      local: { cwd: ROOT },
    });
    const run = await agent.send("Reply with exactly one word: ok. Do not modify files.");
    let assistantText = "";
    const streamDone = (async () => {
      for await (const event of run.stream()) {
        if (event.type !== "assistant") continue;
        for (const block of event.message?.content || []) {
          if (block.type === "text" && block.text) assistantText += block.text;
        }
      }
    })();
    const result = await Promise.race([
      run.wait().then(async (r) => {
        await streamDone.catch(() => {});
        return r;
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Object.assign(new Error("Cursor ping timed out"), { status: 504 })),
          45_000
        )
      ),
    ]);
    if (result.status !== "finished") {
      throw Object.assign(
        new Error(result.error?.message || `Agent status: ${result.status}`),
        { status: 502 }
      );
    }
    const reply = String(result.result || assistantText || "ok").trim().slice(0, 80);
    return { ok: true, provider: "cursor", model, reply };
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

export async function runAiPing(ai = {}) {
  return providerOf(ai) === "openai" ? pingOpenAi(ai) : pingCursor(ai);
}

export async function handleAiPingHttp(req, res) {
  const body = await readJsonBody(req, { maxBytes: 8_000 });
  const ai = {
    provider: req.headers["x-ai-provider"] || body.provider,
    apiKey: req.headers["x-ai-key"] || body.apiKey,
    model: req.headers["x-ai-model"] || body.model,
  };
  const result = await runAiPing(ai);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(result));
}
