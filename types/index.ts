/**
 * Domain types shared by the simulation engine and the presentation layer.
 * All values in this file are JSON serialisable so a WorldState can safely be
 * sent through a Next.js route or saved as a fixture.
 */

export type CitizenState =
  | "safe"
  | "suspicious"
  | "engaged"
  | "trusted"
  | "clicked"
  | "victim"
  | "protected";

export type Occupation =
  | "Student"
  | "Software Engineer"
  | "Teacher"
  | "Small Business Owner"
  | "Retired Worker"
  | "Designer"
  | "Driver"
  | "Finance Worker"
  | "Freelancer"
  | "Nurse"
  | "Restaurant Owner";

export type RelationshipType = "family" | "friend" | "coworker" | "neighbor";

export type ScamStrategy =
  | "fake-customer-service"
  | "fake-investment"
  | "impersonation"
  | "authority-scam"
  | "phishing-link";

export type InterventionStrategy =
  | "baseline"
  | "mass-warning"
  | "bank-risk-agent"
  | "social-guardian"
  | "network-intervention";

export type FraudDecision = "ignore" | "engage" | "trust" | "click" | "transfer" | "blocked" | "cancelled";

export type SimulationPhase = "idle" | "running" | "paused" | "complete";

/** Audience-controlled incidents. Each whitelisted type declares the scam
 * strategies it amplifies, so an incident changes the deterministic model in a
 * bounded, explainable way. Durations are measured in simulation ticks. */
export type AudienceEventType = "bank-outage" | "deepfake-voice" | "market-panic";

export interface AudienceEvent {
  /** Stable idempotency key supplied by the caller. */
  eventId: string;
  type: AudienceEventType;
  label: string;
  duration: number;
  startTick: number;
  endTick: number;
  /** Scam strategies amplified while this incident is active. Optional for
   * backward compatibility with snapshots saved before the impact model. */
  affectedStrategies?: ScamStrategy[];
  /** Added susceptibility points applied to an affected strategy. */
  susceptibilityBoost?: number;
}

export interface Location {
  x: number;
  y: number;
  zone: "residential" | "commercial" | "campus" | "waterfront" | "transit";
}

