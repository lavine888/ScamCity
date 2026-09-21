import {
  applyIntervention,
  cloneWorld,
  compareStrategies,
  compareFromSnapshot,
  comparisonVerdict,
  createWorld,
  getActiveAudienceEvents,
  injectAudienceEvent,
  pauseWorld,
  resetWorld,
  resumeWorld,
  runSimulation,
  tickSimulation,
  getWorldOverview,
} from "@/simulation/world";
import { generateResearchFindings } from "@/agents/researcher-agent";
import type {
  AudienceEventType,
  ComparisonSummary,
  ComparisonContext,
  ComparisonVerdict,
  InterventionStrategy,
  SimulationCursor,
  SimulationHealth,
  SimulationTickOptions,
  WorldState,
} from "@/types";
import { SIMULATION_API_SCHEMA } from "@/types";

export const MAX_COMMAND_TICKS = 20_000;
export const MAX_COMMAND_DAYS = 30;
export const MAX_AUDIENCE_EVENT_DURATION = 10_000;

export type SimulationCommand =
  | { type: "reset"; seed?: number }
  | { type: "tick"; count?: number; options?: SimulationTickOptions }
  | { type: "run"; days?: number; ticks?: number; options?: SimulationTickOptions }
  | { type: "intervention"; strategy: InterventionStrategy }
  | { type: "inject-event"; eventId: string; eventType: AudienceEventType; duration: number; label: string }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "compare"; mode?: "seed" | "snapshot"; days?: number; ticks?: number };

export class InvalidSimulationCommandError extends Error {
  readonly code = "INVALID_COMMAND";

  constructor(message: string) {
    super(message);
    this.name = "InvalidSimulationCommandError";
  }
}

function invalid(message: string): never {
  throw new InvalidSimulationCommandError(message);
}

function optionalInteger(value: unknown, field: string, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(`${field} must be a non-negative integer.`);
  }
  if (value > max) invalid(`${field} must be at most ${max}.`);
  return value;
}

function parseTickOptions(value: unknown): SimulationTickOptions | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("options must be an object.");
  }
  const options = value as Record<string, unknown>;
  if (options.processScams !== undefined && typeof options.processScams !== "boolean") {
    invalid("options.processScams must be a boolean.");
  }
  if (options.compactEvents !== undefined && typeof options.compactEvents !== "boolean") {
    invalid("options.compactEvents must be a boolean.");
  }
  const parsed: SimulationTickOptions = {};
  if (typeof options.processScams === "boolean") parsed.processScams = options.processScams;
  if (typeof options.compactEvents === "boolean") parsed.compactEvents = options.compactEvents;
  return parsed;
}

const INTERVENTION_STRATEGIES: readonly InterventionStrategy[] = [
  "baseline",
  "mass-warning",
  "bank-risk-agent",
  "social-guardian",
  "network-intervention",
];

const AUDIENCE_EVENT_TYPES: readonly AudienceEventType[] = [
  "bank-outage",
  "deepfake-voice",
  "market-panic",
];

function isInterventionStrategy(value: unknown): value is InterventionStrategy {
  return typeof value === "string" && INTERVENTION_STRATEGIES.includes(value as InterventionStrategy);
}

function isAudienceEventType(value: unknown): value is AudienceEventType {
  return typeof value === "string" && AUDIENCE_EVENT_TYPES.includes(value as AudienceEventType);
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") invalid(`${field} must be a string.`);
  const normalized = value.trim();
  if (!normalized) invalid(`${field} must not be empty.`);
  if (normalized.length > maxLength) invalid(`${field} must be at most ${maxLength} characters.`);
  return normalized;
}

