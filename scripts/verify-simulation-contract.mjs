import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULT_URL, DISCOVERY_FILE, SCHEMA_VERSION } from "./lib/endpoint.mjs";

const baseUrl = process.env.SCAMCITY_URL ?? "http://localhost:3000";

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Expected JSON from ${path}, received: ${text.slice(0, 160)}`);
  }
  return { response, body };
}

async function command(payload) {
  return request("/api/simulation", { method: "POST", body: JSON.stringify(payload) });
}

const health = await request("/api/health");
assert.equal(health.response.status, 200, `health endpoint returned ${health.response.status}`);
assert.equal(health.body.status, "ok");
assert.equal(health.body.schemaVersion, "scamcity.simulation/v1");
assert.equal(typeof health.body.cursor.eventSequence, "number");

const firstSeededReset = await command({ type: "reset", seed: 31415 });
const reset = await command({ type: "reset", seed: 31415 });
assert.deepEqual(reset.body.world, firstSeededReset.body.world, "same seed must recreate the same world");
assert.equal(reset.response.status, 200);
assert.equal(reset.body.schemaVersion, "scamcity.simulation/v1");
assert.equal(reset.body.world.citizens.length, 100);
assert.equal(reset.body.world.scammers.length, 5);
assert.equal(reset.body.cursor.eventFeedTruncated, false);
assert.equal(reset.body.cursor.eventFeedStart, 1);
assert.deepEqual(reset.body.activeEvents, []);

const audienceEvent = await command({
  type: "inject-event",
  eventId: "demo-bank-outage-01",
  event: { type: "bank-outage", duration: 12, label: "银行系统短暂中断" },
});
assert.equal(audienceEvent.response.status, 200);
assert.equal(audienceEvent.body.world.audienceEvents.length, 1);
assert.equal(audienceEvent.body.activeEvents.length, 1);
assert.equal(audienceEvent.body.activeEvents[0].eventId, "demo-bank-outage-01");
assert.equal(audienceEvent.body.activeEvents[0].endTick, audienceEvent.body.world.tick + 12);
assert.ok(audienceEvent.body.cursor.eventSequence > reset.body.cursor.eventSequence);
assert.equal(audienceEvent.body.world.eventFeed.at(-1).kind, "audience");
assert.equal(audienceEvent.body.world.eventFeed.at(-1).audienceEventId, "demo-bank-outage-01");

const duplicateEvent = await command({
  type: "event",
  eventId: "demo-bank-outage-01",
  eventType: "bank-outage",
  duration: 12,
  label: "同一事件重复提交",
});
assert.equal(duplicateEvent.response.status, 200);
assert.equal(duplicateEvent.body.world.audienceEvents.length, 1, "duplicate event must be idempotent");
assert.equal(duplicateEvent.body.cursor.eventSequence, audienceEvent.body.cursor.eventSequence);
assert.equal(duplicateEvent.body.cursor.revision, audienceEvent.body.cursor.revision);

for (const invalidEvent of [
  { type: "inject-event", eventId: "bad-type", event: { type: "earthquake", duration: 2, label: "非法类型" } },
  { type: "inject-event", eventId: "bad-duration", event: { type: "market-panic", duration: 0, label: "非法时长" } },
  { type: "inject-event", eventId: "bad-label", event: { type: "deepfake-voice", duration: 2, label: "   " } },
]) {
  const invalidEventResponse = await command(invalidEvent);
  assert.equal(invalidEventResponse.response.status, 400);
  assert.equal(invalidEventResponse.body.code, "INVALID_COMMAND");
}

const tick = await command({ type: "tick", count: 4 });
assert.equal(tick.response.status, 200);
assert.equal(tick.body.world.tick, 4);
assert.ok(tick.body.cursor.eventSequence > reset.body.cursor.eventSequence);
assert.equal(tick.body.cursor.revision, audienceEvent.body.cursor.revision + 1);

const pause = await command({ type: "pause" });
const pausedTick = await command({ type: "tick", count: 4 });
assert.equal(pause.body.world.phase, "paused");
assert.equal(pausedTick.body.world.phase, "paused");
assert.equal(pausedTick.body.world.tick, pause.body.world.tick, "paused tick must be a no-op");

const resume = await command({ type: "resume" });
const resumedTick = await command({ type: "tick" });
assert.equal(resume.body.world.phase, "running");
assert.equal(resumedTick.body.world.tick, pause.body.world.tick + 1);

const longRun = await command({ type: "run", ticks: 576 });
assert.equal(longRun.response.status, 200);
assert.equal(longRun.body.world.day, 9);
assert.match(longRun.body.world.time, /^Day 9 ·/);

const invalid = await command({ type: "unknown-command" });
assert.equal(invalid.response.status, 400);
assert.equal(invalid.body.code, "INVALID_COMMAND");

const tooLarge = await command({ type: "run", ticks: 20001 });
assert.equal(tooLarge.response.status, 400);
assert.equal(tooLarge.body.code, "INVALID_COMMAND");

const secondAudienceEvent = {
  type: "inject-event",
  eventId: "contract-audience-01",
  event: { type: "deepfake-voice", duration: 72, label: "Contract test audience event" },
};
const injected = await command(secondAudienceEvent);
assert.equal(injected.response.status, 200);
assert.equal(injected.body.world.audienceEvents.at(-1).eventId, secondAudienceEvent.eventId);
assert.equal(injected.body.world.eventFeed.at(-1).kind, "audience");
const repeated = await command(secondAudienceEvent);
assert.equal(repeated.response.status, 200);
assert.equal(repeated.body.world.eventSequence, injected.body.world.eventSequence, "idempotent audience event must not duplicate the feed");
const invalidAudienceEvent = await command({ type: "inject-event", eventId: "bad", event: { type: "not-allowed", duration: 1, label: "bad" } });
assert.equal(invalidAudienceEvent.response.status, 400);
assert.equal(invalidAudienceEvent.body.code, "INVALID_COMMAND");

// --- Audience incidents must be a structured, bounded model input (A-04) ---
// The whitelist declares which scam strategies an incident amplifies, so the
// accepted event carries that contract and the decision model exposes it as an
// explainable risk factor rather than as free text.
const incidentReset = await command({ type: "reset", seed: 777 });
assert.equal(incidentReset.body.world.tick, 0);
const incident = await command({
  type: "inject-event",
  eventId: "contract-impact-01",
  event: { type: "bank-outage", duration: 2_000, label: "Structured incident contract" },
});
const acceptedIncident = incident.body.world.audienceEvents.at(-1);
assert.deepEqual(
  acceptedIncident.affectedStrategies,
  ["fake-customer-service", "authority-scam"],
  "an accepted incident must record the strategies it amplifies",
);
assert.ok(acceptedIncident.susceptibilityBoost > 0, "an incident must declare a non-zero boost");

const incidentRun = await command({ type: "run", ticks: 288 });
const affected = new Set(acceptedIncident.affectedStrategies);
const boostedMessages = incidentRun.body.world.messages.filter((message) =>
  affected.has(message.strategy) && message.factors.some((factor) => factor.name === "audience-incident"));
assert.ok(
  boostedMessages.length > 0,
  "an active incident must appear as an audience-incident risk factor on affected strategies",
);
const unaffectedBoost = incidentRun.body.world.messages.filter((message) =>
  !affected.has(message.strategy) && message.factors.some((factor) => factor.name === "audience-incident"));
assert.equal(unaffectedBoost.length, 0, "an incident must not affect strategies outside its whitelist");

// The incident must not break reproducibility: the same seed and the same
// command sequence still rebuild an identical world.
await command({ type: "reset", seed: 777 });
await command({
  type: "inject-event",
  eventId: "contract-impact-01",
  event: { type: "bank-outage", duration: 2_000, label: "Structured incident contract" },
});
const incidentReplay = await command({ type: "run", ticks: 288 });
assert.deepEqual(
  incidentReplay.body.world,
  incidentRun.body.world,
  "same seed and same incident sequence must replay an identical world",
);

// --- Comparison must publish one shared verdict (A-19) ---
// impact / friction / cost are reported separately and the "best" strategy comes
// from a single documented rule, so the UI cannot rank on loss alone.
const compared = await command({ type: "compare", days: 1 });
assert.equal(compared.response.status, 200);
const verdict = compared.body.verdict;
assert.ok(verdict, "a comparison must publish a verdict");
assert.equal(verdict.scorecards.length, 5);
assert.equal(verdict.ranking[0], verdict.bestStrategy, "ranking must agree with the chosen best strategy");
assert.ok(verdict.rule.length > 0 && verdict.reason.length > 0, "the verdict must explain itself");
assert.match(verdict.disclaimer, /synthetic modeled outcome/);
for (const card of verdict.scorecards) {
  for (const field of ["victims", "moneyLost"]) assert.equal(typeof card.impact[field], "number");
  for (const field of ["falsePositives", "warningsSent"]) assert.equal(typeof card.friction[field], "number");
  assert.equal(typeof card.cost.interventionCost, "number");
}

// --- Endpoint constants must not drift across languages ---
// The bridge cannot import JavaScript, so ApiEndpoints.java keeps its own copy
// of the discovery filename and the schema version. Those copies are exactly the
// kind of thing that rots silently: a rename on one side would make the bridge
// reject every real snapshot as "not ScamCity" while every other test passed.
const javaSource = await readFile(
  new URL("../minecraft-bridge/src/main/java/com/baytech/scamcity/bridge/ApiEndpoints.java", import.meta.url),
  "utf8",
);
const javaConstant = (name) => {
  const match = javaSource.match(new RegExp(`String ${name} = "([^"]+)"`));
  assert.ok(match, `ApiEndpoints.${name} must exist`);
  return match[1];
};
assert.equal(javaConstant("SCHEMA_VERSION"), SCHEMA_VERSION,
  "ApiEndpoints.SCHEMA_VERSION must match the JS helper");
