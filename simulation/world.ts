import { createSyntheticCitizens, appendCitizenTimeline, moveCitizen } from "@/simulation/citizen";
import {
  calculateFraudProbability,
  evaluateFraud,
} from "@/simulation/fraud-engine";
import {
  activateIntervention,
  bankRiskFalsePositive,
  bankRiskShouldBlock,
  guardianAlertTarget,
  guardianInterruptionProbability,
  isInterventionActive,
  networkCoverage,
} from "@/simulation/intervention";
import {
  appendLossPoint,
  applyInteractionToMetrics,
  cloneMetrics,
  createInitialMetrics,
  recalculateOutcomeMetrics,
} from "@/simulation/metrics";
import { SeededRandom, clamp, round } from "@/simulation/seeded-random";
import { findFamilyGuardian, getNeighbors } from "@/simulation/social-graph";
import { affectedStrategiesFor, susceptibilityBoostFor } from "@/simulation/audience-events";
import { verdictFor } from "@/simulation/comparison";
import { createScamMessage, createScammerAgents, selectScamTarget } from "@/agents/scammer-agent";
import type {
  Citizen,
  AudienceEvent,
  AudienceEventType,
  ComparisonSummary,
  ComparisonVerdict,
  FraudDecision,
  InterventionStrategy,
  ScamInteraction,
  ScamMessage,
  SimulationEvent,
  SimulationSettings,
  SimulationTickOptions,
  WorldState,
} from "@/types";
import { createSocialGraph } from "@/simulation/social-graph";

export const DEFAULT_SIMULATION_SETTINGS: SimulationSettings = {
  ticksPerDay: 72,
  totalDays: 7,
  scammerActionInterval: 4,
  maxEventFeed: 120,
  maxInteractions: 2_000,
};

const STRATEGIES: InterventionStrategy[] = [
  "baseline",
  "mass-warning",
  "bank-risk-agent",
  "social-guardian",
  "network-intervention",
];

export function createWorld(seed = 42, settings: Partial<SimulationSettings> = {}): WorldState {
  const random = new SeededRandom(seed);
  const citizens = createSyntheticCitizens(random, 100);
  const socialGraph = createSocialGraph(citizens, random);
  const resolvedSettings = { ...DEFAULT_SIMULATION_SETTINGS, ...settings };
  const world: WorldState = {
    version: 1,
    seed,
    rngState: random.getState(),
    tick: 0,
    day: 1,
    time: "Day 1 · 08:00",
    phase: "idle",
    citizens,
    socialGraph,
    scammers: createScammerAgents(),
    messages: [],
    interactions: [],
    eventFeed: [],
    eventSequence: 0,
    audienceEvents: [],
    metrics: createInitialMetrics(),
    settings: resolvedSettings,
    activeInterventions: [],
    interventionHistory: [],
    networkInfluencerIds: socialGraph.hubs.slice(0, 5),
  };
  addEvent(world, {
    kind: "system",
    message: "100 synthetic citizens are living their normal lives.",
    severity: "info",
  });
  addEvent(world, {
    kind: "system",
    message: "Five scam agents are waiting outside the city boundary.",
    severity: "warning",
  });
  appendLossPoint(world.metrics, 0, 1, world.time);
  return world;
}

export function cloneWorld(world: WorldState): WorldState {
  return JSON.parse(JSON.stringify(world)) as WorldState;
}

export function resetWorld(seed = 42, settings: Partial<SimulationSettings> = {}): WorldState {
  return createWorld(seed, settings);
}

export function tickSimulation(world: WorldState, options: SimulationTickOptions = {}): WorldState {
  const next = cloneWorld(world);
  // A paused or completed world is a stable observation point.  Callers that
  // intentionally want to advance a paused run must resume it first; this
  // prevents polling bridges from mutating the world while it is on display.
  if (next.phase === "paused" || next.phase === "complete") return next;
  advanceInPlace(next, options);
  return next;
}

export function stepWorld(world: WorldState, options: SimulationTickOptions = {}): WorldState {
  return tickSimulation(world, options);
}

