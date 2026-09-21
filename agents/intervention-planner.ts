import { getDefaultLLMConfig } from "@/agents/llm-adapter";
import { INTERVENTION_COSTS, interventionDescription } from "@/simulation/intervention";
import type { SimulationStore } from "@/lib/simulation-api";
import type { InterventionStrategy, LLMConfig, WorldState } from "@/types";

export class InterventionRequestError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = "INVALID_REQUEST") { super(message); }
}
export function parseInterventionRequest(value: unknown): { budget: number; expectedSnapshotId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InterventionRequestError("Expected an object.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["budget", "expectedSnapshotId"].includes(key))) throw new InterventionRequestError("Unknown request field.");
  if (typeof input.budget !== "number" || !Number.isSafeInteger(input.budget) || input.budget < 0 || input.budget > 100000) throw new InterventionRequestError("budget must be an integer from 0 to 100000.");
  if (typeof input.expectedSnapshotId !== "string" || !input.expectedSnapshotId.trim() || input.expectedSnapshotId.length > 200) throw new InterventionRequestError("expectedSnapshotId is required.");
  return { budget: input.budget, expectedSnapshotId: input.expectedSnapshotId };
}
export function observeInterventionWorld(world: WorldState) {
  const recentInteractions = world.interactions.slice(-20);
  const recentStrategyCounts = recentInteractions.reduce<Record<string, number>>((counts, interaction) => {
    counts[interaction.strategy] = (counts[interaction.strategy] ?? 0) + 1;
    return counts;
  }, {});
  const recentUninterruptedTransferAmount = recentInteractions
    .filter((interaction) => interaction.decision === "transfer" && !interaction.interrupted)
    .reduce((total, interaction) => total + interaction.amount, 0);
  return {
    tick: world.tick,
    citizens: world.citizens.length,
    atRisk: world.citizens.filter((c) => ["engaged", "trusted", "clicked"].includes(c.state)).length,
    victims: world.citizens.filter((c) => c.state === "victim").length,
    activeInterventions: [...world.activeInterventions],
    activeEvents: (world.audienceEvents ?? []).filter((event) => event.startTick <= world.tick && event.endTick > world.tick).map((event) => ({ type: event.type, endTick: event.endTick })),
    interventionCost: world.metrics.interventionCost,
    recentInteractions: recentInteractions.length,
    recentStrategyCounts,
    recentUninterruptedTransferAmount,
    cumulativeMetrics: {
      fraudAttempts: world.metrics.fraudAttempts,
      moneyLost: world.metrics.moneyLost,
      warningsSent: world.metrics.warningsSent,
      falsePositives: world.metrics.falsePositives,
      successfulInterventions: world.metrics.successfulInterventions,
    },
  };
}

/** One bounded decision and one whitelisted tool call, without advancing time. */
export async function executeIntervention(
  store: SimulationStore,
  input: unknown,
  config: LLMConfig = getDefaultLLMConfig(),
) {
  const { budget, expectedSnapshotId } = parseInterventionRequest(input);
  const before = store.getSnapshot();
  const stale = () => { throw new InterventionRequestError("The city changed. Refresh and retry against its current snapshot.", 409, "STALE_SNAPSHOT"); };
  if (before.snapshotId !== expectedSnapshotId) stale();
  const observation = observeInterventionWorld(before.world);
  const candidates = (Object.keys(INTERVENTION_COSTS) as InterventionStrategy[])
    .filter((strategy) => strategy === "baseline" || (!before.world.activeInterventions.includes(strategy) && INTERVENTION_COSTS[strategy] <= budget));
  const priority: InterventionStrategy[] = observation.atRisk > 0
    ? ["bank-risk-agent", "social-guardian", "network-intervention", "mass-warning", "baseline"]
    : ["network-intervention", "mass-warning", "social-guardian", "bank-risk-agent", "baseline"];
  let strategy = priority.find((candidate) => candidates.includes(candidate))!;
  let reason = strategy === "baseline" ? "No unactivated intervention fits this activation budget; observe without adding a strategy." : "Rule policy chose an affordable unactivated intervention using the current risk count.";
  let source: "model" | "rules" | "fallback" = "rules";
  if (config.enabled && config.apiKey) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 30000));
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model, max_tokens: Math.min(config.maxTokens, 1200),
          messages: [
            { role: "system", content: 'Choose exactly one available intervention for a synthetic fraud city. Return only JSON {"strategy":"available-name","reason":"brief explanation"}. Budget covers activation only, not future costs. Baseline means retain existing policies without a new activation. Do not claim future effectiveness.' },
            { role: "user", content: JSON.stringify({ observation, budget, candidates: candidates.map((candidate) => ({ strategy: candidate, activationCost: INTERVENTION_COSTS[candidate], description: interventionDescription(candidate) })) }) },
          ],
        }),
      });
      if (!response.ok) throw new Error("Model request failed.");
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("Missing model content.");
      const parsed = JSON.parse(content);
      if (!parsed || typeof parsed !== "object" || !candidates.includes(parsed.strategy) || typeof parsed.reason !== "string" || !parsed.reason.trim() || parsed.reason.length > 1000) throw new Error("Invalid model decision.");
      strategy = parsed.strategy;
      reason = parsed.reason;
      source = "model";
    } catch {
      source = "fallback";
      reason = "Model unavailable or response invalid. " + reason;
    } finally { clearTimeout(timeout); }
  }
  // No await between this check and dispatch: two concurrent requests cannot charge twice.
  if (store.getSnapshot().snapshotId !== expectedSnapshotId) stale();
  const snapshot = store.dispatch({ type: "intervention", strategy });
  return {
    source, ...(source === "model" ? { model: config.model } : {}), strategy, reason,
    budget, budgetScope: "activation-only" as const, estimatedCost: INTERVENTION_COSTS[strategy],
    actualCost: snapshot.world.metrics.interventionCost - before.world.metrics.interventionCost,
    beforeSnapshotId: before.snapshotId, afterSnapshotId: snapshot.snapshotId,
    beforeTick: before.world.tick, afterTick: snapshot.world.tick,
    observation, afterObservation: observeInterventionWorld(snapshot.world), snapshot,
    note: "Activation evidence only; time was not advanced and prevented losses were not measured. Existing policies remain active. Future operating costs are outside this budget.",
  };
}
