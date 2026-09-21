import type { AudienceEventType, ScamStrategy } from "@/types";
import { clamp, round } from "@/simulation/seeded-random";

/**
 * Structured contract for audience-triggered incidents.
 *
 * An incident is deliberately not free text: each whitelisted type declares
 * which scam strategies it amplifies and by how much, so a live audience can
 * change the world while the model stays explainable and reproducible. Free
 * text supplied by a caller is only used as a display label.
 *
 * Boosts are expressed on the same 0-100 scale as the risk factors in
 * `calculateFraudProbability`, which keeps the contribution readable in the
 * citizen inspector next to digital literacy, stress and trust.
 */
export interface AudienceEventBlueprint {
  type: AudienceEventType;
  affectedStrategies: ScamStrategy[];
  /** Added susceptibility points for an affected strategy. */
  susceptibilityBoost: number;
  /** Added social-proof points for an affected strategy. */
  socialProofBoost: number;
  /** Multiplier applied to the modeled transfer amount of an affected strategy. */
  amountMultiplier: number;
  rationale: string;
}

export const AUDIENCE_EVENT_BLUEPRINTS: Record<AudienceEventType, AudienceEventBlueprint> = {
  "bank-outage": {
    type: "bank-outage",
    affectedStrategies: ["fake-customer-service", "authority-scam"],
    susceptibilityBoost: 9,
    socialProofBoost: 0,
    amountMultiplier: 1,
    rationale: "A bank outage makes service and authority impersonation easier to believe.",
  },
  "deepfake-voice": {
    type: "deepfake-voice",
    affectedStrategies: ["impersonation"],
    susceptibilityBoost: 6,
    socialProofBoost: 18,
    amountMultiplier: 1,
    rationale: "A convincing cloned voice adds social proof to an already familiar identity.",
  },
  "market-panic": {
    type: "market-panic",
    affectedStrategies: ["fake-investment"],
    susceptibilityBoost: 7,
    socialProofBoost: 0,
    amountMultiplier: 1.25,
    rationale: "Market panic raises urgency and the size of a rushed transfer.",
  },
};

/** Upper bounds so a stack of concurrent incidents cannot dominate the model. */
export const MAX_INCIDENT_SUSCEPTIBILITY_BOOST = 14;
export const MAX_INCIDENT_SOCIAL_PROOF_BOOST = 24;
export const MAX_INCIDENT_AMOUNT_MULTIPLIER = 1.6;

export interface IncidentModifier {
  /** Incident types that actually affect the evaluated strategy. */
  types: AudienceEventType[];
  susceptibilityBoost: number;
  socialProofBoost: number;
  amountMultiplier: number;
  explanation: string;
}

export const NO_INCIDENT_MODIFIER: IncidentModifier = {
  types: [],
  susceptibilityBoost: 0,
  socialProofBoost: 0,
  amountMultiplier: 1,
  explanation: "No audience incident is affecting this strategy.",
};

export function audienceEventLabelFor(type: AudienceEventType): string {
  switch (type) {
    case "bank-outage":
      return "Bank outage";
    case "deepfake-voice":
      return "Deepfake voice";
    case "market-panic":
      return "Market panic";
  }
}

export function affectedStrategiesFor(type: AudienceEventType): ScamStrategy[] {
  return [...AUDIENCE_EVENT_BLUEPRINTS[type].affectedStrategies];
}

export function susceptibilityBoostFor(type: AudienceEventType): number {
  return AUDIENCE_EVENT_BLUEPRINTS[type].susceptibilityBoost;
}

/**
 * Aggregate the active incidents that apply to one scam strategy. The result is
 * deterministic and order independent, so the same tick always produces the
 * same modifier regardless of how the incidents were injected.
 */
export function incidentModifierFor(
  strategy: ScamStrategy,
  activeTypes: readonly AudienceEventType[] = [],
): IncidentModifier {
  if (!activeTypes.length) return NO_INCIDENT_MODIFIER;
  const applicable = Array.from(new Set(activeTypes))
    .filter((type) => AUDIENCE_EVENT_BLUEPRINTS[type]?.affectedStrategies.includes(strategy))
    .sort();
  if (!applicable.length) return NO_INCIDENT_MODIFIER;

  let susceptibility = 0;
  let socialProof = 0;
  let amountMultiplier = 1;
  for (const type of applicable) {
    const blueprint = AUDIENCE_EVENT_BLUEPRINTS[type];
    susceptibility += blueprint.susceptibilityBoost;
    socialProof += blueprint.socialProofBoost;
    amountMultiplier *= blueprint.amountMultiplier;
  }
  const labels = applicable.map((type) => audienceEventLabelFor(type)).join(" + ");
  return {
    types: applicable,
    susceptibilityBoost: round(clamp(susceptibility, 0, MAX_INCIDENT_SUSCEPTIBILITY_BOOST)),
    socialProofBoost: round(clamp(socialProof, 0, MAX_INCIDENT_SOCIAL_PROOF_BOOST)),
    amountMultiplier: round(Math.min(amountMultiplier, MAX_INCIDENT_AMOUNT_MULTIPLIER), 3),
    explanation: `${labels} makes this scam story more credible right now.`,
  };
}
