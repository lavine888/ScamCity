#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { candidates, SCHEMA_VERSION } from "./lib/endpoint.mjs";

// Resolved rather than assumed: hardcoding port 3000 made this report record
// "unavailable" while the server was running on another port, because
// Minecraft's "Open to LAN" had taken 3000 and Next.js had relocated itself.
const apiCandidates = candidates();
const gameDir = process.env.MINECRAFT_GAME_DIR ?? "D:\\Minecraft";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = resolve(process.env.SCAMCITY_REPORT_DIR ?? `evolution/runs/${timestamp}`);
mkdirSync(outputDir, { recursive: true });

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${url} returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return body;
}

const generatedAt = new Date().toISOString();
let health = null;
let snapshot = null;
let apiError = null;
let apiUrl = null;
const attemptErrors = [];
for (const candidate of apiCandidates) {
  const healthUrl = candidate.replace(/\/api\/simulation\/?$/, "/api/health");
  try {
    const [candidateHealth, candidateSnapshot] = await Promise.all([
      getJson(healthUrl),
      getJson(candidate),
    ]);
    // A 200 is not proof this is ScamCity: the failure being guarded against is
    // an unrelated service answering on the port we expected.
    if (candidateSnapshot?.schemaVersion !== SCHEMA_VERSION) {
      attemptErrors.push(`${candidate}: not ScamCity (missing schemaVersion=${SCHEMA_VERSION})`);
      continue;
    }
    [health, snapshot, apiUrl] = [candidateHealth, candidateSnapshot, candidate];
    break;
  } catch (error) {
    attemptErrors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (!snapshot) apiError = attemptErrors.join("; ");

const world = snapshot?.world;
const checks = [
  { name: "api", status: health && snapshot ? "pass" : "fail", detail: apiError ?? "health and snapshot available" },
  { name: "schema", status: snapshot?.schemaVersion === SCHEMA_VERSION ? "pass" : "fail", detail: snapshot?.schemaVersion ?? "missing" },
  { name: "population", status: world?.citizens?.length === 100 && world?.scammers?.length === 5 ? "pass" : "fail", detail: `citizens=${world?.citizens?.length ?? 0}; scammers=${world?.scammers?.length ?? 0}` },
  { name: "bridge-jar", status: "warn", detail: "not required for API-only report" },
];

const bridgePath = resolve(gameDir, "mods", "scamcity-bridge-0.1.0.jar");
if (existsSync(bridgePath)) {
  const hash = createHash("sha256").update(readFileSync(bridgePath)).digest("hex").toUpperCase();
  checks[3] = { name: "bridge-jar", status: "pass", detail: `${bridgePath}; sha256=${hash}` };
}

const runId = snapshot?.snapshotId ? `scamcity-${snapshot.snapshotId}` : `scamcity-unavailable-${timestamp}`;
const manifest = {
  manifestVersion: "scamcity.run/v1",
  runId,
  generatedAt,
  source: snapshot && health ? "live" : "unavailable",
  // Null when nothing answered, so the manifest never implies an endpoint was
  // reached when none was. The attempted list is kept for diagnosis.
  apiUrl: apiUrl ?? null,
  apiCandidates,
  schemaVersion: snapshot?.schemaVersion ?? null,
  snapshotId: snapshot?.snapshotId ?? null,
  cursor: snapshot?.cursor ?? null,
  scenario: world ? {
    seed: world.seed,
    tick: world.tick,
    day: world.day,
    time: world.time,
    phase: world.phase,
    eventSequence: world.eventSequence,
    activeInterventions: world.activeInterventions,
    activeAudienceEvents: snapshot?.activeEvents ?? [],
  } : null,
  counts: world ? {
    citizens: world.citizens.length,
    scammers: world.scammers.length,
    relationships: world.socialGraph?.edges?.length ?? 0,
    eventsInWindow: world.eventFeed?.length ?? 0,
  } : null,
  metrics: world?.metrics ?? null,
  readiness: checks,
};

const comparison = (snapshot?.comparison ?? []).map((result) => ({
  strategy: result.strategy,
  label: result.label,
  metrics: result.metrics ? {
    victims: result.metrics.victims,
    moneyLost: result.metrics.moneyLost,
    warningsSent: result.metrics.warningsSent,
    falsePositives: result.metrics.falsePositives,
    successfulInterventions: result.metrics.successfulInterventions,
    interventionCost: result.metrics.interventionCost,
    safetyIndex: result.metrics.safetyIndex,
    trustIndex: result.metrics.trustIndex,
  } : null,
}));

// The verdict is the single shared "best strategy" rule. It was previously
// absent from the report, which meant a run could be archived with comparison
// numbers but no record of which strategy the agreed rule actually picked or
// why. Its disclaimer travels with it: a ranked best from one seed is not a
// general claim.
const verdict = snapshot?.verdict ? {
  rule: snapshot.verdict.rule,
  bestStrategy: snapshot.verdict.bestStrategy,
  bestLabel: snapshot.verdict.bestLabel,
  reason: snapshot.verdict.reason,
  ranking: snapshot.verdict.ranking,
  scorecards: snapshot.verdict.scorecards,
  disclaimer: snapshot.verdict.disclaimer,
} : null;

writeFileSync(resolve(outputDir, "run-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(resolve(outputDir, "readiness-report.json"), `${JSON.stringify({ generatedAt, apiUrl: apiUrl ?? null, gameDir, ok: checks.every((check) => check.status !== "fail"), checks }, null, 2)}\n`);
writeFileSync(resolve(outputDir, "comparison.json"), `${JSON.stringify({ generatedAt, runId, context: snapshot?.comparisonContext ?? null, verdict, comparison }, null, 2)}\n`);

console.log(`ScamCity report: ${outputDir}`);
console.log(`source=${manifest.source} runId=${runId}${apiUrl ? ` api=${apiUrl}` : ""}`);
if (verdict) console.log(`verdict=${verdict.bestStrategy} (${verdict.rule})`);
for (const check of checks) console.log(`${check.status.toUpperCase().padEnd(5)} ${check.name}: ${check.detail}`);
process.exitCode = checks.some((check) => check.status === "fail") ? 1 : 0;
