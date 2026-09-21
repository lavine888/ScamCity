#!/usr/bin/env node
/**
 * Set the OpenAI Next Credits API key everywhere it is needed, then verify it.
 *
 *   node scripts/set-openai-next-key.mjs <API_KEY>
 *   npm run llm:set-key -- <API_KEY>
 *
 * Updates:
 *   1. ~/.pi/agent/models.json  -> providers["openai-next"].apiKey   (pi itself)
 *   2. <project>/.env.local     -> OPENAI_API_KEY                    (ScamCity adapter)
 *
 * Then performs a live chat-completions probe so a bad token is caught
 * immediately instead of surfacing later as a 401 mid-session.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

const key = (process.argv[2] ?? "").trim();
if (!key) {
  console.error("Usage: node scripts/set-openai-next-key.mjs <API_KEY>");
  process.exit(1);
}
if (/^YOUR_|^<|PASTE/i.test(key)) {
  console.error(`FAIL: "${key}" looks like a placeholder, not a key.`);
  process.exit(1);
}

const PI_MODELS = join(homedir(), ".pi", "agent", "models.json");
const ENV_LOCAL = resolve(process.cwd(), ".env.local");
const BASE_URL = "https://api.openai-next.com/v1";
const MODEL = "deepseek-v4-1-flash-260910";
const PROVIDER = "openai-next";

const mask = (v) => `${v.slice(0, 6)}...${v.slice(-4)} (${v.length} chars)`;

function updatePiModels() {
  if (!existsSync(PI_MODELS)) {
    console.log(`  pi models.json: SKIPPED (not found at ${PI_MODELS})`);
    return false;
  }
  copyFileSync(PI_MODELS, `${PI_MODELS}.bak-${Date.now()}`);
  const config = JSON.parse(readFileSync(PI_MODELS, "utf8"));
  config.providers ??= {};
  config.providers[PROVIDER] ??= {
    name: "OpenAI Next Credits",
    baseUrl: BASE_URL,
    api: "openai-completions",
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    models: [{ id: MODEL, name: "DeepSeek V4.1 Flash (OpenAI Next)", input: ["text"], contextWindow: 128000, maxTokens: 32768 }],
  };
  const previous = config.providers[PROVIDER].apiKey;
  config.providers[PROVIDER].apiKey = key;
  writeFileSync(PI_MODELS, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`  pi models.json: updated providers["${PROVIDER}"].apiKey`);
  console.log(`    was ${previous ? mask(previous) : "(unset)"} -> now ${mask(key)}`);
  return true;
}

function updateEnvLocal() {
  const line = `OPENAI_API_KEY=${key}`;
  if (!existsSync(ENV_LOCAL)) {
    writeFileSync(ENV_LOCAL, `LLM_ENABLED=true\n${line}\nOPENAI_BASE_URL=${BASE_URL}\nOPENAI_MODEL=${MODEL}\n`);
    console.log("  .env.local: created");
    return true;
  }
  const original = readFileSync(ENV_LOCAL, "utf8");
  const updated = /^OPENAI_API_KEY=.*$/m.test(original)
    ? original.replace(/^OPENAI_API_KEY=.*$/m, line)
    : `${original.trimEnd()}\n${line}\n`;
  if (updated !== original) copyFileSync(ENV_LOCAL, `${ENV_LOCAL}.bak-${Date.now()}`);
  writeFileSync(ENV_LOCAL, updated);
  console.log("  .env.local: updated OPENAI_API_KEY");
  return true;
}

console.log("Writing key...");
updatePiModels();
updateEnvLocal();

console.log("");
console.log(`Probing ${BASE_URL}/chat/completions with ${MODEL} ...`);
const started = Date.now();
let response;
try {
  response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "Reply with exactly: OK" }] }),
    signal: AbortSignal.timeout(45_000),
  });
} catch (error) {
  console.error(`NETWORK ERROR: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const text = await response.text();
const latency = Date.now() - started;

if (!response.ok) {
  let message = text.slice(0, 300);
  try {
    message = JSON.parse(text)?.error?.message ?? message;
  } catch {
    // keep raw text
  }
  console.error(`FAIL: HTTP ${response.status} in ${latency}ms -> ${message}`);
  if (response.status === 401) {
    console.error("");
    console.error("The token was written to both files, but the gateway rejects it.");
    console.error("This is the activity ID problem: an API Key must be created explicitly.");
    console.error("Console -> activity detail page -> 「创建 API Key」 -> copy the token.");
  }
  if (response.status === 404) console.error("Base URL must end in /v1 for the OpenAI-compatible protocol.");
  if (response.status === 429) console.error("Quota exhausted. Disable the key to release unused credit, or request more.");
  process.exit(1);
}

let content = "";
try {
  content = JSON.parse(text)?.choices?.[0]?.message?.content ?? "";
} catch {
  // ignore
}
console.log(`OK in ${latency}ms`);
console.log(`  reply: ${JSON.stringify(String(content).slice(0, 200))}`);
console.log("");
console.log("Live. Both pi and the ScamCity adapter can now use this gateway.");
console.log(`  pi:  pi --model ${MODEL} -p "hello"`);
console.log("  app: npm run dev  ->  GET /api/llm/thoughts");