assert.equal(javaConstant("SCHEMA_VERSION"), reset.body.schemaVersion,
  "ApiEndpoints.SCHEMA_VERSION must match what the API actually serves");
assert.equal(javaConstant("DEFAULT_URL"), DEFAULT_URL,
  "the documented default endpoint must agree across languages");
assert.ok(DISCOVERY_FILE.endsWith(javaConstant("DISCOVERY_FILE")),
  "the discovery filename must agree, or the bridge reads a file nobody writes");
const serveSource = await readFile(new URL("./scamcity-serve.mjs", import.meta.url), "utf8");
assert.ok(serveSource.includes(javaConstant("DISCOVERY_FILE")),
  "the serve script must write the filename the bridge reads");
assert.ok(serveSource.includes(SCHEMA_VERSION),
  "the serve script must verify the schema before publishing an endpoint");

// Leave the shared development server in its documented initial state.
const restored = await command({ type: "reset", seed: 42 });
assert.equal(restored.response.status, 200);
assert.equal(restored.body.world.tick, 0);

console.log(`Simulation contract OK: schema=${reset.body.schemaVersion}, citizens=${reset.body.world.citizens.length}, eventCursor=${longRun.body.cursor.eventSequence}, audienceEvent=idempotent, incidentFactor=${boostedMessages.length}, verdict=${verdict.bestStrategy}`);
