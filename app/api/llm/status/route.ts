import { NextResponse } from "next/server";
import { getDefaultLLMConfig } from "@/agents/llm-adapter";

export const dynamic = "force-dynamic";

/**
 * Reports whether the optional LLM adapter is configured, without leaking the
 * key. Used by the dashboard, the Minecraft bridge, and the demo runbook to
 * confirm the gateway is wired before a live presentation.
 */
export async function GET(): Promise<NextResponse> {
  const config = getDefaultLLMConfig();
  return NextResponse.json({
    enabled: config.enabled,
    hasApiKey: Boolean(config.apiKey),
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
    mode: config.enabled && config.apiKey ? "live" : "deterministic-fallback",
  });
}
