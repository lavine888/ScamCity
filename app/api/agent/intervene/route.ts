import { NextResponse } from "next/server";
import { executeIntervention, InterventionRequestError } from "@/agents/intervention-planner";
import { getSimulationStore } from "@/lib/simulation-api";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<NextResponse> {
  let input: unknown;
  try { input = await request.json(); }
  catch { return NextResponse.json({ code: "INVALID_REQUEST", error: "Expected JSON." }, { status: 400 }); }
  try {
    return NextResponse.json(await executeIntervention(getSimulationStore(), input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InterventionRequestError) return NextResponse.json({ code: error.code, error: error.message }, { status: error.status });
    return NextResponse.json({ code: "INTERVENTION_FAILED", error: "Intervention could not be completed." }, { status: 500 });
  }
}
