import crypto from "node:crypto";

export const BRIDGE_SCHEMA = "scamcity.minecraft-bridge/v1";

export const DEFAULT_MAP = Object.freeze({
  origin: { x: 0, y: 64, z: 0 },
  width: 128,
  depth: 128,
  groundY: 64,
});

const RISK_COLORS = Object.freeze({
  low: { hex: "#40e0a0", minecraft: "green", rgb: [0.251, 0.878, 0.627] },
  medium: { hex: "#f7c948", minecraft: "yellow", rgb: [0.969, 0.788, 0.282] },
  high: { hex: "#fb3b50", minecraft: "red", rgb: [0.984, 0.231, 0.314] },
});

const STATE_ADJUSTMENTS = Object.freeze({
  safe: 0,
  suspicious: 8,
  engaged: 14,
  trusted: 18,
  clicked: 24,
  victim: 32,
  protected: -20,
});

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stableHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 8);
}

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normaliseMap(options = {}) {
  const supplied = options.map ?? {};
  const origin = supplied.origin ?? {};
  const originY = finiteNumber(origin.y, DEFAULT_MAP.origin.y);
  return {
    origin: {
      x: finiteNumber(origin.x, DEFAULT_MAP.origin.x),
      y: originY,
      z: finiteNumber(origin.z, DEFAULT_MAP.origin.z),
    },
    width: Math.max(1, finiteNumber(supplied.width, DEFAULT_MAP.width)),
    depth: Math.max(1, finiteNumber(supplied.depth, DEFAULT_MAP.depth)),
    groundY: finiteNumber(supplied.groundY, originY),
  };
}

export function unwrapWorld(payload) {
  if (payload?.world && Array.isArray(payload.world.citizens)) return payload.world;
  if (payload?.snapshot?.world && Array.isArray(payload.snapshot.world.citizens)) return payload.snapshot.world;
  if (Array.isArray(payload?.citizens) && Array.isArray(payload?.scammers)) return payload;
  throw new Error("Payload does not contain a ScamCity world (expected world.citizens and world.scammers).");
}

export function riskScoreForCitizen(citizen) {
  const awareness = finiteNumber(citizen.riskAwareness, 50);
  const stress = finiteNumber(citizen.stress, 50);
  const impulsiveness = finiteNumber(citizen.impulsiveness, 50);
  const literacy = finiteNumber(citizen.digitalLiteracy, 50);
  const stateAdjustment = STATE_ADJUSTMENTS[citizen.state] ?? 0;
  return round(
    clamp(
      (100 - awareness) * 0.44 +
        stress * 0.24 +
        impulsiveness * 0.22 +
        (100 - literacy) * 0.1 +
        stateAdjustment,
    ),
  );
}

export function riskBandForScore(score) {
  if (score >= 66) return "high";
  if (score >= 34) return "medium";
  return "low";
}

export function riskVisualForScore(score) {
  const band = riskBandForScore(score);
  const visual = RISK_COLORS[band];
  return {
    band,
    color: visual.hex,
    minecraftColor: visual.minecraft,
    rgb: [...visual.rgb],
  };
}

export function mapLocation(location, map = DEFAULT_MAP) {
  const x = finiteNumber(location?.x, 50);
  const y = finiteNumber(location?.y, 50);
  return {
    x: Math.round(map.origin.x + ((x - 50) / 100) * map.width),
    y: Math.round(map.groundY),
    z: Math.round(map.origin.z + ((y - 50) / 100) * map.depth),
    zone: location?.zone ?? "unknown",
  };
}

function mapScammerPosition(index, total, map) {
  const radius = Math.max(4, Math.min(map.width, map.depth) * 0.47);
  const angle = (Math.PI * 2 * index) / Math.max(1, total) - Math.PI / 2;
  return {
    x: Math.round(map.origin.x + Math.cos(angle) * radius),
    y: Math.round(map.groundY + 1),
    z: Math.round(map.origin.z + Math.sin(angle) * radius),
    zone: "threat-boundary",
  };
}

function stateForOutput(citizen) {
  return citizen.state ?? "safe";
}

