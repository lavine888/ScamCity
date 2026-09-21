import {
  applyIntervention,
  cloneWorld as cloneSimulationWorld,
  compareStrategies,
  createWorld,
  runSimulation,
  tickSimulation,
} from "@/simulation/world";
import type {
  ComparisonSummary,
  InterventionStrategy,
  SimulationEvent,
  SimulationMetrics,
  WorldState,
} from "@/types";

export interface ComparisonResult {
  label?: string;
  strategy: InterventionStrategy;
  metrics: SimulationMetrics;
  world: WorldState;
}

/** UI adapter: all state transitions are delegated to the deterministic engine. */
export function createDemoWorld(seed = 42): WorldState {
  return createWorld(seed);
}

export function cloneWorld(world: WorldState): WorldState {
  return cloneSimulationWorld(world);
}

/** Mutates the supplied snapshot so existing React callbacks can stay small. */
export function advanceWorld(world: WorldState, ticks = 1): WorldState {
  let current = world;
  for (let index = 0; index < Math.max(0, Math.floor(ticks)); index += 1) {
    current = tickSimulation(current, { processScams: true });
  }
  Object.assign(world, current);
  return world;
}

export function activateDemoIntervention(world: WorldState, strategy: InterventionStrategy): WorldState {
  Object.assign(world, applyIntervention(world, strategy));
  return world;
}

export function simulateStrategy(seed: number, strategy: InterventionStrategy, days = 7): ComparisonResult {
  const result = compareStrategies(seed, { days }).find((candidate) => candidate.strategy === strategy);
  if (!result) {
    const world = runSimulation(createWorld(seed), { days });
    return { strategy, metrics: world.metrics, world };
  }
  return comparisonResultFromSummary(result);
}

function comparisonResultFromSummary(result: ComparisonSummary): ComparisonResult {
  return { strategy: result.strategy, label: result.label, metrics: result.metrics, world: result.world };
}

export function addDemoEvent(
  world: WorldState,
  message: string,
  severity: SimulationEvent["severity"] = "info",
): WorldState {
  world.eventSequence = (world.eventSequence ?? 0) + 1;
  world.eventFeed.push({
    id: `event-${world.seed}-${world.eventSequence}`,
    tick: world.tick,
    time: world.time,
    kind: "system",
    message,
    severity,
  });
  if (world.eventFeed.length > world.settings.maxEventFeed) {
    world.eventFeed.splice(0, world.eventFeed.length - world.settings.maxEventFeed);
  }
  return world;
}

export function formatMoney(value: number): string {
  return `HK$${Math.round(value).toLocaleString("en-HK")}`;
}

export function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}