export interface TimelineEvent {
  id: string;
  tick: number;
  time: string;
  type: string;
  message: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface Citizen {
  id: string;
  name: string;
  age: number;
  occupation: Occupation;
  assets: number;
  digitalLiteracy: number;
  riskAwareness: number;
  stress: number;
  loneliness: number;
  familyTrust: number;
  strangerTrust: number;
  authorityTrust: number;
  impulsiveness: number;
  socialInfluence: number;
  connections: string[];
  location: Location;
  state: CitizenState;
  currentThought: string;
  timeline: TimelineEvent[];
  warningsReceived: number;
  warningFatigue: number;
  previousScamAttempts: number;
  lastInteractionTick?: number;
  isHub?: boolean;
}

export interface SocialEdge {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  strength: number;
  trust: number;
}

export interface SocialGraph {
  nodes: string[];
  edges: SocialEdge[];
  adjacency: Record<string, string[]>;
  centrality: Record<string, number>;
  hubs: string[];
}

export interface ScammerAgent {
  id: string;
  name: string;
  strategy: ScamStrategy;
  description: string;
  messagesSent: number;
  successfulTransfers: number;
  active: boolean;
}

export interface ScamMessage {
  id: string;
  scammerId: string;
  targetId: string;
  strategy: ScamStrategy;
  sentAtTick: number;
  content: string;
  amount: number;
  status: FraudDecision | "blocked" | "cancelled";
  probability: number;
  factors: RiskFactor[];
}

export interface RiskFactor {
  name: string;
  contribution: number;
  explanation: string;
}

export interface FraudProbabilityResult {
  probability: number;
  susceptibility: number;
  likelyDecision: FraudDecision;
  factors: RiskFactor[];
  explanation: string;
}

export interface ScamInteraction {
  id: string;
  tick: number;
  citizenId: string;
  scammerId: string;
  strategy: ScamStrategy;
  decision: FraudDecision | "blocked" | "cancelled";
  probability: number;
  amount: number;
  interrupted: boolean;
  intervention?: InterventionStrategy;
}

export interface SimulationEvent {
  id: string;
  tick: number;
  time: string;
  kind:
    | "system"
    | "audience"
    | "scam"
    | "citizen"
    | "intervention"
    | "warning"
    | "outcome";
  message: string;
  citizenId?: string;
  scammerId?: string;
  audienceEventId?: string;
  severity?: "info" | "warning" | "danger" | "success";
}

export interface FunnelMetrics {
  messagesSent: number;
  engaged: number;
  trusted: number;
  clicked: number;
  transferred: number;
}

export interface LossPoint {
  tick: number;
  day: number;
  label: string;
  loss: number;
  victims: number;
}

export interface SimulationMetrics {
  victims: number;
  moneyLost: number;
  fraudAttempts: number;
  warningsSent: number;
  falsePositives: number;
  successfulInterventions: number;
  interventionCost: number;
  safetyIndex: number;
  trustIndex: number;
  funnel: FunnelMetrics;
  lossHistory: LossPoint[];
}

export interface InterventionRecord {
  strategy: InterventionStrategy;
  tick: number;
  cost: number;
  warningsSent: number;
  coverage: number;
}

export interface SimulationSettings {
  ticksPerDay: number;
  totalDays: number;
  scammerActionInterval: number;
  maxEventFeed: number;
  maxInteractions: number;
}

export interface WorldState {
  version: 1;
  seed: number;
  rngState: number;
  tick: number;
  day: number;
  time: string;
  phase: SimulationPhase;
  citizens: Citizen[];
  socialGraph: SocialGraph;
  scammers: ScammerAgent[];
  messages: ScamMessage[];
  interactions: ScamInteraction[];
  eventFeed: SimulationEvent[];
  /** Monotonic per-world event counter. It must not be derived from the truncated feed length. */
  eventSequence: number;
  /** Accepted audience events, retained as an idempotency ledger. Optional
   * for backward compatibility with pre-event saved snapshots/fixtures. */
  audienceEvents?: AudienceEvent[];
  metrics: SimulationMetrics;
  settings: SimulationSettings;
  activeInterventions: InterventionStrategy[];
  interventionHistory: InterventionRecord[];
  networkInfluencerIds: string[];
}

/**
 * Versioned metadata exposed by the HTTP command surface.  The simulation
 * world remains the source of truth; these fields let external renderers
 * detect a new snapshot and consume the event feed without guessing whether
 * the rolling window has dropped older events.
 */
export const SIMULATION_API_SCHEMA = "scamcity.simulation/v1" as const;

export interface SimulationCursor {
  /** Increments for every command dispatched to the process-local store. */
  revision: number;
  tick: number;
  /** Highest event sequence ever emitted by this world. */
  eventSequence: number;
  /** Sequence range currently present in the rolling event feed. */
  eventFeedStart: number;
  eventFeedEnd: number;
  eventFeedTruncated: boolean;
}

export interface SimulationHealth {
  status: "ok";
  schemaVersion: typeof SIMULATION_API_SCHEMA;
  uptimeSeconds: number;
  world: Pick<WorldState, "seed" | "tick" | "day" | "phase" | "eventSequence">;
  cursor: SimulationCursor;
}

export interface SimulationTickOptions {
  /** Set false when a caller only wants citizens to move without scam activity. */
  processScams?: boolean;
  /** Set true to avoid appending events while running a high-speed comparison. */
  compactEvents?: boolean;
}

export interface RunOptions extends SimulationTickOptions {
  ticks?: number;
  days?: number;
}

/** Provenance for a strategy experiment, distinct from the currently displayed world. */
export interface ComparisonContext {
  mode: "seed" | "snapshot";
  sourceSnapshotId: string;
  sourceTick: number;
  horizonTicks: number;
  existingInterventions: InterventionStrategy[];
  audienceEventIds: string[];
  caveat: string;
}

export interface ComparisonSummary {
  strategy: InterventionStrategy;
  label: string;
  metrics: SimulationMetrics;
  world: WorldState;
}

/**
 * Three-column comparison reading used by the dashboard and the run report.
 * Splitting impact, friction and cost keeps a single low-loss number from being
 * read as "this strategy is best".
 */
export interface ComparisonScorecard {
  strategy: InterventionStrategy;
  label: string;
  impact: {
    victims: number;
    moneyLost: number;
  };
  friction: {
    falsePositives: number;
    warningsSent: number;
  };
  cost: {
    /** Abstract comparison units, not an estimate of deployment cost. */
    interventionCost: number;
  };
}

/** The single shared "best" decision, including the reason it was chosen. */
export interface ComparisonVerdict {
  rule: string;
  bestStrategy: InterventionStrategy;
  bestLabel: string;
  reason: string;
  ranking: InterventionStrategy[];
  scorecards: ComparisonScorecard[];
  disclaimer: string;
}

export interface ResearchFinding {
  id: string;
  title: string;
  statement: string;
  evidence: string;
  category: "risk" | "network" | "intervention" | "behavior";
}

export interface LLMDecision {
  decision: FraudDecision;
  thought: string;
  reason: string;
}

export interface LLMContext {
  citizen: Pick<
    Citizen,
    | "name"
    | "age"
    | "occupation"
    | "digitalLiteracy"
    | "riskAwareness"
    | "stress"
    | "familyTrust"
    | "strangerTrust"
    | "authorityTrust"
    | "impulsiveness"
  >;
  strategy: ScamStrategy;
  message: string;
  probability: number;
  /** The deterministic engine's recorded outcome. Narration may explain it but never replace it. */
  actualDecision?: FraudDecision;
}

export interface LLMConfig {
  enabled: boolean;
  apiKey?: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
}

export const INTERVENTION_LABELS: Record<InterventionStrategy, string> = {
  baseline: "Baseline",
  "mass-warning": "Mass Warning",
  "bank-risk-agent": "Bank Risk Agent",
  "social-guardian": "Social Guardian",
  "network-intervention": "Network Intervention",
};

export const SCAM_STRATEGY_LABELS: Record<ScamStrategy, string> = {
  "fake-customer-service": "Fake Customer Service",
  "fake-investment": "Fake Investment",
  impersonation: "Impersonation",
  "authority-scam": "Authority Scam",
  "phishing-link": "Phishing Link",
};