export function runSimulation(
  initialWorld: WorldState,
  options: SimulationTickOptions & { ticks?: number; days?: number } = {},
): WorldState {
  const world = cloneWorld(initialWorld);
  const ticks = options.ticks ?? Math.round((options.days ?? world.settings.totalDays) * world.settings.ticksPerDay);
  world.phase = "running";
  for (let index = 0; index < Math.max(0, ticks); index += 1) advanceInPlace(world, options);
  world.phase = "complete";
  recalculateOutcomeMetrics(world.metrics, world.citizens, world.interactions);
  appendLossPoint(world.metrics, world.tick, world.day, world.time);
  return world;
}

export function runDays(initialWorld: WorldState, days = 7, options: SimulationTickOptions = {}): WorldState {
  return runSimulation(initialWorld, { ...options, days });
}

export function pauseWorld(world: WorldState): WorldState {
  const next = cloneWorld(world);
  next.phase = "paused";
  return next;
}

export function resumeWorld(world: WorldState): WorldState {
  const next = cloneWorld(world);
  next.phase = "running";
  return next;
}

export function applyIntervention(world: WorldState, strategy: InterventionStrategy): WorldState {
  const next = cloneWorld(world);
  activateIntervention(next, strategy);
  addEvent(next, {
    kind: "intervention",
    message: `${strategyLabel(strategy)} activated across the synthetic city.`,
    severity: "success",
  });
  return next;
}

/**
 * Record an audience-triggered incident in the world. Incidents are a
 * structured, whitelisted contract: the accepted event stores the scam
 * strategies it amplifies, so the deterministic model applies a bounded effect
 * while the caller's free text is only used as a display label.
 */
export function injectAudienceEvent(
  world: WorldState,
  input: Pick<AudienceEvent, "eventId" | "type" | "duration" | "label">,
): WorldState {
  const next = cloneWorld(world);
  const audienceEvents = next.audienceEvents ?? (next.audienceEvents = []);
  if (audienceEvents.some((event) => event.eventId === input.eventId)) return next;

  const affectedStrategies = affectedStrategiesFor(input.type);
  const event: AudienceEvent = {
    ...input,
    startTick: next.tick,
    endTick: next.tick + input.duration,
    affectedStrategies,
    susceptibilityBoost: susceptibilityBoostFor(input.type),
  };
  audienceEvents.push(event);
  addEvent(next, {
    kind: "audience",
    message: `📣 ${input.label} · ${input.type} · ${input.duration} ticks · amplifies ${affectedStrategies.join(", ")}`,
    audienceEventId: input.eventId,
    severity: "warning",
  });
  return next;
}

/** Active incident types at the current tick, consumed by the decision model. */
export function activeAudienceEventTypes(world: WorldState): AudienceEventType[] {
  return Array.from(new Set(getActiveAudienceEvents(world).map((event) => event.type))).sort();
}

export function getActiveAudienceEvents(world: WorldState): AudienceEvent[] {
  return (world.audienceEvents ?? [])
    .filter((event) => event.startTick <= world.tick && world.tick < event.endTick)
    .map((event) => ({ ...event }));
}

export function compareStrategies(
  seed = 42,
  options: { days?: number; ticks?: number; settings?: Partial<SimulationSettings> } = {},
): ComparisonSummary[] {
  const results: ComparisonSummary[] = [];
  for (const strategy of STRATEGIES) {
    let world = createWorld(seed, options.settings);
    if (strategy !== "baseline") world = applyIntervention(world, strategy);
    world = runSimulation(world, {
      days: options.days ?? world.settings.totalDays,
      ticks: options.ticks,
      processScams: true,
      compactEvents: true,
    });
    results.push({
      strategy,
      label: strategyLabel(strategy),
      metrics: cloneMetrics(world.metrics),
      world,
    });
  }
  return results;
}

/**
 * Compare additional interventions from the same observed city, including its
 * incident ledger, prior losses and active protections. Baseline means no NEW
 * intervention, not removal of protections already applied. Metrics remain
 * cumulative; subtract the snapshot metrics when displaying future deltas.
 *
 * Branches start with the same RNG state, but intervention-dependent random
 * consumption can change later encounters. This is not paired causal evidence.
 * `days` and `ticks` are future durations, even for a completed snapshot.
 */
