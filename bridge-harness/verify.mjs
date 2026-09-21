#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createOfflineWorld,
  diffBridgeSnapshots,
  resultForWorld,
  toBridgeSnapshot,
  unwrapWorld,
  validateBridgeSnapshot,
  validateWorld,
} from "./lib/bridge.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "fixtures", "offline-snapshot.json");
const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
const world = unwrapWorld(fixture);

const validation = validateWorld(world);
assert.deepEqual(validation, { citizenCount: 100, scammerCount: 5, eventCount: 4, uniqueEventIds: 4 });
const first = resultForWorld(world);
const bridgeValidation = validateBridgeSnapshot(first.snapshot);
assert.deepEqual(bridgeValidation, { citizenCount: 100, scammerCount: 5, eventCount: 4 });
assert.equal(first.delta.mode, "full");
assert.equal(first.commandPlan.summary.markerCommands, 105);
assert.equal(first.commandPlan.summary.fullSync, true);
assert.equal(first.snapshot.citizens.every((citizen) => Number.isInteger(citizen.location.minecraft.x)), true);
assert.equal(first.snapshot.citizens.every((citizen) => ["#40e0a0", "#f7c948", "#fb3b50"].includes(citizen.riskColor)), true);

const nextWorld = structuredClone(world);
nextWorld.tick += 1;
nextWorld.time = "Day 1 · 08:30";
nextWorld.citizens[3].state = "victim";
nextWorld.citizens[3].riskAwareness = 1;
nextWorld.eventSequence += 1;
nextWorld.eventFeed.push({
  id: "event-42-5",
  tick: nextWorld.tick,
  time: nextWorld.time,
  kind: "outcome",
  message: "Verification event: a citizen became a victim.",
  severity: "danger",
  citizenId: nextWorld.citizens[3].id,
});
const second = resultForWorld(nextWorld, {}, first.snapshot);
const delta = diffBridgeSnapshots(first.snapshot, second.snapshot);
assert.equal(delta.mode, "delta");
assert.equal(delta.changedCitizens.some((citizen) => citizen.id === "citizen-004"), true);
assert.equal(delta.newEvents.length, 1);
assert.equal(second.commandPlan.mode, "delta-sync");
assert.equal(second.commandPlan.summary.markerCommands, 1);
assert.equal(second.commandPlan.summary.eventCommands, 1);

const duplicateEvents = structuredClone(world);
duplicateEvents.eventFeed.push({ ...duplicateEvents.eventFeed[0] });
assert.throws(() => resultForWorld(duplicateEvents), /duplicate event ids/);

console.log("bridge-harness verification passed");
console.log(`- offline fixture: ${fixturePath}`);
console.log(`- citizens: ${first.snapshot.citizens.length}; scammers: ${first.snapshot.scammers.length}`);
console.log(`- unique events: ${first.snapshot.events.length}`);
console.log(`- full marker commands: ${first.commandPlan.summary.markerCommands}`);
console.log(`- delta marker commands: ${second.commandPlan.summary.markerCommands}`);
