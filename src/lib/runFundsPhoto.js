import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "@cursor/sdk";
import { fundsPhotoPrompt, normalizeExtractedHoldings } from "./thndrFunds.js";

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

async function runOpenAiVision(prompt, ai, imageDataUrl) {
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
      temperature: 0.1,
      max_tokens: 8000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You read Thndr fund screenshots. Extract EVERY visible fund row. Reply with a SINGLE JSON object only." },
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
    throw Object.assign(new Error(data.error?.message || `OpenAI HTTP ${res.status}`), {
      status: res.status === 401 ? 400 : 502,
    });
  }
  return data.choices?.[0]?.message?.content || "";
}

async function runCursorVision(prompt, ai, imagePath) {
  const apiKey = ai.apiKey?.trim() || process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(
      new Error("Cursor API key is missing (set it in Settings)"),
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
      local: { cwd: ROOT },
      tools: ["read"],
    });
    const run = await agent.send(`${prompt}\nRead the image file at: ${imagePath}`);
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
    const withJson = candidates.find((t) => extractJson(t)?.holdings);
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

/** Extract fund rows from a data-URL screenshot using Cursor or OpenAI. */
export async function runFundsPhotoExtract(imageDataUrl, ai = {}) {
  if (!String(imageDataUrl || "").startsWith("data:image/")) {
    throw Object.assign(new Error("image data URL is required"), { status: 400 });
  }
  const prompt = fundsPhotoPrompt();
  const provider = providerOf(ai);
  let imagePath = "";
  try {
    let text = "";
    if (provider === "openai") {
      text = await runOpenAiVision(prompt, ai, imageDataUrl);
    } else {
      const buf = Buffer.from(String(imageDataUrl).split(",")[1] || "", "base64");
      imagePath = path.join(os.tmpdir(), `egx-funds-${Date.now()}.jpg`);
      await fs.writeFile(imagePath, buf);
      text = await runCursorVision(prompt, ai, imagePath);
    }
    const parsed = extractJson(text) || {};
    return normalizeExtractedHoldings(parsed.holdings || parsed.funds || []);
  } finally {
    if (imagePath) await fs.unlink(imagePath).catch(() => {});
  }
}

export function readJsonBody(req, { maxBytes = 8_000_000 } = {}) {
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
        reject(Object.assign(new Error("Invalid JSON body"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

export async function handleFundsPhotoHttp(req, res) {
  const body = await readJsonBody(req);
  const image = String(body.image || "");
  const ai = {
    provider: req.headers["x-ai-provider"] || body.provider,
    apiKey: req.headers["x-ai-key"] || body.apiKey,
    model: req.headers["x-ai-model"] || body.model,
  };
  const holdings = await runFundsPhotoExtract(image, ai);
  const payload = JSON.stringify({ holdings, count: holdings.length });
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(payload);
}
