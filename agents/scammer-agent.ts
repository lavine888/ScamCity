import type { Citizen, ScamMessage, ScamStrategy, ScammerAgent } from "@/types";
import { calculateFraudProbability } from "@/simulation/fraud-engine";
import { clamp, SeededRandom } from "@/simulation/seeded-random";

export const SCAMMER_BLUEPRINTS: Array<Pick<ScammerAgent, "id" | "name" | "strategy" | "description">> = [
  {
    id: "scammer-01",
    name: "Service Desk Mirage",
    strategy: "fake-customer-service",
    description: "Impersonates a delivery or marketplace support desk and asks for a small verification payment.",
  },
  {
    id: "scammer-02",
    name: "Yield Hunter",
    strategy: "fake-investment",
    description: "Promises an urgent, high-return investment and targets citizens with assets or financial stress.",
  },
  {
    id: "scammer-03",
    name: "Familiar Voice",
    strategy: "impersonation",
    description: "Pretends to be a relative, colleague or friend who needs immediate help.",
  },
  {
    id: "scammer-04",
    name: "Official Line",
    strategy: "authority-scam",
    description: "Uses the language of police, banks or government departments to create compliance pressure.",
  },
  {
    id: "scammer-05",
    name: "Clickbait Relay",
    strategy: "phishing-link",
    description: "Distributes a convincing link that captures credentials or redirects a payment.",
  },
];

export function createScammerAgents(): ScammerAgent[] {
  return SCAMMER_BLUEPRINTS.map((blueprint) => ({
    ...blueprint,
    messagesSent: 0,
    successfulTransfers: 0,
    active: true,
  }));
}

function targetScore(citizen: Citizen, strategy: ScamStrategy): number {
  const fit = calculateFraudProbability(citizen, { strategy }).probability;
  const statePenalty = citizen.state === "protected" || citizen.state === "victim" ? 0.35 : 1;
  return fit * statePenalty * (0.75 + citizen.assets / 1_800_000);
}

export function selectScamTarget(
  citizens: Citizen[],
  strategy: ScamStrategy,
  random: SeededRandom,
  excludedIds: Set<string> = new Set(),
): Citizen | undefined {
  const candidates = citizens
    .filter((citizen) => !excludedIds.has(citizen.id) && citizen.state !== "victim")
    .map((citizen) => ({ citizen, score: targetScore(citizen, strategy) }));
  if (candidates.length === 0) return undefined;
  candidates.sort((left, right) => right.score - left.score);
  // Keep target selection purposeful while adding a little deterministic variety.
  const shortlist = candidates.slice(0, Math.min(14, candidates.length));
  const weights = shortlist.map((entry, index) => Math.max(0.2, entry.score * (1 - index / (shortlist.length * 1.6))));
  return random.weighted(
    shortlist.map((entry) => entry.citizen),
    weights,
  );
}

export function scamMessageContent(strategy: ScamStrategy, citizen: Citizen, random: SeededRandom): string {
  switch (strategy) {
    case "fake-customer-service":
      return random.pick([
        "Your parcel is held at customs. Confirm a HK$38 delivery fee to release it.",
        "Customer service detected a duplicate order. Verify your account before midnight.",
      ]);
    case "fake-investment":
      return random.pick([
        "A private AI fund closes tonight. Deposit now for a guaranteed 28% return.",
        "Your priority investor slot is expiring. Transfer a starter amount to unlock the yield.",
      ]);
    case "impersonation":
      return random.pick([
        `Hi ${citizen.name.split(" ")[0]}, I changed my number. I need an urgent transfer before a meeting.`,
        "I am in trouble and cannot talk on the phone. Please help me keep this private.",
      ]);
    case "authority-scam":
      return random.pick([
        "This is a compliance notice from your bank. Confirm the transfer now to avoid account suspension.",
        "A case has been opened under your identity. Move funds to the protected verification account.",
      ]);
    case "phishing-link":
      return random.pick([
        "Your account needs a security check. Open the secure link within 10 minutes.",
        "You have won a city benefits voucher. Sign in to claim it before it expires.",
      ]);
  }
}

export function createScamMessage(
  agent: ScammerAgent,
  target: Citizen,
  tick: number,
  random: SeededRandom,
): ScamMessage {
  agent.messagesSent += 1;
  return {
    id: `message-${tick}-${agent.id}-${agent.messagesSent}`,
    scammerId: agent.id,
    targetId: target.id,
    strategy: agent.strategy,
    sentAtTick: tick,
    content: scamMessageContent(agent.strategy, target, random),
    amount: 0,
    status: "ignore",
    probability: 0,
    factors: [],
  };
}

export function scammerTargetingSummary(citizens: Citizen[], strategy: ScamStrategy): string {
  const scores = citizens.map((citizen) => targetScore(citizen, strategy));
  const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  return `This agent prioritises citizens with a ${Math.round(clamp(average * 100))}% average modeled susceptibility.`;
}
