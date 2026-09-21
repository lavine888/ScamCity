import { NextResponse } from "next/server";
import { getSimulationStore } from "@/lib/simulation-api";

export const dynamic = "force-dynamic";

/** Small readiness endpoint for the Minecraft bridge and projected demos. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(getSimulationStore().getHealth());
}
