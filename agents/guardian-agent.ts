import type { Citizen, InterventionStrategy, WorldState } from "@/types";
import {
  guardianAlertTarget,
  guardianInterruptionProbability,
  isInterventionActive,
} from "@/simulation/intervention";
import { SeededRandom } from "@/simulation/seeded-random";

export interface GuardianAlert {
  citizenId: string;
  guardianId?: string;
  probability: number;
  message: string;
  interrupted: boolean;
}

export function guardianAgentEnabled(world: WorldState): boolean {
  return isInterventionActive(world, "social-guardian");
}

export function evaluateGuardianAlert(world: WorldState, citizen: Citizen, random: SeededRandom): GuardianAlert {
  const guardian = guardianAlertTarget(world, citizen);
  const probability = guardianInterruptionProbability(citizen, guardian);
  const interrupted = Boolean(guardian && random.chance(probability));
  return {
    citizenId: citizen.id,
    guardianId: guardian?.id,
    probability,
    message: guardian
      ? `${guardian.name} was notified about ${citizen.name}'s suspicious action.`
      : `No trusted family contact was found for ${citizen.name}.`,
    interrupted,
  };
}

export function guardianInterventionSummary(world: WorldState): string {
  const record = world.interventionHistory.find((entry) => entry.strategy === "social-guardian");
  return record
    ? `Social Guardian has issued ${world.metrics.warningsSent} alerts and stopped ${world.metrics.successfulInterventions} risky actions.`
    : "Social Guardian is ready to notify a trusted family contact when risk is detected.";
}

export const GUARDIAN_STRATEGY: InterventionStrategy = "social-guardian";

