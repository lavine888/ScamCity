#!/usr/bin/env node
/**
 * Verify the optional LLM adapter against an OpenAI-compatible gateway
 * (e.g. the OpenAI Next Credits gateway at https://api.openai-next.com/v1).
 *
 *   npm run llm:check
 *
 * Reads .env.local / .env / process.env, then performs a real chat-completions
 * call and reports exactly what failed. Never prints the full API key.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

function loadEnvFile(name) {
  const path = resolve(ROOT, name);
  if (!existsSync(path)) return {};
  const out = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = { ...loadEnvFile(".env"), ...loadEnvFile(".env.local") };
const env = { ...fileEnv, ...process.env };

const enabled = env.LLM_ENABLED === "true";
const apiKey = env.OPENAI_API_KEY ?? "";
const baseUrl = (env.OPENAI_BASE_URL || "https://api.openai-next.com/v1").replace(/\/+$/, "");
const model = env.OPENAI_MODEL || "gpt-5.6-sol";
const maxTokens = Number(env.LLM_MAX_TOKENS) > 0 ? Math.floor(Number(env.LLM_MAX_TOKENS)) : 1200;
const timeoutMs = Number(env.LLM_TIMEOUT_MS) > 0 ? Math.floor(Number(env.LLM_TIMEOUT_MS)) : 20000;

const mask = (key) => (key ? `${key.slice(0, 6)}...${key.slice(-4)} (${key.length} chars)` : "(empty)");

console.log("LLM adapter configuration");
console.log(`  LLM_ENABLED     ${enabled}`);
console.log(`  OPENAI_BASE_URL ${baseUrl}`);
console.log(`  OPENAI_MODEL    ${model}`);
console.log(`  LLM_MAX_TOKENS  ${maxTokens}`);
console.log(`  LLM_TIMEOUT_MS  ${timeoutMs}`);
console.log(`  OPENAI_API_KEY  ${mask(apiKey)}`);
console.log("");

if (!apiKey) {
  console.error("FAIL: OPENAI_API_KEY is empty.");
  console.error("Create a key in the activity console, then put it in .env.local:");
  console.error("  OPENAI_API_KEY=sk-...");
  process.exit(1);
}
if (!enabled) {
  console.error("FAIL: LLM_ENABLED is not \"true\".");
  console.error("Set LLM_ENABLED=true in .env.local to activate the optional adapter.");
  process.exit(1);
}

async function call(label, body, headers) {
  const started = Date.now();
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    console.log(`  ${label}: NETWORK ERROR -> ${error instanceof Error ? error.message : error}`);
    console.log("  Hint: if this is a 524 / timeout, retry with OPENAI_BASE_URL=https://us.api.openai-next.com/v1");
    return false;
  }
  const latency = Date.now() - started;
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = undefined;
  }
  if (!response.ok) {
    const message = payload?.error?.message ?? text.slice(0, 300);
    console.log(`  ${label}: HTTP ${response.status} -> ${message}`);
    if (response.status === 401) console.log("  Hint: key is invalid or disabled in the console.");
    if (response.status === 404) console.log("  Hint: base URL must end in /v1 for the OpenAI-compatible protocol.");
    if (response.status === 429) {
      const saturated = /饱和|saturat|overload|busy/i.test(message);
      console.log(
        saturated
          ? "  Hint: upstream capacity is saturated, not your quota. This is transient — retry in a few seconds."
          : "  Hint: quota exhausted. Disable the key to release unused credit, or request more.",
      );
    }
    if (response.status === 400) console.log("  Hint: this model may reject temperature / max_tokens / response_format. Try a non-reasoning model.");
    return false;
  }
  const content = payload?.choices?.[0]?.message?.content ?? "";
  console.log(`  ${label}: OK in ${latency}ms`);
  console.log(`    reply: ${JSON.stringify(String(content).slice(0, 200))}`);
  if (payload?.usage) console.log(`    usage: ${JSON.stringify(payload.usage)}`);
  return true;
}

console.log("Probing gateway...");
const bearer = { Authorization: `Bearer ${apiKey}` };

// Probe 1 mirrors exactly what agents/llm-adapter.ts sends.
const adapterCompatible = await call(
  `adapter-shaped request (json_object, temperature=0, max_tokens=${maxTokens})`,
  {
    model,
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a synthetic citizen in a fraud simulation. Return JSON only with decision (ignore|engage|trust|click|transfer), thought, and reason.",
      },
      { role: "user", content: JSON.stringify({ strategy: "phishing-link", probability: 0.71 }) },
    ],
  },
  bearer,
);

// Probe 2 is the lowest common denominator, to isolate model-side restrictions.
let minimal = false;
if (!adapterCompatible) {
  console.log("");
  console.log("Retrying with a minimal request to isolate the cause...");
  minimal = await call(
    "minimal request (no temperature / max_tokens / response_format)",
    { model, messages: [{ role: "user", content: "Reply with the single word: ok" }] },
    bearer,
  );
}

console.log("");
if (adapterCompatible) {
  console.log("RESULT: gateway reachable and adapter-compatible. Set LLM_ENABLED=true and restart `npm run dev`.");
  process.exit(0);
}
if (minimal) {
  console.log("RESULT: gateway works, but this model rejects the adapter's request shape.");
  console.log("        Pick a non-reasoning model in OPENAI_MODEL (e.g. gpt-5.6-sol) or relax the adapter payload.");
  process.exit(2);
}
console.log("RESULT: gateway call failed. See the hints above.");
process.exit(1);
