import type {
  Citizen,
  InterventionRecord,
  InterventionStrategy,
  WorldState,
} from "@/types";
import { findFamilyGuardian, propagateWarning, influenceReach } from "@/simulation/social-graph";
import { clamp, round, SeededRandom } from "@/simulation/seeded-random";

export const INTERVENTION_COSTS: Record<InterventionStrategy, number> = {
  baseline: 0,
  "mass-warning": 100,
  "bank-risk-agent": 1_250,
  "social-guardian": 650,
  "network-intervention": 300,
};

export function activateIntervention(world: WorldState, strategy: InterventionStrategy): InterventionRecord {
  if (strategy === "baseline" || world.activeInterventions.includes(strategy)) {
    return {
      strategy,
      tick: world.tick,
      cost: 0,
      warningsSent: 0,
      coverage: 0,
    };
  }
  world.activeInterventions.push(strategy);
  let warningsSent = 0;
  let coverage = 0;
  if (strategy === "mass-warning") {
    for (const citizen of world.citizens) {
      citizen.warningsReceived += 1;
      citizen.riskAwareness = clamp(citizen.riskAwareness + 18);
      citizen.warningFatigue = clamp(citizen.warningFatigue + 3);
      warningsSent += 1;
    }
    coverage = world.citizens.length;
  } else if (strategy === "network-intervention") {
    world.networkInfluencerIds = world.socialGraph.hubs.slice(0, 5);
    const reached = propagateWarning(world.citizens, world.socialGraph, world.networkInfluencerIds, 20, 2);
    warningsSent = world.networkInfluencerIds.length;
    coverage = reached.length;
  } else if (strategy === "social-guardian") {
    // Guardians are contacted just in time by the tick engine, so initial
    // coverage is zero and the record grows as alerts are triggered.
    coverage = 0;
  } else if (strategy === "bank-risk-agent") {
    // The bank agent is a rule layer around transfers and does not broadcast.
    coverage = world.citizens.length;
  }
  const record: InterventionRecord = {
    strategy,
    tick: world.tick,
    cost: INTERVENTION_COSTS[strategy],
    warningsSent,
    coverage,
  };
  world.interventionHistory.push(record);
  world.metrics.warningsSent += warningsSent;
  world.metrics.interventionCost += record.cost;
  return record;
}

export function isInterventionActive(world: WorldState, strategy: InterventionStrategy): boolean {
  return world.activeInterventions.includes(strategy);
}

export function bankRiskShouldBlock(
  citizen: Citizen,
  amount: number,
  probability: number,
  random: SeededRandom,
): boolean {
  const highAmount = amount >= Math.max(8_000, citizen.assets * 0.025);
  const anomaly = clamp(probability * 0.8 + (highAmount ? 0.2 : 0));
  return highAmount && random.chance(0.62 + anomaly * 0.25);
}

export function bankRiskFalsePositive(citizen: Citizen, random: SeededRandom): boolean {
  // A small, visible trade-off: the risk model sometimes delays a legitimate
  // looking low-risk payment, which becomes a false positive metric.
  return citizen.riskAwareness > 70 && citizen.stress < 38 && random.chance(0.018);
}

export function guardianAlertTarget(world: WorldState, citizen: Citizen): Citizen | undefined {
  return findFamilyGuardian(world.citizens, world.socialGraph, citizen.id);
}

export function guardianInterruptionProbability(citizen: Citizen, guardian?: Citizen): number {
  if (!guardian) return 0.22;
  return clamp(0.38 + guardian.familyTrust * 0.004 + citizen.familyTrust * 0.001, 0, 0.92);
}

export function networkCoverage(world: WorldState): number {
  const roots = world.networkInfluencerIds.length ? world.networkInfluencerIds : world.socialGraph.hubs.slice(0, 5);
  return influenceReach(world.socialGraph, roots, 2).size;
}

export function interventionDescription(strategy: InterventionStrategy): string {
  switch (strategy) {
    case "baseline":
      return "Observe the synthetic city without an active intervention.";
    case "mass-warning":
      return "Send a warning to every citizen, trading broad reach for warning fatigue.";
    case "bank-risk-agent":
      return "Delay anomalous high-value transfers and ask for an AI confirmation.";
    case "social-guardian":
      return "Notify a trusted family contact when a citizen looks ready to transfer.";
    case "network-intervention":
      return "Seed five highly connected citizens so warnings travel through the graph.";
  }
}

export function interventionLabel(strategy: InterventionStrategy): string {
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

