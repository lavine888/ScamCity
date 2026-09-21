import type {
  Citizen,
  ComparisonSummary,
  ResearchFinding,
  ScamInteraction,
  WorldState,
} from "@/types";
import { clamp, round } from "@/simulation/seeded-random";

function ratioOr(value: number, fallback = 1): number {
  return value > 0 ? value : fallback;
}

function citizenForInteraction(world: WorldState, interaction: ScamInteraction): Citizen | undefined {
  return world.citizens.find((citizen) => citizen.id === interaction.citizenId);
}

/** Generate plain-language findings from observed interactions, not hard-coded outcomes. */
export function generateResearchFindings(world: WorldState, comparison?: ComparisonSummary[]): ResearchFinding[] {
  const findings: ResearchFinding[] = [];
  const authorityInteractions = world.interactions.filter((interaction) => interaction.strategy === "authority-scam");
  const olderAuthority = authorityInteractions.filter((interaction) => (citizenForInteraction(world, interaction)?.age ?? 0) >= 60);
  const youngerAuthority = authorityInteractions.filter((interaction) => (citizenForInteraction(world, interaction)?.age ?? 0) < 60);
  const olderRisk = olderAuthority.filter((interaction) => interaction.decision !== "ignore").length / ratioOr(olderAuthority.length);
  const youngerRisk = youngerAuthority.filter((interaction) => interaction.decision !== "ignore").length / ratioOr(youngerAuthority.length);
  const ageRatio = round(olderRisk / ratioOr(youngerRisk), 1);
  findings.push({
    id: "authority-trust",
    title: "Authority trust is a measurable vulnerability",
    statement:
      authorityInteractions.length > 0
        ? `Citizens aged 60+ engaged with authority scams ${ageRatio}× as often as younger citizens in this run.`
        : "The run has not produced enough authority scam observations yet.",
    evidence: `${olderAuthority.length} older and ${youngerAuthority.length} younger authority scam encounters were observed.`,
    category: "risk",
  });

  const highTrust = authorityInteractions.filter((interaction) => (citizenForInteraction(world, interaction)?.authorityTrust ?? 0) >= 70);
  const lowTrust = authorityInteractions.filter((interaction) => (citizenForInteraction(world, interaction)?.authorityTrust ?? 0) < 50);
  const highRate = highTrust.filter((interaction) => interaction.decision !== "ignore").length / ratioOr(highTrust.length);
  const lowRate = lowTrust.filter((interaction) => interaction.decision !== "ignore").length / ratioOr(lowTrust.length);
  findings.push({
    id: "trust-channel",
    title: "Scammers exploit the trust channel that matches their story",
    statement:
      authorityInteractions.length > 0
        ? `High-authority-trust citizens engaged at ${Math.round(highRate * 100)}%, versus ${Math.round(lowRate * 100)}% for low-authority-trust citizens.`
        : "Trust-channel evidence will appear after scam agents send messages.",
    evidence: `${highTrust.length} high-trust and ${lowTrust.length} low-trust authority encounters were compared.`,
    category: "behavior",
  });

  const networkResult = comparison?.find((result) => result.strategy === "network-intervention");
  const baselineResult = comparison?.find((result) => result.strategy === "baseline");
  if (networkResult && baselineResult) {
    const reduction = baselineResult.metrics.funnel.messagesSent
      ? (baselineResult.metrics.moneyLost - networkResult.metrics.moneyLost) / Math.max(1, baselineResult.metrics.moneyLost)
      : 0;
    findings.push({
      id: "network-leverage",
      title: "A small network seed can change downstream exposure",
      statement: `Targeting five high-connectivity citizens changed modeled financial loss by ${Math.round(reduction * 100)}% in the seeded comparison.`,
      evidence: `Network coverage reached ${networkResult.world.socialGraph.hubs.slice(0, 5).length} seeded nodes and ${networkResult.world.metrics.warningsSent} warning signals were recorded.`,
      category: "network",
    });
  } else {
    findings.push({
      id: "network-leverage",
      title: "Network leverage is ready to test",
      statement: `The social graph contains ${world.socialGraph.edges.length} relationships and five high-connectivity nodes.`,
      evidence: `Two-hop reach currently covers ${world.socialGraph.hubs.length ? estimateReach(world) : 0} citizens.`,
      category: "network",
    });
  }

  const guardian = comparison?.find((result) => result.strategy === "social-guardian");
  if (guardian && baselineResult) {
    const reduction = (baselineResult.metrics.victims - guardian.metrics.victims) / Math.max(1, baselineResult.metrics.victims);
    findings.push({
      id: "family-guardian",
      title: "Family intervention catches risk at the decision point",
      statement: `Social Guardian reduced observed victims by ${Math.round(reduction * 100)}% in this seeded run.`,
      evidence: `${guardian.metrics.successfulInterventions} risky actions were interrupted after a family alert.`,
      category: "intervention",
    });
  } else {
    findings.push({
      id: "family-guardian",
      title: "Trusted contacts create a human-scale safety net",
      statement: "The Social Guardian strategy alerts a trusted family contact before a risky action becomes a completed transfer.",
      evidence: "Guardian effectiveness is measured from interrupted interactions in the current run.",
      category: "intervention",
    });
  }
  return findings;
}

export function findingsFromComparison(comparison: ComparisonSummary[]): ResearchFinding[] {
  const preferred = comparison.find((result) => result.strategy === "social-guardian") ?? comparison[0];
  return preferred ? generateResearchFindings(preferred.world, comparison) : [];
}

export function summariseResearch(findings: ResearchFinding[]): string {
  if (!findings.length) return "No findings have been generated yet.";
  return findings.map((finding) => finding.statement).join(" ");
}

function estimateReach(world: WorldState): number {
  const reached = new Set(world.socialGraph.hubs);
  let frontier = [...world.socialGraph.hubs];
  for (let hop = 0; hop < 2; hop += 1) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbor of world.socialGraph.adjacency[node] ?? []) {
        if (!reached.has(neighbor)) {
          reached.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return reached.size;
}

