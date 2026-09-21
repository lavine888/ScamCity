import type {
  AudienceEventType,
  Citizen,
  FraudDecision,
  FraudProbabilityResult,
  RiskFactor,
  ScamMessage,
  ScamStrategy,
} from "@/types";
import { clamp, round, SeededRandom } from "@/simulation/seeded-random";
import { incidentModifierFor } from "@/simulation/audience-events";

export interface ScamSignal {
  strategy: ScamStrategy;
  socialProof?: number;
  amount?: number;
  content?: string;
  /** Audience incidents active at evaluation time. Only the whitelisted types
   * that declare this strategy change the outcome. */
  activeIncidents?: readonly AudienceEventType[];
}

export interface FraudEvaluation {
  decision: FraudDecision;
  probability: FraudProbabilityResult;
  amount: number;
  thought: string;
}

function strategyTrust(citizen: Citizen, strategy: ScamStrategy): number {
  switch (strategy) {
    case "authority-scam":
      return citizen.authorityTrust;
    case "impersonation":
      return citizen.familyTrust * 0.72 + citizen.strangerTrust * 0.28;
    case "fake-customer-service":
      return citizen.authorityTrust * 0.38 + citizen.strangerTrust * 0.62;
    case "fake-investment":
      return citizen.strangerTrust * 0.65 + citizen.authorityTrust * 0.35;
    case "phishing-link":
      return citizen.strangerTrust * 0.8 + citizen.authorityTrust * 0.2;
  }
}

function strategyMatch(citizen: Citizen, strategy: ScamStrategy): { score: number; explanation: string } {
  const ageFactor = clamp((citizen.age - 45) * 1.8, 0, 55);
  switch (strategy) {
    case "authority-scam":
      return {
        score: clamp(citizen.authorityTrust * 0.68 + ageFactor * 0.32),
        explanation: "Authority trust and age make official-looking requests more persuasive.",
      };
    case "fake-investment":
      return {
        score: clamp(
          (Math.min(100, citizen.assets / 12_000) * 0.35 + citizen.stress * 0.28 + citizen.impulsiveness * 0.25 + citizen.loneliness * 0.12),
        ),
        explanation: "Available assets, stress and urgency increase the appeal of fast returns.",
      };
    case "impersonation":
      return {
        score: clamp(citizen.familyTrust * 0.38 + citizen.loneliness * 0.26 + citizen.strangerTrust * 0.16 + ageFactor * 0.2),
        explanation: "Loneliness and strong relational trust make a familiar identity harder to question.",
      };
    case "fake-customer-service":
      return {
        score: clamp((100 - citizen.digitalLiteracy) * 0.52 + citizen.strangerTrust * 0.2 + ageFactor * 0.18 + citizen.stress * 0.1),
        explanation: "Low digital literacy and pressure make service impersonation feel plausible.",
      };
    case "phishing-link":
      return {
        score: clamp((100 - citizen.digitalLiteracy) * 0.56 + citizen.impulsiveness * 0.26 + citizen.stress * 0.18),
        explanation: "Lower digital literacy and impulsive clicks increase link risk.",
      };
  }
}

/**
 * Explainable, deterministic susceptibility model. The function has no random
 * side effects, so it can be called by the UI to explain a citizen's state.
 */