export function compareFromSnapshot(
  snapshot: WorldState,
  options: { days?: number; ticks?: number } = {},
): ComparisonSummary[] {
  const duration = options.ticks ?? (options.days ?? snapshot.settings.totalDays) * snapshot.settings.ticksPerDay;
  if (!Number.isFinite(duration) || duration < 0 || (options.ticks !== undefined && !Number.isInteger(duration))) {
    throw new RangeError("Comparison horizon must be finite and non-negative; ticks must be an integer.");
  }
  const ticks = Math.round(duration);
  return STRATEGIES.map((strategy) => {
    const alreadyActive = snapshot.activeInterventions.includes(strategy);
    const branch = strategy === "baseline" || alreadyActive
      ? cloneWorld(snapshot)
      : applyIntervention(snapshot, strategy);
    const world = runSimulation(branch, { ticks, processScams: true, compactEvents: true });
    return {
      strategy,
      label: strategy === "baseline"
        ? "No additional intervention"
        : `${strategyLabel(strategy)} (${alreadyActive ? "already active" : "added"})`,
      metrics: cloneMetrics(world.metrics),
      world,
    };
  });
}

/**
 * The single shared "best" rule. Callers must not re-sort on one metric:
 * `verdictFor` applies 少损失 → 少受害 → 可接受误报 → 成本可解释 and carries the
 * reason string that the UI and the run report display.
 */
export function bestComparison(results: ComparisonSummary[]): ComparisonSummary | undefined {
  const verdict = verdictFor(results);
  if (!verdict) return undefined;
  return results.find((result) => result.strategy === verdict.bestStrategy);
}

export function comparisonVerdict(results: ComparisonSummary[]): ComparisonVerdict | undefined {
  return verdictFor(results);
}

export function strategyLabel(strategy: InterventionStrategy): string {
  switch (strategy) {
    case "baseline":
      return "Baseline";
    case "mass-warning":
      return "Mass Warning";
    case "bank-risk-agent":
      return "Bank Risk Agent";
    case "social-guardian":
      return "Social Guardian";
    case "network-intervention":
      return "Network Intervention";
  }
}

function advanceInPlace(world: WorldState, options: SimulationTickOptions): void {
  const random = new SeededRandom();
  random.setState(world.rngState);
  world.tick += 1;
  // totalDays is the default experiment horizon, not a hard clock limit.
  // Keeping the actual day in sync with `time` matters when an operator runs
  // a longer replay from the API or leaves the bridge running for hours.
  world.day = Math.floor((world.tick - 1) / Math.max(1, world.settings.ticksPerDay)) + 1;
  world.time = formatSimulationTime(world.tick, world.settings.ticksPerDay);
  if (world.phase === "idle") world.phase = "running";

  for (const citizen of world.citizens) moveCitizen(citizen, random);
  const processScams = options.processScams !== false;
  if (processScams && world.tick % world.settings.scammerActionInterval === 0) {
    processScammerTurn(world, random);
  }
  // A network intervention keeps seeding awareness in later rounds. The first
  // activation covers the graph; later propagation is intentionally modest.
  if (isInterventionActive(world, "network-intervention") && world.tick % 18 === 0) {
    const reached = new Set<string>();
    for (const hubId of world.networkInfluencerIds) {
      for (const id of world.socialGraph.adjacency[hubId] ?? []) reached.add(id);
    }
    for (const id of reached) {
      const citizen = world.citizens.find((entry) => entry.id === id);
      if (citizen) {
        citizen.warningsReceived += 1;
        citizen.riskAwareness = clamp(citizen.riskAwareness + 2);
        world.metrics.warningsSent += 0.25;
      }
    }
  }
  recalculateOutcomeMetrics(world.metrics, world.citizens, world.interactions);
  appendLossPoint(world.metrics, world.tick, world.day, world.time);
  world.rngState = random.getState();
}

