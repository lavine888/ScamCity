import type {
  Citizen,
  FunnelMetrics,
  InterventionStrategy,
  LossPoint,
  ScamInteraction,
  SimulationMetrics,
  WorldState,
} from "@/types";
import { clamp, round } from "@/simulation/seeded-random";

export function createInitialMetrics(): SimulationMetrics {
  return {
    victims: 0,
    moneyLost: 0,
    fraudAttempts: 0,
    warningsSent: 0,
    falsePositives: 0,
    successfulInterventions: 0,
    interventionCost: 0,
    safetyIndex: 100,
    trustIndex: 72,
    funnel: {
      messagesSent: 0,
      engaged: 0,
      trusted: 0,
      clicked: 0,
      transferred: 0,
    },
    lossHistory: [],
  };
}

export function applyInteractionToMetrics(metrics: SimulationMetrics, interaction: ScamInteraction): void {
  metrics.fraudAttempts += 1;
  metrics.funnel.messagesSent += 1;
  if (interaction.decision !== "ignore") metrics.funnel.engaged += 1;
  if (["trust", "click", "transfer", "blocked", "cancelled"].includes(interaction.decision)) {
    metrics.funnel.trusted += 1;
  }
  if (["click", "transfer", "blocked", "cancelled"].includes(interaction.decision)) {
    metrics.funnel.clicked += 1;
  }
  if (interaction.decision === "transfer" && !interaction.interrupted) {
    metrics.funnel.transferred += 1;
    metrics.moneyLost += interaction.amount;
  }
}

export function recalculateOutcomeMetrics(
  metrics: SimulationMetrics,
  citizens: Citizen[],
  interactions: ScamInteraction[],
): SimulationMetrics {
  const victims = new Set(
    interactions
      .filter((interaction) => interaction.decision === "transfer" && !interaction.interrupted)
      .map((interaction) => interaction.citizenId),
  );
  metrics.victims = victims.size;
  metrics.moneyLost = interactions
    .filter((interaction) => interaction.decision === "transfer" && !interaction.interrupted)
    .reduce((sum, interaction) => sum + interaction.amount, 0);
  metrics.fraudAttempts = interactions.length;
  metrics.funnel = {
    messagesSent: interactions.length,
    engaged: interactions.filter((interaction) => interaction.decision !== "ignore").length,
    trusted: interactions.filter((interaction) => ["trust", "click", "transfer", "blocked", "cancelled"].includes(interaction.decision)).length,
    clicked: interactions.filter((interaction) => ["click", "transfer", "blocked", "cancelled"].includes(interaction.decision)).length,
    transferred: interactions.filter((interaction) => interaction.decision === "transfer" && !interaction.interrupted).length,
  };
  const totalAssets = citizens.reduce((sum, citizen) => sum + citizen.assets, 0);
  const victimPenalty = (victims.size / Math.max(1, citizens.length)) * 78;
  const lossPenalty = (metrics.moneyLost / Math.max(1, totalAssets)) * 100;
  const interventionBonus = Math.min(15, metrics.successfulInterventions * 0.7);
  metrics.safetyIndex = round(clamp(100 - victimPenalty - lossPenalty + interventionBonus));
  const awareness = citizens.length
    ? citizens.reduce((sum, citizen) => sum + citizen.riskAwareness, 0) / citizens.length
    : 0;
  const trustDamage = Math.min(25, metrics.victims * 0.35);
  metrics.trustIndex = round(clamp(awareness + 25 - trustDamage));
  return metrics;
}

export function appendLossPoint(metrics: SimulationMetrics, tick: number, day: number, label: string): void {
  const point: LossPoint = {
    tick,
    day,
    label,
    loss: Math.round(metrics.moneyLost),
    victims: metrics.victims,
  };
  const previous = metrics.lossHistory[metrics.lossHistory.length - 1];
  if (previous?.tick === tick) metrics.lossHistory[metrics.lossHistory.length - 1] = point;
  else metrics.lossHistory.push(point);
  if (metrics.lossHistory.length > 150) metrics.lossHistory.splice(0, metrics.lossHistory.length - 150);
}

export function cloneMetrics(metrics: SimulationMetrics): SimulationMetrics {
  return {
    ...metrics,
    funnel: { ...metrics.funnel },
    lossHistory: metrics.lossHistory.map((point) => ({ ...point })),
  };
}

export function metricsForWorld(world: WorldState): SimulationMetrics {
  recalculateOutcomeMetrics(world.metrics, world.citizens, world.interactions);
  return world.metrics;
}

export interface MetricDelta {
  victims: number;
  moneyLost: number;
  safetyIndex: number;
  interventionCost: number;
  falsePositives: number;
}

export function compareMetricDelta(baseline: SimulationMetrics, candidate: SimulationMetrics): MetricDelta {
  return {
    victims: baseline.victims - candidate.victims,
    moneyLost: baseline.moneyLost - candidate.moneyLost,
    safetyIndex: candidate.safetyIndex - baseline.safetyIndex,
    interventionCost: candidate.interventionCost,
    falsePositives: candidate.falsePositives,
  };
}

export function labelForStrategy(strategy: InterventionStrategy): string {
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

