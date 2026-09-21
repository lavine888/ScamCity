import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Execute the actual TypeScript engine without emitting files or adding a runner
// dependency. Project alias imports are resolved in this isolated module cache.
const root = fileURLToPath(new URL("..", import.meta.url));
const cache = new Map();
function load(filename) {
  filename = resolve(filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const localRequire = createRequire(filename);
  const requireSource = (id) => id.startsWith("@/")
    ? load(resolve(root, `${id.slice(2)}${id === "@/types" ? "/index" : ""}.ts`))
    : id.startsWith(".") ? load(resolve(dirname(filename), `${id}.ts`)) : localRequire(id);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  });
  new Function("require", "module", "exports", outputText)(requireSource, module, module.exports);
  return module.exports;
}
const { createWorld, runSimulation, applyIntervention, injectAudienceEvent, compareFromSnapshot, compareStrategies } = load(resolve(root, "simulation/world.ts"));

for (const seed of [7, 42, 2026]) {
  let snapshot = runSimulation(createWorld(seed), { ticks: 36 });
  snapshot = applyIntervention(snapshot, "mass-warning");
  snapshot = injectAudienceEvent(snapshot, { eventId: `incident-${seed}`, type: "deepfake-voice", duration: 30, label: "Snapshot incident" });
  // Deliberate non-seed state proves comparison is not recreating the city.
  snapshot.citizens[0].assets = 12345;
  const before = JSON.stringify(snapshot);
  const zero = compareFromSnapshot(snapshot, { ticks: 0 });
  for (const result of zero) {
    assert.equal(result.world.tick, snapshot.tick);
    assert.equal(result.world.citizens[0].assets, 12345);
    assert.deepEqual(result.world.audienceEvents, snapshot.audienceEvents);
    assert.deepEqual(result.world.interactions, snapshot.interactions);
    assert.deepEqual(result.world.interventionHistory.slice(0, snapshot.interventionHistory.length), snapshot.interventionHistory);
    assert.ok(result.world.activeInterventions.includes("mass-warning"));
  }
  const baseline = zero.find((result) => result.strategy === "baseline");
  assert.match(baseline.label, /No additional/);
  assert.deepEqual(baseline.world.citizens, snapshot.citizens);
  assert.deepEqual(baseline.world.interventionHistory, snapshot.interventionHistory);
  const active = zero.find((result) => result.strategy === "mass-warning");
  assert.match(active.label, /already active/);
  assert.deepEqual(active.world, baseline.world);
  const added = zero.find((result) => result.strategy === "bank-risk-agent");
  assert.match(added.label, /added/);
  assert.equal(added.world.interventionHistory.at(-1).tick, snapshot.tick);

  const future = compareFromSnapshot(snapshot, { ticks: 18 });
  assert.deepEqual(future, compareFromSnapshot(snapshot, { ticks: 18 }));
  assert.deepEqual(future[0].world, runSimulation(snapshot, { ticks: 18, processScams: true, compactEvents: true }));
  assert.deepEqual(future.find((result) => result.strategy === "mass-warning").world, future[0].world);
  for (const result of future) {
    assert.equal(result.world.tick, snapshot.tick + 18);
    assert.deepEqual(result.world.audienceEvents, snapshot.audienceEvents);
  }
  assert.equal(compareFromSnapshot(snapshot, { days: 0.5 })[0].world.tick, snapshot.tick + 36);
  assert.equal(compareFromSnapshot(snapshot, { ticks: 0, days: 2 })[0].world.tick, snapshot.tick);
  assert.equal(JSON.stringify(snapshot), before, "comparison must not mutate the source");
  zero[0].world.citizens[0].assets = -1;
  zero[0].metrics.moneyLost = -1;
  assert.equal(snapshot.citizens[0].assets, 12345);
  assert.notEqual(zero[1].world.citizens[0].assets, -1);
  assert.notEqual(zero[0].world.metrics.moneyLost, -1);
}
for (const options of [{ ticks: -1 }, { ticks: Infinity }, { ticks: 0.5 }, { days: NaN }]) {
  assert.throws(() => compareFromSnapshot(createWorld(), options), RangeError);
}
assert.equal(compareStrategies(42, { ticks: 0 })[0].label, "Baseline");
console.log("PASS: same-snapshot preservation, incident ledger, existing interventions, branch isolation, reproducibility and future horizons across 3 seeds; legacy API retained.");
console.log("Scope: identical initial state, not identical later random encounters or real-world causal validation.");