function processScammerTurn(world: WorldState, random: SeededRandom): void {
  const activeScammers = world.scammers.filter((scammer) => scammer.active);
  if (!activeScammers.length) return;
  const turn = Math.floor(world.tick / world.settings.scammerActionInterval);
  const agent = activeScammers[turn % activeScammers.length];
  const target = selectScamTarget(world.citizens, agent.strategy, random);
  if (!target) return;
  const message = createScamMessage(agent, target, world.tick, random);
  const socialProof = getNeighbors(world.socialGraph, target.id)
    .map((id) => world.citizens.find((citizen) => citizen.id === id))
    .filter((citizen): citizen is Citizen => Boolean(citizen))
    .filter((citizen) => citizen.state === "engaged" || citizen.state === "trusted" || citizen.state === "clicked").length * 9;
  const activeIncidents = activeAudienceEventTypes(world);
  const evaluation = evaluateFraud(target, {
    strategy: agent.strategy,
    socialProof,
    amount: message.amount,
    content: message.content,
    activeIncidents,
  }, random);
  message.status = evaluation.decision;
  message.probability = evaluation.probability.probability;
  message.amount = evaluation.amount;
  message.factors = evaluation.probability.factors;
  world.messages.push(message);
  if (world.messages.length > 180) world.messages.splice(0, world.messages.length - 180);
  target.previousScamAttempts += 1;
  target.lastInteractionTick = world.tick;
  target.currentThought = evaluation.thought;
  target.state = stateForDecision(evaluation.decision, evaluation.probability.probability);
  appendCitizenTimeline(target, {
    tick: world.tick,
    time: world.time,
    type: "scam",
    message: `${agent.name} sent a ${agent.strategy} message: ${evaluation.decision}.`,
  });
  addEvent(world, {
    kind: "scam",
    message: `⚠ ${agent.name} targeted ${target.name}`,
    citizenId: target.id,
    scammerId: agent.id,
    severity: "warning",
  });

  const interaction: ScamInteraction = {
    id: `interaction-${world.tick}-${agent.id}`,
    tick: world.tick,
    citizenId: target.id,
    scammerId: agent.id,
    strategy: agent.strategy,
    decision: evaluation.decision,
    probability: evaluation.probability.probability,
    amount: evaluation.amount,
    interrupted: false,
  };
  if (evaluation.decision !== "ignore") {
    addEvent(world, {
      kind: "citizen",
      message: `${target.name} ${decisionMessage(evaluation.decision)} (${Math.round(evaluation.probability.susceptibility)}% modeled risk)`,
      citizenId: target.id,
      severity: evaluation.decision === "transfer" ? "danger" : "warning",
    });
  }

  if (evaluation.decision === "transfer") {
    addEvent(world, {
      kind: "outcome",
      message: `💸 ${target.name} initiated HK$${evaluation.amount.toLocaleString()} transfer`,
      citizenId: target.id,
      severity: "danger",
    });
    if (isInterventionActive(world, "bank-risk-agent") && bankRiskShouldBlock(target, evaluation.amount, evaluation.probability.probability, random)) {
      blockTransfer(world, target, interaction, message, "Bank Risk Agent detected an anomalous transfer.");
    } else if (isInterventionActive(world, "social-guardian") && maybeGuardianIntervention(world, target, interaction, message, random)) {
      // maybeGuardianIntervention handles the state and event.
    } else {
      target.state = "victim";
      target.assets = Math.max(0, target.assets - evaluation.amount);
      agent.successfulTransfers += 1;
      appendCitizenTimeline(target, {
        tick: world.tick,
        time: world.time,
        type: "loss",
        message: `Transferred HK$${evaluation.amount.toLocaleString()} to a fraudulent account.`,
      });
      addEvent(world, {
        kind: "outcome",
        message: `❌ ${target.name} was defrauded`,
        citizenId: target.id,
        severity: "danger",
      });
    }
  } else if (evaluation.decision === "click" && isInterventionActive(world, "social-guardian")) {
    maybeGuardianIntervention(world, target, interaction, message, random);
  } else if (isInterventionActive(world, "bank-risk-agent") && evaluation.decision === "ignore" && bankRiskFalsePositive(target, random)) {
    world.metrics.falsePositives += 1;
    addEvent(world, {
      kind: "intervention",
      message: `Bank Risk Agent delayed a low-risk payment from ${target.name} (false positive).`,
      citizenId: target.id,
      severity: "warning",
    });
  }

  world.interactions.push(interaction);
  if (world.interactions.length > world.settings.maxInteractions) {
    world.interactions.splice(0, world.interactions.length - world.settings.maxInteractions);
  }
  applyInteractionToMetrics(world.metrics, interaction);
}