/** Runtime validation for JSON callers. TypeScript unions do not protect the HTTP boundary. */
export function parseSimulationCommand(input: unknown): SimulationCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalid("A simulation command object is required.");
  }
  const command = input as Record<string, unknown>;
  if (typeof command.type !== "string") invalid("A simulation command type is required.");

  switch (command.type) {
    case "reset": {
      const seed = command.seed;
      if (seed !== undefined && (typeof seed !== "number" || !Number.isSafeInteger(seed))) {
        invalid("seed must be a safe integer.");
      }
      return { type: "reset", ...(seed === undefined ? {} : { seed }) };
    }
    case "tick": {
      const count = optionalInteger(command.count, "count", 100);
      return {
        type: "tick",
        ...(count === undefined ? {} : { count }),
        ...(command.options === undefined ? {} : { options: parseTickOptions(command.options) }),
      };
    }
    case "run": {
      const days = optionalInteger(command.days, "days", MAX_COMMAND_DAYS);
      const ticks = optionalInteger(command.ticks, "ticks", MAX_COMMAND_TICKS);
      return {
        type: "run",
        ...(days === undefined ? {} : { days }),
        ...(ticks === undefined ? {} : { ticks }),
        ...(command.options === undefined ? {} : { options: parseTickOptions(command.options) }),
      };
    }
    case "intervention":
      if (!isInterventionStrategy(command.strategy)) {
        invalid("strategy must be a supported intervention strategy.");
      }
      return { type: "intervention", strategy: command.strategy };
    case "event":
    case "inject-event": {
      // Canonical form is { type: "inject-event", eventId, event: { type,
      // duration, label } }. A flat form with eventType/duration/label is also
      // accepted to keep curl and simple audience controls ergonomic.
      const nested = command.event && typeof command.event === "object" && !Array.isArray(command.event)
        ? command.event as Record<string, unknown>
        : undefined;
      const eventType = nested?.type ?? command.eventType;
      const duration = nested?.duration ?? command.duration;
      const label = nested?.label ?? command.label;
      const eventId = command.eventId ?? nested?.eventId ?? command.id;
      if (!isAudienceEventType(eventType)) {
        invalid("event.type must be one of bank-outage, deepfake-voice, market-panic.");
      }
      if (typeof duration !== "number" || !Number.isSafeInteger(duration) || duration < 1) {
        invalid("event.duration must be a positive integer number of ticks.");
      }
      if (duration > MAX_AUDIENCE_EVENT_DURATION) {
        invalid(`event.duration must be at most ${MAX_AUDIENCE_EVENT_DURATION} ticks.`);
      }
      return {
        type: "inject-event",
        eventId: requiredText(eventId, "eventId", 96),
        eventType,
        duration,
        label: requiredText(label, "event.label", 120),
      };
    }
    case "pause":
      return { type: "pause" };
    case "resume":
      return { type: "resume" };
    case "compare": {
      if (command.mode !== undefined && command.mode !== "seed" && command.mode !== "snapshot") {
        invalid("compare.mode must be seed or snapshot.");
      }
      const days = optionalInteger(command.days, "days", MAX_COMMAND_DAYS);
      const ticks = optionalInteger(command.ticks, "ticks", MAX_COMMAND_TICKS);
      return {
        type: "compare",
        ...(command.mode === undefined ? {} : { mode: command.mode as "seed" | "snapshot" }),
        ...(days === undefined ? {} : { days }),
        ...(ticks === undefined ? {} : { ticks }),
      };
    }
    default:
      invalid(`Unknown simulation command: ${command.type}.`);
  }
}

export interface SimulationSnapshot {
  world: WorldState;
  overview: ReturnType<typeof getWorldOverview>;
  findings: ReturnType<typeof generateResearchFindings>;
  comparison?: ComparisonSummary[];
  comparisonContext?: ComparisonContext;
  /** Shared impact/friction/cost reading and the single "best" rule. Present
   * only after a compare command has produced results. */
  verdict?: ComparisonVerdict;
  activeEvents: ReturnType<typeof getActiveAudienceEvents>;
  schemaVersion: typeof SIMULATION_API_SCHEMA;
  snapshotId: string;
  cursor: SimulationCursor;
}

export class SimulationStore {
  private world: WorldState;
  private comparison?: ComparisonSummary[];
  private comparisonContext?: ComparisonContext;
  private revision = 0;

  constructor(seed = 42) {
    this.world = createWorld(seed);
  }

  getWorld(): WorldState {
    return cloneWorld(this.world);
  }

  getSnapshot(): SimulationSnapshot {
    const world = this.getWorld();
    const cursor = this.getCursor(world);
    const verdict = this.comparison ? comparisonVerdict(this.comparison) : undefined;
    if (verdict && this.comparisonContext?.mode === "snapshot") {
      verdict.reason = "From tick " + this.comparisonContext.sourceTick + ", existing interventions retained. " + verdict.bestLabel + ": cumulative loss " + verdict.scorecards.find(card => card.strategy === verdict.bestStrategy)?.impact.moneyLost + "; ranking uses loss, victims, false positives and cost.";
      verdict.disclaimer += " Snapshot baseline means no additional intervention; metrics include history. Same initial RNG state does not guarantee identical later encounters.";
    }
    return {
      world,
      overview: getWorldOverview(world),
      findings: generateResearchFindings(world, this.comparison),
      comparison: this.comparison?.map((result) => ({ ...result, metrics: { ...result.metrics, funnel: { ...result.metrics.funnel }, lossHistory: [...result.metrics.lossHistory] } })),
      ...(verdict ? { verdict } : {}),
      ...(this.comparisonContext ? { comparisonContext: {
        ...this.comparisonContext,
        existingInterventions: [...this.comparisonContext.existingInterventions],
        audienceEventIds: [...this.comparisonContext.audienceEventIds],
      } } : {}),
      activeEvents: getActiveAudienceEvents(world),
      schemaVersion: SIMULATION_API_SCHEMA,
      snapshotId: `${world.seed}-${world.tick}-${world.eventSequence}-${this.revision}`,
      cursor,
    };
  }