function citizenMarker(citizen, map) {
  const riskScore = riskScoreForCitizen(citizen);
  const risk = riskVisualForScore(riskScore);
  return {
    id: citizen.id,
    name: citizen.name,
    role: "citizen",
    state: stateForOutput(citizen),
    riskScore,
    riskBand: risk.band,
    riskColor: risk.color,
    minecraftColor: risk.minecraftColor,
    rgb: risk.rgb,
    isHub: Boolean(citizen.isHub),
    location: {
      simulation: {
        x: finiteNumber(citizen.location?.x, 50),
        y: finiteNumber(citizen.location?.y, 50),
        zone: citizen.location?.zone ?? "unknown",
      },
      minecraft: mapLocation(citizen.location, map),
    },
  };
}

function scammerMarker(scammer, index, total, map) {
  return {
    id: scammer.id,
    name: scammer.name,
    role: "scammer",
    strategy: scammer.strategy,
    active: scammer.active !== false,
    location: mapScammerPosition(index, total, map),
    color: RISK_COLORS.high.hex,
    minecraftColor: RISK_COLORS.high.minecraft,
    rgb: [...RISK_COLORS.high.rgb],
  };
}

function compactEvent(event) {
  return {
    id: String(event.id),
    tick: finiteNumber(event.tick, 0),
    time: event.time ?? "",
    kind: event.kind ?? "system",
    message: String(event.message ?? ""),
    citizenId: event.citizenId,
    scammerId: event.scammerId,
    severity: event.severity ?? "info",
  };
}

export function validateWorld(world) {
  const problems = [];
  if (!world || typeof world !== "object") problems.push("world must be an object");
  if (!Array.isArray(world?.citizens)) problems.push("world.citizens must be an array");
  if (!Array.isArray(world?.scammers)) problems.push("world.scammers must be an array");
  if (!Array.isArray(world?.eventFeed)) problems.push("world.eventFeed must be an array");
  if (problems.length) throw new Error(`Invalid ScamCity world: ${problems.join("; ")}`);

  if (world.citizens.length !== 100) problems.push(`expected 100 citizens, got ${world.citizens.length}`);
  if (world.scammers.length !== 5) problems.push(`expected 5 scammers, got ${world.scammers.length}`);

  const ids = new Set();
  for (const citizen of world.citizens) {
    if (!citizen.id) problems.push("citizen is missing id");
    if (ids.has(citizen.id)) problems.push(`duplicate citizen id: ${citizen.id}`);
    ids.add(citizen.id);
    const x = finiteNumber(citizen.location?.x, NaN);
    const y = finiteNumber(citizen.location?.y, NaN);
    if (!Number.isFinite(x) || x < 0 || x > 100 || !Number.isFinite(y) || y < 0 || y > 100) {
      problems.push(`citizen ${citizen.id ?? "?"} has a location outside the 0..100 simulation map`);
    }
  }

  const eventIds = world.eventFeed.map((event) => String(event.id ?? ""));
  const uniqueEventIds = new Set(eventIds);
  if (eventIds.some((id) => !id)) problems.push("eventFeed contains an event without an id");
  if (uniqueEventIds.size !== eventIds.length) problems.push("eventFeed contains duplicate event ids");

  if (problems.length) throw new Error(`Invalid ScamCity world: ${problems.join("; ")}`);
  return {
    citizenCount: world.citizens.length,
    scammerCount: world.scammers.length,
    eventCount: world.eventFeed.length,
    uniqueEventIds: uniqueEventIds.size,
  };
}

export function toBridgeSnapshot(world, options = {}) {
  const validation = validateWorld(world);
  const map = normaliseMap(options);
  const citizens = world.citizens.map((citizen) => citizenMarker(citizen, map));
  const scammers = world.scammers.map((scammer, index) => scammerMarker(scammer, index, world.scammers.length, map));
  const events = world.eventFeed.map(compactEvent);
  const metrics = world.metrics ?? {};
  return {
    schemaVersion: BRIDGE_SCHEMA,
    generatedAt: new Date().toISOString(),
    map,
    world: {
      seed: finiteNumber(world.seed, 0),
      tick: finiteNumber(world.tick, 0),
      day: finiteNumber(world.day, 1),
      time: world.time ?? "",
      phase: world.phase ?? "idle",
      eventSequence: finiteNumber(world.eventSequence, events.length),
      activeInterventions: [...(world.activeInterventions ?? [])],
      metrics: {
        victims: finiteNumber(metrics.victims, 0),
        moneyLost: finiteNumber(metrics.moneyLost, 0),
        fraudAttempts: finiteNumber(metrics.fraudAttempts, 0),
        warningsSent: finiteNumber(metrics.warningsSent, 0),
        successfulInterventions: finiteNumber(metrics.successfulInterventions, 0),
        safetyIndex: finiteNumber(metrics.safetyIndex, 0),
        trustIndex: finiteNumber(metrics.trustIndex, 0),
      },
      relationships: finiteNumber(world.socialGraph?.edges?.length, 0),
      networkHubs: [...(world.socialGraph?.hubs ?? [])],
    },
    citizens,
    scammers,
    events,
    validation,
  };
}