function maybeGuardianIntervention(
  world: WorldState,
  target: Citizen,
  interaction: ScamInteraction,
  message: ScamMessage,
  random: SeededRandom,
): boolean {
  const guardian = guardianAlertTarget(world, target) ?? findFamilyGuardian(world.citizens, world.socialGraph, target.id);
  if (!guardian) return false;
  addEvent(world, {
    kind: "intervention",
    message: `🛡 Guardian Agent detected risk and notified ${guardian.name}`,
    citizenId: target.id,
    severity: "warning",
  });
  const probability = guardianInterruptionProbability(target, guardian);
  if (!random.chance(probability)) return false;
  interaction.interrupted = true;
  interaction.intervention = "social-guardian";
  interaction.decision = "cancelled";
  message.status = "cancelled";
  target.state = "protected";
  target.currentThought = `${guardian.name} warned me before I completed the request.`;
  world.metrics.successfulInterventions += 1;
  world.metrics.warningsSent += 1;
  world.metrics.interventionCost += 2;
  appendCitizenTimeline(target, {
    tick: world.tick,
    time: world.time,
    type: "guardian",
    message: `${guardian.name} called and interrupted the suspicious action.`,
  });
  addEvent(world, {
    kind: "outcome",
    message: `✅ ${guardian.name} helped ${target.name} stop the transfer`,
    citizenId: target.id,
    severity: "success",
  });
  return true;
}

function blockTransfer(
  world: WorldState,
  target: Citizen,
  interaction: ScamInteraction,
  message: ScamMessage,
  reason: string,
): void {
  interaction.interrupted = true;
  interaction.intervention = "bank-risk-agent";
  interaction.decision = "blocked";
  message.status = "blocked";
  target.state = "protected";
  target.currentThought = "The bank paused this transfer and asked me to confirm the recipient.";
  world.metrics.successfulInterventions += 1;
  appendCitizenTimeline(target, {
    tick: world.tick,
    time: world.time,
    type: "bank-agent",
    message: reason,
  });
  addEvent(world, {
    kind: "intervention",
    message: `🛡 Bank Risk Agent blocked ${target.name}'s transfer`,
    citizenId: target.id,
    severity: "success",
  });
}

function addEvent(world: WorldState, event: Omit<SimulationEvent, "id" | "tick" | "time">): void {
  world.eventSequence = (world.eventSequence ?? 0) + 1;
  world.eventFeed.push({
    ...event,
    id: `event-${world.seed}-${world.eventSequence}`,
    tick: world.tick,
    time: world.time,
  });
  if (world.eventFeed.length > world.settings.maxEventFeed) {
    world.eventFeed.splice(0, world.eventFeed.length - world.settings.maxEventFeed);
  }
}

function formatSimulationTime(tick: number, ticksPerDay: number): string {
  const minutesPerTick = (24 * 60) / Math.max(1, ticksPerDay);
  const totalMinutes = Math.floor(8 * 60 + (tick - 1) * minutesPerTick);
  const dayMinutes = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(dayMinutes / 60).toString().padStart(2, "0");
  const minutes = Math.floor(dayMinutes % 60).toString().padStart(2, "0");
  const day = Math.floor((tick - 1) / Math.max(1, ticksPerDay)) + 1;
  return `Day ${day} · ${hours}:${minutes}`;
}

function decisionMessage(decision: FraudDecision): string {
  switch (decision) {
    case "engage":
      return "opened the message";
    case "trust":
      return "trusted the sender";
    case "click":
      return "clicked the link";
    case "transfer":
      return "started a transfer";
    case "ignore":
      return "ignored the message";
    case "blocked":
      return "was stopped by a risk control";
    case "cancelled":
      return "cancelled the action";
  }
}

function stateForDecision(decision: FraudDecision, probability: number): Citizen["state"] {
  if (decision === "ignore") return probability > 0.53 ? "suspicious" : "safe";
  if (decision === "engage") return "engaged";
  if (decision === "trust") return "trusted";
  if (decision === "click") return "clicked";
  return "victim";
}

export function getWorldOverview(world: WorldState): {
  citizens: number;
  relationships: number;
  totalAssets: number;
  day: number;
  activeScammers: number;
  networkCoverage: number;
} {
  return {
    citizens: world.citizens.length,
    relationships: world.socialGraph.edges.length,
    totalAssets: world.citizens.reduce((sum, citizen) => sum + citizen.assets, 0),
    day: world.day,
    activeScammers: world.scammers.filter((scammer) => scammer.active).length,
    networkCoverage: networkCoverage(world),
  };
}
