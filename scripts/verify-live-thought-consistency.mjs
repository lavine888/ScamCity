import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load the real TypeScript adapter without emitting files or calling a provider.
const require = createRequire(import.meta.url);
const ts = require("typescript");
const Module = require("node:module");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const oldExtension = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
}).outputText, filename);
const { fallbackLLMDecision, requestLLMDecision } = require("../agents/llm-adapter.ts");

const context = {
  citizen: { name: "Synthetic Citizen", age: 40, occupation: "Designer", digitalLiteracy: 80, riskAwareness: 20, stress: 70, familyTrust: 60, strangerTrust: 50, authorityTrust: 50, impulsiveness: 70 },
  strategy: "impersonation",
  message: "Please confirm the transfer.",
  probability: 0.99,
  actualDecision: "ignore",
};
assert.equal(fallbackLLMDecision(context).decision, "ignore", "fallback must narrate the recorded engine decision");

const config = { enabled: true, apiKey: "contract-test-key", baseUrl: "https://unused.invalid/v1", model: "contract-test", timeoutMs: 1000, maxTokens: 200 };
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"decision":"transfer","thought":"I transferred it.","reason":"model mismatch"}' } }] }) });
  const mismatch = await requestLLMDecision(context, config, fallbackLLMDecision(context));
  assert.equal(mismatch.decision, "ignore", "a model cannot rewrite an already recorded engine decision");

  const blockedContext = { ...context, actualDecision: "blocked" };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"decision":"blocked","thought":"The bank paused it.","reason":"verified"}' } }] }) });
  const matching = await requestLLMDecision(blockedContext, config, fallbackLLMDecision(blockedContext));
  assert.equal(matching.decision, "blocked", "blocked/cancelled outcomes must be narratable");
} finally {
  globalThis.fetch = originalFetch;
  Module._extensions[".ts"] = oldExtension;
}

console.log("PASS: narration fallback and model output preserve the deterministic engine decision; blocked outcomes are supported.");
