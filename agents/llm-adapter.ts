import type { FraudDecision, LLMConfig, LLMContext, LLMDecision } from "@/types";

const VALID_DECISIONS: FraudDecision[] = ["ignore", "engage", "trust", "click", "transfer", "blocked", "cancelled"];

export function getDefaultLLMConfig(env: Record<string, string | undefined> = readEnvironment()): LLMConfig {
  return {
    enabled: env.LLM_ENABLED === "true",
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    model: env.OPENAI_MODEL || "gpt-4o-mini",
    // A gateway hop adds latency, and reasoning models spend most of the budget
    // before emitting any text. 4s/180 tokens was too tight for both.
    timeoutMs: positiveInt(env.LLM_TIMEOUT_MS, 20_000),
    maxTokens: positiveInt(env.LLM_MAX_TOKENS, 1_200),
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function fallbackLLMDecision(context: LLMContext): LLMDecision {
  const probability = context.probability;
  const decision: FraudDecision = context.actualDecision ?? (probability < 0.28 ? "ignore" : probability < 0.46 ? "engage" : probability < 0.63 ? "trust" : probability < 0.79 ? "click" : "transfer");
  const thought =
    decision === "ignore"
      ? "The request is unusual. I will verify it before doing anything."
      : decision === "transfer"
        ? "The request feels urgent and convincing enough to act on."
        : decision === "blocked"
          ? "The bank paused this transfer, so I did not complete it."
          : decision === "cancelled"
            ? "A trusted person warned me, so I stopped before completing it."
        : "I am weighing whether this message is genuine.";
  return {
    decision,
    thought,
    reason: `Deterministic risk score estimated ${Math.round(probability * 100)}% susceptibility for ${context.strategy}.`,
  };
}

export interface LLMAdapter {
  readonly enabled: boolean;
  decide(context: LLMContext, fallback?: LLMDecision): Promise<LLMDecision>;
}

export function createLLMAdapter(config: LLMConfig = getDefaultLLMConfig()): LLMAdapter {
  const enabled = Boolean(config.enabled && config.apiKey);
  return {
    enabled,
    async decide(context: LLMContext, fallback = fallbackLLMDecision(context)): Promise<LLMDecision> {
      if (!enabled) return fallback;
      try {
        return await requestLLMDecision(context, config, fallback);
      } catch {
        // An optional model must never be able to stop a deterministic run.
        return fallback;
      }
    },
  };
}

export async function requestLLMDecision(
  context: LLMContext,
  config: LLMConfig,
  fallback = fallbackLLMDecision(context),
): Promise<LLMDecision> {
  if (!config.enabled || !config.apiKey) return fallback;
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const messages = [
    {
      role: "system" as const,
      content:
        "You are narrating a synthetic citizen in a fraud simulation. Return JSON only with decision, thought, and reason. The actualDecision in the context is authoritative: explain it and never replace it with another decision.",
    },
    { role: "user" as const, content: JSON.stringify(context) },
  ];

  // Reasoning models (o-series, *-thinking) reject sampling parameters such as
  // temperature and response_format. Try the strict JSON shape first, then fall
  // back to a minimal payload so a reasoning model is still usable.
  const payloads = [
    { model: config.model, temperature: 0, max_tokens: config.maxTokens, response_format: { type: "json_object" }, messages },
    { model: config.model, max_tokens: config.maxTokens, messages },
  ];

  for (const body of payloads) {
    const decision = await attemptDecision(url, config, body, fallback);
    if (decision) return decision;
  }
  return fallback;
}

async function attemptDecision(
  url: string,
  config: LLMConfig,
  body: Record<string, unknown>,
  fallback: LLMDecision,
): Promise<LLMDecision | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // 400/422 usually means the model rejected the optional parameters, so the
    // caller should retry with the next payload shape. Other errors are final.
    if (response.status === 400 || response.status === 422) return undefined;
    if (!response.ok) return fallback;
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return fallback;
    const parsed = parseDecision(content);
    if (!parsed) return undefined;
    const actualDecision = configuredDecision(contextForBody(body));
    if (actualDecision !== undefined && parsed.decision !== actualDecision) return undefined;
    return {
      decision: parsed.decision,
      thought: typeof parsed.thought === "string" ? parsed.thought.slice(0, 280) : fallback.thought,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 280) : fallback.reason,
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

function configuredDecision(context: unknown): FraudDecision | undefined {
  if (!context || typeof context !== "object") return undefined;
  const value = (context as { actualDecision?: unknown }).actualDecision;
  return typeof value === "string" && VALID_DECISIONS.includes(value as FraudDecision)
    ? value as FraudDecision
    : undefined;
}

function contextForBody(body: Record<string, unknown>): unknown {
  const messages = body.messages;
  if (!Array.isArray(messages)) return undefined;
  const user = messages.find((message) => message && typeof message === "object" && (message as { role?: unknown }).role === "user");
  if (!user || typeof user !== "object" || typeof (user as { content?: unknown }).content !== "string") return undefined;
  try { return JSON.parse((user as { content: string }).content); } catch { return undefined; }
}

function parseDecision(content: string): { decision: FraudDecision; thought?: unknown; reason?: unknown } | undefined {
  const tryParse = (value: string) => {
    try {
      const parsed = JSON.parse(value) as Partial<LLMDecision>;
      if (parsed.decision && VALID_DECISIONS.includes(parsed.decision)) {
        return { decision: parsed.decision, thought: parsed.thought, reason: parsed.reason };
      }
    } catch {
      // fall through to the next strategy
    }
    return undefined;
  };
  // Some models wrap JSON in prose or a fenced code block.
  const match = content.match(/\{[\s\S]*\}/);
  return tryParse(content) ?? (match ? tryParse(match[0]) : undefined);
}

function readEnvironment(): Record<string, string | undefined> {
  if (typeof process === "undefined") return {};
  return {
    LLM_ENABLED: process.env.LLM_ENABLED,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS,
    LLM_MAX_TOKENS: process.env.LLM_MAX_TOKENS,
  };
}
