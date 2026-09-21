import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load the real TypeScript store and planner without emitting build files.
const require = createRequire(import.meta.url);
const ts = require("typescript");
const Module = require("node:module");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...rest) {
  return originalResolve.call(this, name.startsWith("@/") ? path.join(root, name.slice(2)) : name, ...rest);
};
const oldExtension = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
}).outputText, filename);
const { SimulationStore } = require("../lib/simulation-api.ts");
const { executeIntervention } = require("../agents/intervention-planner.ts");
const config = { enabled: false, baseUrl: "https://unused.invalid/v1", model: "contract-test", timeoutMs: 1000, maxTokens: 200 };
const store = new SimulationStore(42);
const input = (budget = 300) => ({ budget, expectedSnapshotId: store.getSnapshot().snapshotId });
const originalFetch = globalThis.fetch;
try {
  // No gateway calls or environment keys are used by this verification.
  globalThis.fetch = () => { throw new Error("Unexpected external fetch"); };
  const initial = store.getSnapshot();
  for (const bad of [null, {}, { ...input(), budget: -1 }, { ...input(), budget: 1.5 }, { ...input(), budget: 100001 }, { ...input(), budget: "300" }, { ...input(), extra: true }]) {
    await assert.rejects(executeIntervention(store, bad, config), (e) => e.status === 400);
  }
  assert.deepEqual(store.getSnapshot(), initial);
  const firstInput = input();
  const result = await executeIntervention(store, firstInput, config);
  assert.equal(result.source, "rules");
  assert.equal(result.strategy, "network-intervention");
  assert.equal(result.actualCost, 300);
  assert.equal(result.estimatedCost, 300);
  assert.equal(result.afterTick, result.beforeTick);
  assert.equal(result.observation.recentInteractions, 0);
  assert.deepEqual(result.observation.recentStrategyCounts, {});
  assert.equal(result.observation.cumulativeMetrics.fraudAttempts, 0);
  assert.ok(result.snapshot.world.activeInterventions.includes(result.strategy));
  assert.notEqual(result.beforeSnapshotId, result.afterSnapshotId);
  assert.equal(result.snapshot.world.interventionHistory.at(-1).cost, 300);
  await assert.rejects(executeIntervention(store, firstInput, config), (e) => e.status === 409);
  assert.equal(store.getSnapshot().world.metrics.interventionCost, 300);
  const zero = await executeIntervention(store, input(0), config);
  assert.equal(zero.strategy, "baseline");
  assert.equal(zero.actualCost, 0);
  assert.ok(zero.snapshot.world.activeInterventions.includes("network-intervention"));
  // Mock only the gateway transport: these verify model parsing and stale-race contracts.
  const enabled = { ...config, enabled: true, apiKey: "dummy-test-key" };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"strategy":"bank-risk-agent","reason":"over budget"}' } }] }) });
  const invalid = await executeIntervention(store, input(100), enabled);
  assert.equal(invalid.source, "fallback");
  assert.equal(invalid.strategy, "mass-warning");
  assert.equal(invalid.actualCost, 100);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"strategy":"social-guardian","reason":"Verify a family contact"}' } }] }) });
  const model = await executeIntervention(store, input(650), enabled);
  assert.equal(model.source, "model");
  assert.equal(model.actualCost, 650);
  let release;
  globalThis.fetch = () => new Promise((resolve) => { release = resolve; });
  const race = executeIntervention(store, input(1250), enabled);
  store.dispatch({ type: "tick" });
  const afterExternalChange = store.getSnapshot();
  release({ ok: true, json: async () => ({ choices: [{ message: { content: '{"strategy":"bank-risk-agent","reason":"Delay transfers"}' } }] }) });
  await assert.rejects(race, (e) => e.status === 409);
  assert.deepEqual(store.getSnapshot(), afterExternalChange);
  console.log("PASS: real store rule execution, activation budget, replay rejection, baseline retention; mocked gateway validation and stale-race contract. No real model call.");
} finally {
  globalThis.fetch = originalFetch;
  Module._resolveFilename = originalResolve;
  if (oldExtension) Module._extensions[".ts"] = oldExtension;
  else delete Module._extensions[".ts"];
}