function comparableCitizen(citizen) {
  return {
    state: citizen.state,
    riskScore: citizen.riskScore,
    riskBand: citizen.riskBand,
    isHub: citizen.isHub,
    location: citizen.location.minecraft,
  };
}

function changed(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function metricDiff(previous, current) {
  const output = {};
  const keys = new Set([...Object.keys(previous ?? {}), ...Object.keys(current ?? {})]);
  for (const key of keys) {
    const before = finiteNumber(previous?.[key], 0);
    const after = finiteNumber(current?.[key], 0);
    if (before !== after) output[key] = { from: before, to: after, delta: round(after - before, 2) };
  }
  return output;
}

export function emptyDelta(snapshot) {
  return {
    schemaVersion: BRIDGE_SCHEMA,
    mode: "full",
    fromTick: null,
    toTick: snapshot.world.tick,
    tickDelta: null,
    addedCitizens: snapshot.citizens.map((citizen) => citizen.id),
    removedCitizens: [],
    changedCitizens: [],
    newEvents: snapshot.events,
    metricChanges: snapshot.world.metrics,
    changedCount: snapshot.citizens.length,
    noOp: false,
  };
}

export function diffBridgeSnapshots(previous, current) {
  if (!previous) return emptyDelta(current);
  const previousCitizens = new Map(previous.citizens.map((citizen) => [citizen.id, citizen]));
  const currentCitizens = new Map(current.citizens.map((citizen) => [citizen.id, citizen]));
  const addedCitizens = [];
  const changedCitizens = [];
  const removedCitizens = [];

  for (const citizen of current.citizens) {
    const before = previousCitizens.get(citizen.id);
    if (!before) addedCitizens.push(citizen.id);
    else if (changed(comparableCitizen(before), comparableCitizen(citizen))) {
      changedCitizens.push({ id: citizen.id, from: comparableCitizen(before), to: comparableCitizen(citizen) });
    }
  }
  for (const citizen of previous.citizens) if (!currentCitizens.has(citizen.id)) removedCitizens.push(citizen.id);

  const previousEventIds = new Set(previous.events.map((event) => event.id));
  const newEvents = current.events.filter((event) => !previousEventIds.has(event.id));
  const metricChanges = metricDiff(previous.world.metrics, current.world.metrics);
  const changedCount = addedCitizens.length + removedCitizens.length + changedCitizens.length + newEvents.length;
  return {
    schemaVersion: BRIDGE_SCHEMA,
    mode: "delta",
    fromTick: previous.world.tick,
    toTick: current.world.tick,
    tickDelta: current.world.tick - previous.world.tick,
    addedCitizens,
    removedCitizens,
    changedCitizens,
    newEvents,
    metricChanges,
    changedCount,
    noOp: changedCount === 0 && Object.keys(metricChanges).length === 0 && previous.world.time === current.world.time,
  };
}

function safeTag(prefix, id) {
  return `${prefix}_${String(id).replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function jsonText(value) {
  return JSON.stringify(String(value));
}

function markerCommands(marker, type) {
  const tag = safeTag(`scamcity_${type}`, marker.id);
  const { x, y, z } = marker.location.minecraft ?? marker.location;
  const tags = ["scamcity_marker", tag];
  const position = `${x} ${y} ${z}`;
  return {
    operation: "upsert_marker",
    entityKey: tag,
    type,
    id: marker.id,
    position: { x, y, z },
    color: marker.riskColor ?? marker.color,
    minecraftColor: marker.minecraftColor,
    minecraft: [
      `kill @e[type=minecraft:marker,tag=${tag}]`,
      `summon minecraft:marker ${position} {Tags:[${tags.map((item) => jsonText(item)).join(",")}]}`,
    ],
  };
}

function hudCommand(snapshot) {
  const highRisk = snapshot.citizens.filter((citizen) => citizen.riskBand === "high").length;
  const text = `SCAMCITY · DAY ${snapshot.world.day} · ${snapshot.world.time} · HIGH RISK ${highRisk}`;
  return {
    operation: "set_hud",
    minecraft: `title @a actionbar {"text":${jsonText(text)},"color":"aqua"}`,
    text,
  };
}

function eventCommand(event) {
  const severityColor = event.severity === "danger" ? "red" : event.severity === "success" ? "green" : event.severity === "warning" ? "yellow" : "white";
  return {
    operation: "broadcast_event",
    eventId: event.id,
    minecraft: `tellraw @a {"text":${jsonText(`[SCAMCITY] ${event.message}`)},"color":"${severityColor}"}`,
  };
}

export function buildCommandPlan(snapshot, delta, options = {}) {
  const fullSync = options.fullSync ?? delta.mode === "full";
  const changedIds = new Set(delta.changedCitizens.map((citizen) => citizen.id));
  const citizens = fullSync ? snapshot.citizens : snapshot.citizens.filter((citizen) => changedIds.has(citizen.id));
  const commands = [];
  if (fullSync) {
    commands.push({
      operation: "clear_markers",
      minecraft: "kill @e[type=minecraft:marker,tag=scamcity_marker]",
    });
  }
  for (const citizen of citizens) commands.push(markerCommands(citizen, "citizen"));
  if (fullSync) for (const scammer of snapshot.scammers) commands.push(markerCommands({ ...scammer, location: { minecraft: scammer.location } }, "scammer"));
  commands.push(hudCommand(snapshot));
  for (const event of delta.newEvents.slice(-5)) commands.push(eventCommand(event));

  return {
    schemaVersion: BRIDGE_SCHEMA,
    target: "minecraft-java",
    mode: fullSync ? "full-sync" : "delta-sync",
    sourceTick: snapshot.world.tick,
    generatedAt: new Date().toISOString(),
    commands,
    summary: {
      markerCommands: commands.filter((command) => command.operation === "upsert_marker").length,
      eventCommands: commands.filter((command) => command.operation === "broadcast_event").length,
      fullSync,
    },
  };
}

export function validateBridgeSnapshot(snapshot) {
  const problems = [];
  if (snapshot?.schemaVersion !== BRIDGE_SCHEMA) problems.push(`unexpected schemaVersion: ${snapshot?.schemaVersion}`);
  if (!Array.isArray(snapshot?.citizens) || snapshot.citizens.length !== 100) problems.push("bridge snapshot must contain 100 citizens");
  if (!Array.isArray(snapshot?.scammers) || snapshot.scammers.length !== 5) problems.push("bridge snapshot must contain 5 scammers");
  const eventIds = (snapshot?.events ?? []).map((event) => event.id);
  if (new Set(eventIds).size !== eventIds.length) problems.push("bridge snapshot contains duplicate event ids");
  for (const citizen of snapshot?.citizens ?? []) {
    const position = citizen.location?.minecraft;
    if (!position || ![position.x, position.y, position.z].every(Number.isInteger)) problems.push(`invalid Minecraft position for ${citizen.id}`);
    if (!RISK_COLORS[citizen.riskBand] || citizen.riskColor !== RISK_COLORS[citizen.riskBand].hex) problems.push(`invalid risk color for ${citizen.id}`);
  }
  if (problems.length) throw new Error(`Invalid bridge snapshot: ${problems.join("; ")}`);
  return { citizenCount: snapshot.citizens.length, scammerCount: snapshot.scammers.length, eventCount: eventIds.length };
}

export function createOfflineWorld(seed = 42) {
  const zones = ["residential", "commercial", "campus", "waterfront", "transit"];
  const states = ["safe", "safe", "safe", "suspicious", "engaged", "protected"];
  const citizens = Array.from({ length: 100 }, (_, index) => {
    const n = index + 1;
    const state = states[index % states.length];
    return {
      id: `citizen-${String(n).padStart(3, "0")}`,
      name: `Offline Citizen ${String(n).padStart(3, "0")}`,
      age: 20 + ((index * 7) % 55),
      occupation: "Software Engineer",
      digitalLiteracy: 35 + ((index * 13) % 60),
      riskAwareness: 25 + ((index * 17) % 70),
      stress: 12 + ((index * 11) % 78),
      impulsiveness: 10 + ((index * 19) % 85),
      location: { x: (index * 37 + 11) % 101, y: (index * 61 + 7) % 101, zone: zones[index % zones.length] },
      state,
      isHub: [4, 17, 38, 59, 80].includes(index),
    };
  });
  const scammers = [
    ["scammer-01", "Service Desk Mirage", "fake-customer-service"],
    ["scammer-02", "Yield Hunter", "fake-investment"],
    ["scammer-03", "Familiar Voice", "impersonation"],
    ["scammer-04", "Official Line", "authority-scam"],
    ["scammer-05", "Clickbait Relay", "phishing-link"],
  ].map(([id, name, strategy]) => ({ id, name, strategy, active: true }));
  const eventFeed = [
    { id: `event-${seed}-1`, tick: 0, time: "Day 1 · 08:00", kind: "system", message: "100 synthetic citizens are living their normal lives.", severity: "info" },
    { id: `event-${seed}-2`, tick: 0, time: "Day 1 · 08:00", kind: "system", message: "Five scam agents are waiting outside the city boundary.", severity: "warning" },
    { id: `event-${seed}-3`, tick: 4, time: "Day 1 · 08:20", kind: "scam", message: "Offline fixture: a suspicious message reached the city.", severity: "warning", citizenId: "citizen-004", scammerId: "scammer-01" },
    { id: `event-${seed}-4`, tick: 5, time: "Day 1 · 08:25", kind: "intervention", message: "Offline fixture: a guardian warning was delivered.", severity: "success", citizenId: "citizen-004" },
  ];
  return {
    version: 1,
    seed,
    rngState: 123456789,
    tick: 5,
    day: 1,
    time: "Day 1 · 08:25",
    phase: "running",
    citizens,
    socialGraph: { nodes: citizens.map((citizen) => citizen.id), edges: [], hubs: citizens.filter((citizen) => citizen.isHub).map((citizen) => citizen.id) },
    scammers,
    messages: [],
    interactions: [],
    eventFeed,
    eventSequence: eventFeed.length,
    metrics: { victims: 0, moneyLost: 0, fraudAttempts: 1, warningsSent: 1, successfulInterventions: 1, safetyIndex: 98, trustIndex: 72 },
    activeInterventions: ["social-guardian"],
    interventionHistory: [],
    networkInfluencerIds: citizens.filter((citizen) => citizen.isHub).map((citizen) => citizen.id),
  };
}

export function formatBridgeLog(result) {
  const { snapshot, delta, commandPlan } = result;
  const riskCounts = snapshot.citizens.reduce((counts, citizen) => {
    counts[citizen.riskBand] = (counts[citizen.riskBand] ?? 0) + 1;
    return counts;
  }, {});
  const eventLines = delta.newEvents.slice(-5).map((event) => `  [${event.severity}] #${event.id} ${event.message}`);
  return [
    "SCAMCITY ↔ MINECRAFT BRIDGE",
    `schema ${snapshot.schemaVersion}`,
    `world seed=${snapshot.world.seed} day=${snapshot.world.day} tick=${snapshot.world.tick} ${snapshot.world.time}`,
    `citizens=${snapshot.citizens.length} scammers=${snapshot.scammers.length} relationships=${snapshot.world.relationships}`,
    `risk colors: low/green=${riskCounts.low ?? 0} medium/yellow=${riskCounts.medium ?? 0} high/red=${riskCounts.high ?? 0}`,
    `map: origin=(${snapshot.map.origin.x},${snapshot.map.origin.y},${snapshot.map.origin.z}) size=${snapshot.map.width}×${snapshot.map.depth}`,
    `delta: mode=${delta.mode} changed=${delta.changedCount} newEvents=${delta.newEvents.length} noOp=${delta.noOp}`,
    `command plan: ${commandPlan.mode} markers=${commandPlan.summary.markerCommands} events=${commandPlan.summary.eventCommands}`,
    ...(eventLines.length ? ["new events:", ...eventLines] : ["new events: none"]),
  ].join("\n");
}

export function resultForWorld(world, options = {}, previous = null) {
  const snapshot = toBridgeSnapshot(world, options);
  validateBridgeSnapshot(snapshot);
  const delta = diffBridgeSnapshots(previous, snapshot);
  const commandPlan = buildCommandPlan(snapshot, delta, options);
  return { snapshot, delta, commandPlan };
}

export function stableSourceId(value) {
  return stableHash(value);
}
