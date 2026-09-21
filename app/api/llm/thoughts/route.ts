import { NextResponse } from "next/server";
import { generateLiveThoughts } from "@/agents/live-thoughts";
import { getSimulationStore } from "@/lib/simulation-api";

export const dynamic = "force-dynamic";

/**
 * Live citizen narration through the configured OpenAI-compatible gateway.
 *
 *   GET /api/llm/thoughts?limit=5&concurrency=3
 *
 * Additive only: world state is never mutated here, and every failure path
 * degrades to the deterministic thought.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 5);
  const concurrency = Number(url.searchParams.get("concurrency") ?? 3);
  const world = getSimulationStore().getWorld();

  const result = await generateLiveThoughts(world, {
    limit: Number.isFinite(limit) ? limit : 5,
    concurrency: Number.isFinite(concurrency) ? concurrency : 3,
  });

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
