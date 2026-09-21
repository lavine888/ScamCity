import { createLLMAdapter, fallbackLLMDecision, getDefaultLLMConfig } from "@/agents/llm-adapter";
import type { Citizen, LLMContext, ScamMessage, WorldState } from "@/types";

export interface LiveThought {
  citizenId: string;
  citizenName: string;
  strategy: ScamMessage["strategy"];
  tick: number;
  /** The deterministic engine's decision. The model never overrides it. */
  engineDecision: ScamMessage["status"];
  probability: number;
  thought: string;
  reason: string;
  source: "live" | "fallback";
}

export interface LiveThoughtsResult {
  mode: "live" | "deterministic-fallback";
  model: string;
  generatedAt: string;
  latencyMs: number;
  thoughts: LiveThought[];
  note?: string;
}

export interface LiveThoughtsOptions {
  /** How many of the most recent scam messages to narrate. Clamped to 1..12. */
  limit?: number;
  /** Maximum simultaneous gateway calls. Clamped to 1..4. */
  concurrency?: number;
}

function buildContext(citizen: Citizen, message: ScamMessage): LLMContext {
  return {
    citizen: {
      name: citizen.name,
      age: citizen.age,
      occupation: citizen.occupation,
      digitalLiteracy: citizen.digitalLiteracy,
      riskAwareness: citizen.riskAwareness,
      stress: citizen.stress,
      familyTrust: citizen.familyTrust,
      strangerTrust: citizen.strangerTrust,
      authorityTrust: citizen.authorityTrust,
      impulsiveness: citizen.impulsiveness,
    },
    strategy: message.strategy,
    message: message.content,
    probability: message.probability,
    actualDecision: message.status,
  };
}

/**
 * Optional enrichment layer: ask the configured gateway to narrate the most
 * recent scam interactions in the citizen's own voice.
 *
 * This is deliberately additive. The deterministic fraud engine remains the
 * only thing that changes world state, so a missing key, a timeout, a quota
 * error, or a malformed response degrades to `fallbackLLMDecision` and the
 * simulation still runs end to end.
 */
export async function generateLiveThoughts(
  world: WorldState,
  options: LiveThoughtsOptions = {},
): Promise<LiveThoughtsResult> {
  const config = getDefaultLLMConfig();
  const started = Date.now();
  const limit = Math.max(1, Math.min(12, Math.floor(options.limit ?? 5)));
  const concurrency = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 3)));
  const adapter = createLLMAdapter(config);
  const mode: LiveThoughtsResult["mode"] = adapter.enabled ? "live" : "deterministic-fallback";

  const recent = [...world.messages].slice(-limit).reverse();
  const jobs = recent
    .map((message) => {
      const citizen = world.citizens.find((candidate) => candidate.id === message.targetId);
      return citizen ? { citizen, message } : undefined;
    })
    .filter((job): job is { citizen: Citizen; message: ScamMessage } => Boolean(job));

  const thoughts: LiveThought[] = new Array(jobs.length);

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const index = cursor;
      cursor += 1;
      const { citizen, message } = jobs[index];
      const context = buildContext(citizen, message);
      const fallback = fallbackLLMDecision(context);
      const decision = await adapter.decide(context, fallback);
      const isLive = decision !== fallback && adapter.enabled;
      thoughts[index] = {
        citizenId: citizen.id,
        citizenName: citizen.name,
        strategy: message.strategy,
        tick: message.sentAtTick,
        engineDecision: message.status,
        probability: message.probability,
        thought: decision.thought,
        reason: decision.reason,
        source: isLive ? "live" : "fallback",
      };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, jobs.length)) }, worker));

  return {
    mode,
    model: config.model,
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    thoughts: thoughts.filter(Boolean),
    ...(mode === "deterministic-fallback"
      ? { note: "LLM_ENABLED is false or OPENAI_API_KEY is empty; showing deterministic thoughts." }
      : {}),
  };
}