export function calculateFraudProbability(
  citizen: Citizen,
  signal: ScamSignal | Pick<ScamMessage, "strategy">,
): FraudProbabilityResult {
  const strategy = signal.strategy;
  const match = strategyMatch(citizen, strategy);
  const trust = strategyTrust(citizen, strategy);
  const incident = incidentModifierFor(
    strategy,
    "activeIncidents" in signal ? signal.activeIncidents ?? [] : [],
  );
  const socialProof = clamp(
    ("socialProof" in signal ? signal.socialProof ?? 0 : 0) + incident.socialProofBoost,
  );
  const warningRelief = Math.min(5, citizen.warningsReceived) * 4.5;
  const fatiguePenalty = Math.min(15, citizen.warningFatigue) * 0.35;
  const factors: RiskFactor[] = [
    {
      name: "digital-literacy",
      contribution: round(((100 - citizen.digitalLiteracy) / 100) * 22),
      explanation: "Lower digital literacy makes suspicious messages harder to verify.",
    },
    {
      name: "risk-awareness",
      contribution: round(((100 - citizen.riskAwareness) / 100) * 20),
      explanation: "Risk awareness reduces the chance of trusting a scam.",
    },
    {
      name: "stress",
      contribution: round((citizen.stress / 100) * 12),
      explanation: "Stress reduces time available for careful checking.",
    },
    {
      name: "impulsiveness",
      contribution: round((citizen.impulsiveness / 100) * 12),
      explanation: "Impulsiveness makes rapid clicks and transfers more likely.",
    },
    {
      name: "trust-match",
      contribution: round((trust / 100) * 12),
      explanation: "This message is shaped around a trust channel the citizen values.",
    },
    {
      name: "scam-personality-match",
      contribution: round((match.score / 100) * 18),
      explanation: match.explanation,
    },
    {
      name: "social-proof",
      contribution: round((socialProof / 100) * 4),
      explanation: "Seeing others engage can make a suspicious action feel normal.",
    },
    {
      name: "warning-protection",
      contribution: round(-warningRelief - fatiguePenalty),
      explanation: "Warnings lower susceptibility; repeated warnings eventually create fatigue.",
    },
  ];
  if (incident.susceptibilityBoost > 0) {
    factors.push({
      name: "audience-incident",
      contribution: round(incident.susceptibilityBoost),
      explanation: incident.explanation,
    });
  }
  const raw = 8 + factors.reduce((sum, factor) => sum + factor.contribution, 0);
  const probability = round(clamp(raw, 2, 97) / 100, 4);
  const likelyDecision = decisionForProbability(probability);
  const topFactors = factors
    .filter((factor) => factor.contribution > 0)
    .sort((left, right) => right.contribution - left.contribution)
    .slice(0, 2)
    .map((factor) => factor.name.split("-").join(" "))
    .join(" and ");
  return {
    probability,
    susceptibility: round(probability * 100),
    likelyDecision,
    factors,
    explanation: `${citizen.name}'s risk is driven mainly by ${topFactors || "baseline caution"}.`,
  };
}

export function decisionForProbability(probability: number): FraudDecision {
  if (probability < 0.28) return "ignore";
  if (probability < 0.46) return "engage";
  if (probability < 0.63) return "trust";
  if (probability < 0.79) return "click";
  return "transfer";
}

export function estimateTransferAmount(citizen: Citizen, strategy: ScamStrategy, random: SeededRandom): number {
  const fraction = strategy === "fake-investment" ? random.float(0.04, 0.12) : random.float(0.012, 0.055);
  const amount = Math.max(500, Math.min(citizen.assets * 0.32, citizen.assets * fraction));
  return Math.round(amount / 100) * 100;
}

export function evaluateFraud(
  citizen: Citizen,
  signal: ScamSignal,
  random: SeededRandom,
): FraudEvaluation {
  const probability = calculateFraudProbability(citizen, signal);
  const roll = random.next();
  let decision: FraudDecision = "ignore";
  if (roll < probability.probability) {
    const relativeRoll = roll / Math.max(probability.probability, 0.001);
    if (relativeRoll < 0.28) decision = "transfer";
    else if (relativeRoll < 0.56) decision = "click";
    else if (relativeRoll < 0.77) decision = "trust";
    else decision = "engage";
  }
  const thought = thoughtForDecision(decision, signal.strategy, citizen);
  // A market-panic style incident raises the size of a rushed transfer. The
  // multiplier is applied after the seeded draw so the decision sequence for a
  // given seed stays independent of the amount.
  const incident = incidentModifierFor(signal.strategy, signal.activeIncidents ?? []);
  const baseAmount = estimateTransferAmount(citizen, signal.strategy, random);
  const amount = Math.min(
    Math.max(0, citizen.assets),
    Math.round((baseAmount * incident.amountMultiplier) / 100) * 100,
  );
  return {
    decision,
    probability,
    amount: Math.max(baseAmount > 0 ? 100 : 0, amount),
    thought,
  };
}

export function thoughtForDecision(decision: FraudDecision, strategy: ScamStrategy, citizen: Citizen): string {
  if (decision === "ignore") return "Something feels off. I will verify this through an official channel.";
  if (decision === "engage") return "I should reply once and ask for more details before deciding.";
  if (decision === "trust") return "The message matches something I recognise. It may be legitimate.";
  if (decision === "click") return "The request is urgent, but the link looks like the fastest way to resolve it.";
  if (strategy === "authority-scam") return "The caller sounds official and knows enough details to be convincing.";
  if (strategy === "fake-investment") return `A quick return could help with the pressure I am under, and I can afford ${Math.round(citizen.assets / 1000)}k.`;
  return "The request feels personal and urgent. I should act before the opportunity disappears.";
}
