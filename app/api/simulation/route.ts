import { NextResponse } from "next/server";
import {
  getSimulationStore,
  InvalidSimulationCommandError,
  parseSimulationCommand,
} from "@/lib/simulation-api";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(getSimulationStore().getSnapshot());
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const command = parseSimulationCommand(await request.json());
    return NextResponse.json(getSimulationStore().dispatch(command));
  } catch (error) {
    const invalidCommand = error instanceof InvalidSimulationCommandError || error instanceof SyntaxError;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Simulation command failed.",
        code: invalidCommand ? "INVALID_COMMAND" : "SIMULATION_ERROR",
      },
      { status: invalidCommand ? 400 : 500 },
    );
  }
}