  dispatch(command: SimulationCommand): SimulationSnapshot {
    const parsed = parseSimulationCommand(command);
    switch (parsed.type) {
      case "reset":
        this.world = resetWorld(parsed.seed ?? this.world.seed);
        this.comparison = undefined;
        break;
      case "tick": {
        const count = Math.max(1, Math.min(100, parsed.count ?? 1));
        for (let index = 0; index < count; index += 1) {
          this.world = tickSimulation(this.world, parsed.options);
        }
        break;
      }
      case "run":
        this.world = runSimulation(this.world, {
          days: parsed.days,
          ticks: parsed.ticks,
          ...(parsed.options ?? {}),
        });
        break;
      case "intervention":
        this.world = applyIntervention(this.world, parsed.strategy);
        break;
      case "inject-event": {
        const existing = this.world.audienceEvents?.find((event) => event.eventId === parsed.eventId);
        if (existing) return this.getSnapshot();
        this.world = injectAudienceEvent(this.world, {
          eventId: parsed.eventId,
          type: parsed.eventType,
          duration: parsed.duration,
          label: parsed.label,
        });
        break;
      }
      case "pause":
        this.world = pauseWorld(this.world);
        break;
      case "resume":
        this.world = resumeWorld(this.world);
        break;
      case "compare": {
        const mode = parsed.mode ?? "seed";
        const sourceSnapshotId = this.getSnapshot().snapshotId;
        this.comparison = mode === "snapshot"
          ? compareFromSnapshot(this.world, { days: parsed.days, ticks: parsed.ticks })
          : compareStrategies(this.world.seed, {
            days: parsed.days, ticks: parsed.ticks, settings: this.world.settings,
          });
        this.comparisonContext = {
          mode, sourceSnapshotId,
          sourceTick: mode === "snapshot" ? this.world.tick : 0,
          horizonTicks: parsed.ticks ?? (parsed.days ?? this.world.settings.totalDays) * this.world.settings.ticksPerDay,
          existingInterventions: mode === "snapshot" ? [...this.world.activeInterventions] : [],
          audienceEventIds: mode === "snapshot" ? (this.world.audienceEvents ?? []).map(event => event.eventId) : [],
          caveat: mode === "snapshot"
            ? "No additional intervention is the baseline. Existing interventions and audience events are retained; metrics are cumulative. Same initial RNG state, not identical later encounters. Synthetic outcomes only."
            : "Fresh seeded city without audience incidents or existing interventions. Synthetic outcomes only.",
        };
        break;
      }
    }
    // A later world command must not present an old experiment as current evidence.
    if (parsed.type !== "compare") {
      this.comparison = undefined;
      this.comparisonContext = undefined;
    }
    this.revision += 1;
    return this.getSnapshot();
  }

  getHealth(): SimulationHealth {
    const world = this.world;
    return {
      status: "ok",
      schemaVersion: SIMULATION_API_SCHEMA,
      uptimeSeconds: Math.floor(process.uptime()),
      world: {
        seed: world.seed,
        tick: world.tick,
        day: world.day,
        phase: world.phase,
        eventSequence: world.eventSequence,
      },
      cursor: this.getCursor(world),
    };
  }

  private getCursor(world: WorldState): SimulationCursor {
    const feedLength = world.eventFeed.length;
    const eventFeedStart = feedLength > 0
      ? Math.max(1, world.eventSequence - feedLength + 1)
      : world.eventSequence + 1;
    return {
      revision: this.revision,
      tick: world.tick,
      eventSequence: world.eventSequence,
      eventFeedStart,
      eventFeedEnd: world.eventSequence,
      eventFeedTruncated: eventFeedStart > 1,
    };
  }
}

const globalScope = globalThis as typeof globalThis & { __scamCitySimulationStore?: SimulationStore };

export function getSimulationStore(): SimulationStore {
  if (!globalScope.__scamCitySimulationStore) {
    globalScope.__scamCitySimulationStore = new SimulationStore(42);
  }
  return globalScope.__scamCitySimulationStore;
}
