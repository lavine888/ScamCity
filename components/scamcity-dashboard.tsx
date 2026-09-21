"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  addDemoEvent,
  activateDemoIntervention,
  advanceWorld,
  cloneWorld,
  createDemoWorld,
  formatMoney,
  percent,
  simulateStrategy,
  type ComparisonResult,
} from "@/components/scamcity-demo";
import {
  INTERVENTION_LABELS,
  SCAM_STRATEGY_LABELS,
  type SimulationCursor,
  type Citizen,
  type CitizenState,
  type InterventionStrategy,
  type LossPoint,
  type SimulationEvent,
  type WorldState,
} from "@/types";
import type { SimulationCommand } from "@/lib/simulation-api";
import { compareFromSnapshot } from "@/simulation/world";
import { verdictFor } from "@/simulation/comparison";

type Speed = 1 | 5 | 20;
type ConnectionState = "checking" | "connected" | "offline";
type DataSource = "local" | "live";

/** Mirrors LiveThought in agents/live-thoughts.ts. */
interface LiveThought {
  citizenId: string;
  citizenName: string;
  strategy: string;
  tick: number;
  engineDecision: string;
  probability: number;
  thought: string;
  reason: string;
  source: "live" | "fallback";
}

interface LiveThoughtsResult {
  mode: "live" | "deterministic-fallback";
  model: string;
  generatedAt: string;
  latencyMs: number;
  thoughts: LiveThought[];
  note?: string;
}

interface ComparisonContext {
  mode: "seed" | "snapshot"; sourceSnapshotId?: string; sourceTick: number; horizonTicks: number;
  existingInterventions: InterventionStrategy[]; caveat: string;
}
interface AgentDecision {
  source: "model" | "rules" | "fallback"; model?: string; strategy: InterventionStrategy; reason: string;
  budget: number; estimatedCost: number; actualCost: number; beforeTick: number; afterTick: number;
  beforeSnapshotId: string; afterSnapshotId: string; snapshot: LiveSnapshot;
}

interface LiveComparison {
  label?: string;
  strategy: InterventionStrategy;
  metrics: WorldState["metrics"];
  world?: WorldState;
}

interface LiveSnapshot {
  world: WorldState;
  comparison?: LiveComparison[];
  comparisonContext?: ComparisonContext;
  schemaVersion?: string;
  snapshotId: string;
  cursor: SimulationCursor;
}

const SESSION_STORAGE_KEY = "scamcity.presenter-session.v1";
const PRESENTER_DURATION_MS = 180_000;

const INTERVENTIONS: InterventionStrategy[] = [
  "mass-warning",
  "bank-risk-agent",
  "social-guardian",
  "network-intervention",
];

const DEMO_STEPS = [
  "100 synthetic citizens are living their normal lives.",
  "Five scammer agents entered the city.",
  "Several citizens are now receiving suspicious messages.",
  "Baseline snapshot captured. What happens when we intervene?",
  "Social Guardian is calling the right people at the right moment.",
  "Re-running the same synthetic society with a guardian layer.",
  "Before / after comparison is ready for the research team.",
  "What if we could test social interventions before deploying them in the real world?",
];

const PRESENTER_BEATS = [
  "SETUP / THE CITY IS QUIET",
  "THREAT / SCAM AGENTS ENTER",
  "ESCALATION / TRUST IS EXPLOITED",
  "BASELINE / THE COST IS VISIBLE",
  "INTERVENTION / GUARDIANS ACT",
  "REPLAY / SAME PEOPLE, NEW CONDITIONS",
  "RESULT / COMPARE THE OUTCOMES",
  "TAKEAWAY / TEST BEFORE DEPLOYMENT",
];

const STATE_LABELS: Record<CitizenState, string> = {
  safe: "Safe",
  suspicious: "Suspicious",
  engaged: "Engaged",
  trusted: "Trusted",
  clicked: "Clicked",
  victim: "Victim",
  protected: "Protected",
};

const STATE_COLORS: Record<CitizenState, string> = {
  safe: "#4c91ff",
  suspicious: "#facc15",
  engaged: "#f59e0b",
  trusted: "#ff8c42",
  clicked: "#fb923c",
  victim: "#fb3b50",
  protected: "#40e0a0",
};

const numberFormatter = new Intl.NumberFormat("en-HK");

function stateColor(state: CitizenState): string {
  return STATE_COLORS[state] ?? STATE_COLORS.safe;
}

function stateLabel(state: CitizenState): string {
  return STATE_LABELS[state] ?? state;
}

function eventClass(event: SimulationEvent): string {
  return `event-row ${event.severity ?? "info"}`;
}

function MetricCard({ label, value, note, tone = "cyan", icon }: {
  label: string;
  value: ReactNode;
  note?: string;
  tone?: "cyan" | "red" | "violet" | "green" | "amber";
  icon?: string;
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <div className="metric-label"><span>{icon}</span>{label}</div>
      <div className="metric-value">{value}</div>
      {note ? <div className="metric-note">{note}</div> : null}
    </div>
  );
}

function SectionTitle({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: ReactNode }) {
  return (
    <div className="section-title">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h2>{title}</h2>
      </div>
      {right}
    </div>
  );
}

function ProgressBar({ value, tone = "cyan" }: { value: number; tone?: string }) {
  return (
    <div className="progress-track" aria-label={`${Math.round(value)} percent`}>
      <span className={`progress-value ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function LossChart({ points }: { points: LossPoint[] }) {
  const width = 520;
  const height = 158;
  const padding = { top: 12, right: 12, bottom: 24, left: 42 };
  const source = points.length ? points : [{ tick: 0, day: 1, label: "Day 1 · 08:00", loss: 0, victims: 0 }];
  const maxValue = Math.max(10, ...source.map((point) => point.loss));
  const x = (index: number) => padding.left + (index / Math.max(1, source.length - 1)) * (width - padding.left - padding.right);
  const y = (value: number) => height - padding.bottom - (value / maxValue) * (height - padding.top - padding.bottom);
  const line = source.map((point, index) => `${x(index)},${y(point.loss)}`).join(" ");
  const area = `${padding.left},${height - padding.bottom} ${line} ${x(source.length - 1)},${height - padding.bottom}`;
  return (
    <div className="chart-wrap">
      <div className="chart-caption"><span>CUMULATIVE FINANCIAL LOSS</span><b>{formatMoney(source[source.length - 1].loss)}</b></div>
      <svg viewBox={`0 0 ${width} ${height}`} className="loss-chart" role="img" aria-label="Cumulative financial loss chart">
        <defs>
          <linearGradient id="loss-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fb3b50" stopOpacity="0.24" />
            <stop offset="1" stopColor="#fb3b50" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((ratio) => (
          <g key={ratio}>
            <line x1={padding.left} x2={width - padding.right} y1={y(maxValue * ratio)} y2={y(maxValue * ratio)} className="chart-grid" />
            <text x={padding.left - 8} y={y(maxValue * ratio) + 4} textAnchor="end" className="chart-axis">{formatMoney(maxValue * ratio).replace("HK$", "$")}</text>
          </g>
        ))}
        <polygon points={area} fill="url(#loss-fill)" />
        <polyline points={line} fill="none" className="loss-line" />
        {source.slice(-1).map((point, index) => (
          <circle key={`${point.tick}-${index}`} cx={x(source.length - 1)} cy={y(point.loss)} r="4" className="loss-dot" />
        ))}
        <text x={padding.left} y={height - 6} className="chart-axis">START</text>
        <text x={width - padding.right} y={height - 6} textAnchor="end" className="chart-axis">{source[source.length - 1].label}</text>
      </svg>
    </div>
  );
}

function Funnel({ world }: { world: WorldState }) {
  const funnel = world.metrics.funnel;
  const rows = [
    ["Messages sent", funnel.messagesSent, "cyan"],
    ["Engaged", funnel.engaged, "blue"],
    ["Trusted", funnel.trusted, "violet"],
    ["Clicked", funnel.clicked, "amber"],
    ["Transferred", funnel.transferred, "red"],
  ] as const;
  const max = Math.max(1, funnel.messagesSent);
  return (
    <div className="funnel">
      {rows.map(([label, value, tone]) => (
        <div className="funnel-row" key={label}>
          <span>{label}</span>
          <div className="funnel-bar"><span className={tone} style={{ width: `${Math.max(2, (value / max) * 100)}%` }} /></div>
          <b>{value}</b>
        </div>
      ))}
    </div>
  );
}

function CitizenTrait({ label, value, tone = "cyan" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="trait-row">
      <div><span>{label}</span><b>{Math.round(value)}</b></div>
      <ProgressBar value={value} tone={tone} />
    </div>
  );
}

function CitizenDetails({ citizen, world, onClose }: { citizen?: Citizen; world: WorldState; onClose: () => void }) {
  if (!citizen) {
    return (
      <div className="detail-empty"><span className="detail-crosshair">⊙</span><p>Select a citizen on the map to inspect their synthetic profile.</p></div>
    );
  }
  const latestMessage = [...world.messages].reverse().find((message) => message.targetId === citizen.id);
  const interactions = world.interactions.filter((interaction) => interaction.citizenId === citizen.id).slice(-4).reverse();
  return (
    <div className="citizen-detail">
      <div className="detail-head">
        <div className="avatar-large" style={{ borderColor: stateColor(citizen.state), color: stateColor(citizen.state) }}>{citizen.name.slice(0, 1)}</div>
        <div><div className="detail-kicker">SYNTHETIC CITIZEN / {citizen.id.toUpperCase()}</div><h3>{citizen.name}</h3><p>{citizen.age} · {citizen.occupation}</p></div>
        <button className="icon-button" onClick={onClose} aria-label="Close citizen details">×</button>
      </div>
      <div className="state-line"><span className="state-dot" style={{ background: stateColor(citizen.state) }} />{stateLabel(citizen.state)}<span className="state-location">{citizen.location.zone.toUpperCase()}</span></div>
      <div className="thought-block"><div className="eyebrow">1 / LATEST RECORDED MESSAGE</div><p>{latestMessage ? latestMessage.content : "No scam message recorded for this citizen yet."}</p>{latestMessage ? <small>T+{latestMessage.sentAtTick} · requested {formatMoney(latestMessage.amount)} · recorded outcome: {latestMessage.status}</small> : null}</div>
      <div className="detail-money"><span>ASSETS</span><strong>{formatMoney(citizen.assets)}</strong></div>
      <div className="trait-grid">
        <CitizenTrait label="Digital literacy" value={citizen.digitalLiteracy} tone="blue" />
        <CitizenTrait label="Risk awareness" value={citizen.riskAwareness} tone="green" />
        <CitizenTrait label="Family trust" value={citizen.familyTrust} tone="violet" />
        <CitizenTrait label="Stranger trust" value={citizen.strangerTrust} tone="amber" />
        <CitizenTrait label="Authority trust" value={citizen.authorityTrust} tone="red" />
        <CitizenTrait label="Stress" value={citizen.stress} tone="red" />
      </div>
      <div className="thought-block"><div className="eyebrow">2 / CURRENT THOUGHT — ENGINE STATE</div><p>“{citizen.currentThought}”</p></div>
      <div className="detail-meta"><span>Connections <b>{citizen.connections.length}</b></span><span>Warnings <b>{citizen.warningsReceived}</b></span><span>Influence <b>{Math.round(citizen.socialInfluence)}</b></span></div>
      <div className="timeline">
        <div className="eyebrow">3 / RECORDED TIMELINE</div>
        {[...citizen.timeline.map((event) => ({ tick: event.tick, time: event.time, message: event.message })), ...interactions.map((interaction) => ({ tick: interaction.tick, time: `T+${interaction.tick}`, message: `${interaction.decision} · ${interaction.strategy.replaceAll("-", " ")}` }))].sort((a, b) => b.tick - a.tick).slice(0, 5).map((event, index) => (
          <div className="timeline-item" key={`${event.time}-${event.message}-${index}`}><span>{event.time}</span><p>{event.message}</p></div>
        ))}
      </div>
    </div>
  );
}

function CityMap({ world, selectedId, onSelect }: { world: WorldState; selectedId?: string; onSelect: (id: string) => void }) {
  const positions = useMemo(() => new Map(world.citizens.map((citizen) => [citizen.id, citizen.location])), [world.citizens]);
  return (
    <div className="city-map-wrap">
      <svg viewBox="0 0 100 100" className="city-map" role="img" aria-label="ScamCity synthetic citizen map">
        <defs>
          <pattern id="city-grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M 5 0 L 0 0 0 5" fill="none" stroke="#1c3040" strokeWidth="0.22" /></pattern>
          <filter id="node-glow"><feGaussianBlur stdDeviation="1.1" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <rect width="100" height="100" fill="#07121b" />
        <rect width="100" height="100" fill="url(#city-grid)" opacity="0.7" />
        <path d="M 0 70 C 20 60, 24 84, 42 73 S 70 61, 100 82 L 100 100 L 0 100 Z" fill="#0a2029" opacity="0.75" />
        <path d="M 13 0 L 20 100 M 67 0 L 63 100 M 0 32 L 100 27 M 0 55 L 100 63" className="city-road" />
        <text x="4" y="11" className="zone-label">NORTH RESIDENTIAL</text>
        <text x="72" y="23" className="zone-label">CAMPUS</text>
        <text x="4" y="64" className="zone-label">COMMERCIAL</text>
        <text x="72" y="91" className="zone-label">WATERFRONT</text>
        <g className="social-edges">
          {world.socialGraph.edges.map((edge) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            if (!source || !target) return null;
            const highlighted = edge.source === selectedId || edge.target === selectedId;
            return <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={highlighted ? "social-edge highlighted" : "social-edge"} />;
          })}
        </g>
        <g className="scammer-pings">
          {world.scammers.map((scammer, index) => {
            const x = 7 + index * 10.2;
            return <g key={scammer.id} transform={`translate(${x} 5)`} className="scammer-ping"><circle r="2.2" /><text y="0.95" textAnchor="middle">!</text></g>;
          })}
        </g>
        <g className="citizen-nodes">
          {world.citizens.map((citizen) => {
            const selected = citizen.id === selectedId;
            const color = stateColor(citizen.state);
            return (
              <g key={citizen.id} className={`citizen-node ${selected ? "selected" : ""} ${citizen.isHub ? "hub" : ""}`} transform={`translate(${citizen.location.x} ${citizen.location.y})`} onClick={() => onSelect(citizen.id)} tabIndex={0} role="button" aria-label={`${citizen.name}, ${stateLabel(citizen.state)}`}>
                {citizen.isHub ? <circle r="2.15" className="hub-ring" /> : null}
                <circle r={selected ? 1.85 : 1.15} fill={color} style={{ filter: selected || citizen.state === "victim" ? "url(#node-glow)" : undefined }} />
                {selected ? <circle r="3.1" className="selection-ring" /> : null}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="map-legend">
        <span><i style={{ background: STATE_COLORS.safe }} />SAFE</span><span><i style={{ background: STATE_COLORS.suspicious }} />SUSPICIOUS</span><span><i style={{ background: STATE_COLORS.victim }} />VICTIM</span><span><i style={{ background: STATE_COLORS.protected }} />PROTECTED</span><span><i className="legend-ring" />HUB</span>
      </div>
      <div className="map-hud"><span>100 NODES</span><span>{world.socialGraph.edges.length} EDGES</span><span>SEED {world.seed}</span></div>
    </div>
  );
}

function ComparisonPanel({ results, context }: { results: ComparisonResult[]; context?: ComparisonContext }) {
  if (!results.length) return null;
  // The "best" decision comes from the shared engine rule so the dashboard, the
  // API snapshot and the run report cannot disagree about which strategy leads.
  const verdict = verdictFor(results);
  const maxLoss = Math.max(1, ...results.map((result) => result.metrics.moneyLost));
  return (
    <section className="comparison-panel panel">
      <SectionTitle eyebrow="INTERVENTION LAB / 07 DAY REPLAY" title={context?.mode === "snapshot" ? `From T+${context.sourceTick}: which addition leads?` : "From seed: which intervention leads?"} right={<span className="result-badge">{verdict ? `${verdict.bestLabel} leads` : "RESULTS READY"}</span>} />
      <p className="panel-copy">{context?.mode === "snapshot" ? `Same current snapshot, ${context.horizonTicks} additional ticks. Existing interventions retained: ${context.existingInterventions.map((item) => INTERVENTION_LABELS[item]).join(", ") || "none"}. Baseline means no additional intervention. Totals include pre-branch history.` : "Fresh seeded city; strategies start from zero. This is not a replay of the current incident."} {context?.caveat}</p>
      <div className="comparison-grid">
        {results.map((result) => {
          const isBest = result.strategy === verdict?.bestStrategy;
          return (
            <div className={`comparison-card ${isBest ? "best" : ""}`} key={result.strategy}>
              <div className="comparison-card-top"><span>{isBest ? "★ " : ""}{result.label ?? INTERVENTION_LABELS[result.strategy]}</span><b>{result.metrics.safetyIndex}</b></div>
              <div className="comparison-bar"><span style={{ width: `${(result.metrics.moneyLost / maxLoss) * 100}%` }} /></div>
              <div className="comparison-values"><span><small>IMPACT / VICTIMS</small><strong>{result.metrics.victims}</strong></span><span><small>IMPACT / LOSS</small><strong>{formatMoney(result.metrics.moneyLost)}</strong></span><span><small>COST</small><strong>{formatMoney(result.metrics.interventionCost)}</strong></span></div>
              <div className="comparison-foot"><span>FRICTION · {Math.round(result.metrics.warningsSent)} warnings</span><span>{result.metrics.falsePositives} false positives</span></div>
            </div>
          );
        })}
      </div>
      {verdict ? (
        <p className="comparison-verdict">
          <b>RULE</b> {verdict.rule}. {verdict.reason} <i>{verdict.disclaimer}</i>
        </p>
      ) : null}
    </section>
  );
}

function PresenterConsole({
  active,
  step,
  demoActive,
  connectionState,
  recoveryAvailable,
  audiencePrompt,
  onAudiencePromptChange,
  onInjectAudienceEvent,
  onPause,
  onResume,
  onRestart,
  onSkip,
  onExit,
  onRecover,
}: {
  active: boolean;
  step: number;
  demoActive: boolean;
  connectionState: ConnectionState;
  recoveryAvailable: boolean;
  audiencePrompt: string;
  onAudiencePromptChange: (value: string) => void;
  onInjectAudienceEvent: () => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onSkip: () => void;
  onExit: () => void;
  onRecover: () => void;
}) {
  if (!active) return null;
  const safeStep = Math.min(Math.max(step, 0), DEMO_STEPS.length - 1);
  const progress = Math.min(100, Math.round(((safeStep + (demoActive ? 0.45 : 0)) / DEMO_STEPS.length) * 100));
  const beat = PRESENTER_BEATS[safeStep];
  const connectionLabel = connectionState === "connected"
    ? "WEB API ONLINE"
    : connectionState === "checking"
      ? "CHECKING WEB API"
      : "LOCAL FALLBACK ACTIVE";

  return (
    <section className="presenter-console panel" aria-live="polite">
      <div className="presenter-head">
        <div>
          <span className="eyebrow">PRESENTER MODE / {Math.floor(PRESENTER_DURATION_MS / 60_000)}:00 RUN OF SHOW</span>
          <h2>{beat}</h2>
        </div>
        <div className="presenter-head-actions">
          <span className={`connection-status ${connectionState}`}><i />{connectionLabel}</span>
          <button className="mini-toggle" onClick={onExit}>EXIT</button>
        </div>
      </div>
      <div className="presenter-progress" aria-label={`Presenter flow ${progress}% complete`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="presenter-body">
        <div className="presenter-story">
          <span className="presenter-step">BEAT {String(safeStep + 1).padStart(2, "0")} / {String(DEMO_STEPS.length).padStart(2, "0")}</span>
          <p>{demoActive ? DEMO_STEPS[safeStep] : "The scene is paused. Resume the run, restart from a clean city, or jump straight to the measured outcome."}</p>
        </div>
        <div className="presenter-actions">
          <button className="control-button primary" onClick={demoActive ? onPause : onResume}>{demoActive ? "Ⅱ PAUSE FLOW" : "▶ RESUME FLOW"}</button>
          <button className="control-button ghost" onClick={onRestart}>↻ RESTART 3-MIN FLOW</button>
          <button className="control-button ghost" onClick={onSkip}>SKIP TO OUTCOME ↗</button>
          {recoveryAvailable ? <button className="control-button recover-button" onClick={onRecover}>↺ RECOVER LAST SESSION</button> : null}
        </div>
      </div>
      <div className="audience-row">
        <label htmlFor="audience-event"><span>LIVE AUDIENCE INPUT</span><small>Inject a prompt into the city event stream.</small></label>
        <input id="audience-event" value={audiencePrompt} onChange={(event) => onAudiencePromptChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onInjectAudienceEvent(); }} placeholder="e.g. GPT-7 is released overnight" maxLength={90} />
        <button className="research-button" onClick={onInjectAudienceEvent} disabled={!audiencePrompt.trim()}>INJECT EVENT</button>
      </div>
      {connectionState === "offline" ? <div className="presenter-fallback"><span>●</span> Web API is unreachable. The deterministic local engine is still running; reconnecting will be retried automatically.</div> : null}
    </section>
  );
}

export default function ScamCityDashboard() {
  const [world, setWorld] = useState<WorldState>(() => createDemoWorld());
  const [selectedId, setSelectedId] = useState("citizen-001");
  const [speed, setSpeed] = useState<Speed>(5);
  const [seedInput, setSeedInput] = useState("42");
  const [strategy, setStrategy] = useState<InterventionStrategy>("social-guardian");
  const [comparisonResults, setComparisonResults] = useState<ComparisonResult[]>([]);
  const [comparisonContext, setComparisonContext] = useState<ComparisonContext>();
  const [agentBudget, setAgentBudget] = useState("1000");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentDecision, setAgentDecision] = useState<AgentDecision>();
  const [agentError, setAgentError] = useState<string>();
  const sourceEpochRef = useRef(0);
  const compareRequestRef = useRef(false);
  const [isComparing, setIsComparing] = useState(false);
  const [demoActive, setDemoActive] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [presenterMode, setPresenterMode] = useState(false);
  const [dataSource, setDataSource] = useState<DataSource>("local");
  const [connectionState, setConnectionState] = useState<ConnectionState>("checking");
  const [lastCheckedAt, setLastCheckedAt] = useState<number>();
  const [liveSnapshotId, setLiveSnapshotId] = useState<string>();
  const [liveCursor, setLiveCursor] = useState<SimulationCursor>();
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState<string>();
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [audiencePrompt, setAudiencePrompt] = useState("");
  const [showIntervention, setShowIntervention] = useState(false);
  const [thoughts, setThoughts] = useState<LiveThoughtsResult>();
  const [thoughtsBusy, setThoughtsBusy] = useState(false);
  const [thoughtsError, setThoughtsError] = useState<string>();
  const eventsRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(world.phase);
  const sessionSaveTimerRef = useRef<number | undefined>(undefined);
  const liveRequestRef = useRef(false);
  const thoughtsRequestRef = useRef(false);

  const selectedCitizen = useMemo(() => world.citizens.find((citizen) => citizen.id === selectedId), [selectedId, world.citizens]);
  const relationships = world.socialGraph.edges.length;
  const totalAssets = useMemo(() => world.citizens.reduce((sum, citizen) => sum + citizen.assets, 0), [world.citizens]);
  const recentEvents = useMemo(() => [...world.eventFeed].slice(-12).reverse(), [world.eventFeed]);

  useEffect(() => {
    phaseRef.current = world.phase;
  }, [world.phase]);

  useEffect(() => {
    eventsRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [world.eventFeed.length]);

  useEffect(() => {
    if (dataSource === "live") return undefined;
    let cancelled = false;
    const checkConnection = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 2400);
      try {
        const response = await fetch("/api/simulation", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!cancelled) {
          setConnectionState("connected");
          setLastCheckedAt(Date.now());
        }
      } catch {
        if (!cancelled) setConnectionState("offline");
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void checkConnection();
    const interval = window.setInterval(() => { void checkConnection(); }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [dataSource]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { version?: number; savedAt?: number; world?: WorldState };
      const recent = typeof saved.savedAt === "number" && Date.now() - saved.savedAt < 6 * 60 * 60 * 1000;
      if (saved.version === 1 && recent && saved.world?.version === 1 && saved.world.citizens?.length === 100) {
        setRecoveryAvailable(true);
      }
    } catch {
      // A corrupted browser session should never prevent the live demo from starting.
    }
  }, []);

  useEffect(() => {
    if (recoveryAvailable) return undefined;
    window.clearTimeout(sessionSaveTimerRef.current);
    sessionSaveTimerRef.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
          version: 1,
          savedAt: Date.now(),
          world,
          comparisonResults,
          demoStep,
          presenterMode,
        }));
      } catch {
        // Storage is a convenience for recovery; the in-memory simulation remains authoritative.
      }
    }, 1200);
    return () => window.clearTimeout(sessionSaveTimerRef.current);
  }, [world, comparisonResults, demoStep, presenterMode, recoveryAvailable]);

  const applyLiveSnapshot = useCallback((snapshot: LiveSnapshot) => {
    if (!snapshot?.world || snapshot.world.version !== 1 || !snapshot.snapshotId || !snapshot.cursor) {
      throw new Error("The live API returned an invalid simulation snapshot.");
    }
    setWorld(cloneWorld(snapshot.world));
    setComparisonResults((snapshot.comparison ?? []).map((result) => ({
      strategy: result.strategy,
      label: result.label,
      metrics: result.metrics,
      world: result.world ? cloneWorld(result.world) : cloneWorld(snapshot.world),
    })));
    setComparisonContext(snapshot.comparisonContext);
    setLiveSnapshotId(snapshot.snapshotId);
    setLiveCursor(snapshot.cursor);
  }, []);

  const fetchLiveSnapshot = useCallback(async (): Promise<boolean> => {
    if (liveRequestRef.current) return false;
    liveRequestRef.current = true;
    const epoch = sourceEpochRef.current;
    setLiveBusy(true);
    setLiveError(undefined);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4_000);
    try {
      const response = await fetch("/api/simulation", { cache: "no-store", signal: controller.signal });
      const payload = await response.json() as LiveSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `GET /api/simulation returned ${response.status}`);
      if (epoch !== sourceEpochRef.current) return false;
      applyLiveSnapshot(payload);
      setConnectionState("connected");
      setLastCheckedAt(Date.now());
      return true;
    } catch (error) {
      setConnectionState("offline");
      setLiveError(error instanceof Error ? error.message : "Live API sync failed.");
      return false;
    } finally {
      window.clearTimeout(timeout);
      liveRequestRef.current = false;
      setLiveBusy(false);
    }
  }, [applyLiveSnapshot]);

  const sendLiveCommand = useCallback(async (command: SimulationCommand): Promise<boolean> => {
    if (dataSource !== "live" || liveRequestRef.current) return false;
    liveRequestRef.current = true;
    const epoch = sourceEpochRef.current;
    setLiveBusy(true);
    setLiveError(undefined);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch("/api/simulation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
        signal: controller.signal,
      });
      const payload = await response.json() as LiveSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `POST /api/simulation returned ${response.status}`);
      if (epoch !== sourceEpochRef.current) return false;
      applyLiveSnapshot(payload);
      setConnectionState("connected");
      setLastCheckedAt(Date.now());
      return true;
    } catch (error) {
      setConnectionState("offline");
      setLiveError(error instanceof Error ? error.message : "Live API command failed.");
      return false;
    } finally {
      window.clearTimeout(timeout);
      liveRequestRef.current = false;
      setLiveBusy(false);
    }
  }, [applyLiveSnapshot, dataSource]);

  /**
   * Narrate recent scam interactions in the citizens' own words.
   *
   * Read-only and strictly additive: the route never mutates world state, and a
   * missing key, timeout or malformed reply degrades to the deterministic
   * thought with `source: "fallback"`, which the panel labels rather than hides.
   *
   * Only offered in live mode, because the route narrates the *server* store. In
   * local mode the dashboard runs its own in-browser world, so the thoughts
   * would describe a different city than the one on screen — exactly the kind of
   * mismatch this project treats as a correctness bug, not a cosmetic one.
   *
   * The timeout is generous because a gateway hop plus a dozen narrations is
   * slow by nature; measured around 8s for two citizens.
   */
  const fetchThoughts = useCallback(async (): Promise<void> => {
    // Guarded by a ref, not by thoughtsBusy: state is async, so two fast clicks
    // could both pass a state check before the first re-render. Keeping it out of
    // the dep array also stops the callback identity churning mid-flight.
    if (dataSource !== "live" || thoughtsRequestRef.current) return;
    thoughtsRequestRef.current = true;
    const epoch = sourceEpochRef.current;
    setThoughtsBusy(true);
    setThoughtsError(undefined);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch("/api/llm/thoughts?limit=4&concurrency=2", {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json() as LiveThoughtsResult & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `GET /api/llm/thoughts returned ${response.status}`);
      if (epoch === sourceEpochRef.current) setThoughts(payload);
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      setThoughtsError(aborted ? "Narration timed out after 45s." : error instanceof Error ? error.message : "Narration failed.");
    } finally {
      window.clearTimeout(timeout);
      thoughtsRequestRef.current = false;
      setThoughtsBusy(false);
    }
  }, [dataSource]);

  const switchToLive = useCallback(async () => {
    setLiveError(undefined);
    const synced = await fetchLiveSnapshot();
    if (synced) {
      setDemoActive(false);
      setPresenterMode(false);
      setDataSource("live");
    }
  }, [fetchLiveSnapshot]);

  const switchToLocal = useCallback(() => {
    sourceEpochRef.current += 1;
    setThoughts(undefined);
    setAgentDecision(undefined);
    setAgentError(undefined);
    setComparisonResults([]);
    setComparisonContext(undefined);
    setDataSource("local");
    setLiveError(undefined);
    setConnectionState("checking");
    setDemoActive(false);
    setPresenterMode(false);
  }, []);

  useEffect(() => {
    if (dataSource !== "live") return undefined;
    void fetchLiveSnapshot();
    const interval = window.setInterval(() => { void fetchLiveSnapshot(); }, 5_000);
    return () => window.clearInterval(interval);
  }, [dataSource, fetchLiveSnapshot]);

  useEffect(() => {
    if (demoActive || dataSource !== "local") return undefined;
    const interval = window.setInterval(() => {
      if (phaseRef.current !== "running") return;
      setWorld((previous) => {
        if (previous.phase !== "running") return previous;
        const next = cloneWorld(previous);
        advanceWorld(next, speed >= 20 ? 2 : 1);
        return next;
      });
    }, speed === 20 ? 82 : speed === 5 ? 230 : 820);
    return () => window.clearInterval(interval);
  }, [dataSource, demoActive, speed]);

  const reset = useCallback(() => {
    const parsedSeed = Number.parseInt(seedInput, 10);
    setRecoveryAvailable(false);
    if (dataSource === "live") {
      setDemoActive(false);
      setPresenterMode(false);
      void sendLiveCommand({ type: "reset", seed: Number.isFinite(parsedSeed) ? parsedSeed : 42 });
      return;
    }
    const next = createDemoWorld(Number.isFinite(parsedSeed) ? parsedSeed : 42);
    setDemoActive(false);
    setPresenterMode(false);
    setSelectedId("citizen-001");
    setComparisonResults([]);
    setDemoStep(0);
    setWorld(next);
  }, [dataSource, seedInput, sendLiveCommand]);

  const start = useCallback(() => {
    setRecoveryAvailable(false);
    if (dataSource === "live") {
      void sendLiveCommand({ type: "resume" });
      return;
    }
    setWorld((previous) => {
      const next = cloneWorld(previous);
      next.phase = "running";
      addDemoEvent(next, "Simulation live · scammer agents are observing the city.", "info");
      return next;
    });
  }, [dataSource, sendLiveCommand]);

  const pause = useCallback(() => {
    setRecoveryAvailable(false);
    if (dataSource === "live") {
      void sendLiveCommand({ type: "pause" });
      return;
    }
    setWorld((previous) => {
      const next = cloneWorld(previous);
      next.phase = "paused";
      addDemoEvent(next, "Simulation paused for observation.", "warning");
      return next;
    });
  }, [dataSource, sendLiveCommand]);

  const step = useCallback(() => {
    setRecoveryAvailable(false);
    if (dataSource === "live") {
      void sendLiveCommand({ type: "tick", count: 1 });
      return;
    }
    setWorld((previous) => {
      const next = cloneWorld(previous);
      next.phase = "running";
      advanceWorld(next, 1);
      next.phase = "paused";
      return next;
    });
  }, [dataSource, sendLiveCommand]);

  const runSevenDays = useCallback(() => {
    setRecoveryAvailable(false);
    setDemoActive(false);
    if (dataSource === "live") {
      void sendLiveCommand({ type: "run", days: 7 });
      return;
    }
    setWorld((previous) => {
      const next = cloneWorld(previous);
      next.phase = "running";
      addDemoEvent(next, "Fast-forwarding 7 days of synthetic social behavior.", "info");
      advanceWorld(next, next.settings.ticksPerDay * 7);
      next.phase = "complete";
      addDemoEvent(next, "7 day replay complete · metrics locked for review.", "success");
      return next;
    });
  }, [dataSource, sendLiveCommand]);

  const applyIntervention = useCallback(() => {
    setRecoveryAvailable(false);
    if (dataSource === "live") {
      void sendLiveCommand({ type: "intervention", strategy });
      setShowIntervention(false);
      return;
    }
    setWorld((previous) => {
      const next = cloneWorld(previous);
      activateDemoIntervention(next, strategy);
      setShowIntervention(false);
      return next;
    });
  }, [dataSource, sendLiveCommand, strategy]);

  const compareStrategies = useCallback((mode: "seed" | "snapshot" = "seed") => {
    if (compareRequestRef.current || liveRequestRef.current) return;
    compareRequestRef.current = true;
    const epoch = sourceEpochRef.current;
    setRecoveryAvailable(false);
    setIsComparing(true);
    if (dataSource === "live") {
      void sendLiveCommand({ type: "compare", mode, days: 7 }).finally(() => { compareRequestRef.current = false; setIsComparing(false); });
      return;
    }
    window.setTimeout(() => {
      const seed = Number.parseInt(seedInput, 10) || 42;
      if (epoch === sourceEpochRef.current) {
        const results = mode === "snapshot" ? compareFromSnapshot(world, { days: 7 }) : (["baseline", ...INTERVENTIONS] as InterventionStrategy[]).map((candidate) => simulateStrategy(seed, candidate, 7));
        setComparisonResults(results);
        setComparisonContext({ mode, sourceTick: mode === "snapshot" ? world.tick : 0, horizonTicks: world.settings.ticksPerDay * 7, existingInterventions: mode === "snapshot" ? [...world.activeInterventions] : [], caveat: "Deterministic model branches; matching seeds do not guarantee identical later encounters. Not a real-world causal estimate." });
      }
      compareRequestRef.current = false;
      setIsComparing(false);
    }, 120);
  }, [dataSource, seedInput, sendLiveCommand, world]);

  const decideIntervention = useCallback(async () => {
    if (dataSource !== "live" || liveRequestRef.current || !liveSnapshotId) return;
    const budget = Number(agentBudget);
    if (!agentBudget.trim() || !Number.isInteger(budget) || budget < 0 || budget > 100000) { setAgentError("Enter a whole-number activation budget from 0 to 100000."); return; }
    liveRequestRef.current = true;
    const epoch = sourceEpochRef.current;
    setLiveBusy(true); setAgentBusy(true); setAgentError(undefined); setAgentDecision(undefined);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch("/api/agent/intervene", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ budget, expectedSnapshotId: liveSnapshotId }), signal: controller.signal });
      const payload = await response.json() as AgentDecision & { error?: string };
      if (epoch !== sourceEpochRef.current) return;
      if (!response.ok) throw new Error(response.status === 409 ? "Snapshot changed while deciding. No stale decision applied. Sync the city and try again." : payload.error ?? `Agent request failed (${response.status}).`);
      applyLiveSnapshot(payload.snapshot);
      setAgentDecision(payload);
    } catch (error) {
      if (epoch === sourceEpochRef.current) setAgentError(error instanceof DOMException && error.name === "AbortError" ? "Request timed out. Execution is unconfirmed; sync the city before retrying." : error instanceof Error ? error.message : "Agent request failed.");
    } finally {
      window.clearTimeout(timer); liveRequestRef.current = false; setLiveBusy(false); setAgentBusy(false);
    }
  }, [agentBudget, dataSource, liveSnapshotId, applyLiveSnapshot]);

  const focusStory = () => {
    const latest = [...world.interactions].reverse().find((item) => world.citizens.some((citizen) => citizen.id === item.citizenId));
    const citizen = latest ? world.citizens.find((item) => item.id === latest.citizenId) : world.citizens.find((item) => !["safe", "protected"].includes(item.state)) ?? world.citizens[0];
    if (citizen) setSelectedId(citizen.id);
    document.querySelector(".detail-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const startDemo = useCallback(() => {
    if (dataSource === "live") {
      setLiveError("DEMO MODE is local-only. Switch to LOCAL DEMO before starting the scripted flow.");
      return;
    }
    setRecoveryAvailable(false);
    setWorld(createDemoWorld(Number.parseInt(seedInput, 10) || 42));
    setComparisonResults([]);
    setDemoStep(0);
    setPresenterMode(false);
    setDemoActive(true);
  }, [dataSource, seedInput]);

  const startPresenter = useCallback(() => {
    if (dataSource === "live") {
      setLiveError("PRESENTER MODE is local-only. Use LIVE API controls for server-backed changes.");
      return;
    }
    setRecoveryAvailable(false);
    setWorld(createDemoWorld(Number.parseInt(seedInput, 10) || 42));
    setComparisonResults([]);
    setDemoStep(0);
    setPresenterMode(true);
    setDemoActive(true);
  }, [dataSource, seedInput]);

  const resumePresenter = useCallback(() => {
    setRecoveryAvailable(false);
    setPresenterMode(true);
    setDemoActive(true);
  }, []);

  const pausePresenter = useCallback(() => {
    setRecoveryAvailable(false);
    setDemoActive(false);
  }, []);

  const recoverSession = useCallback(() => {
    if (dataSource === "live") return;
    try {
      const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { version?: number; savedAt?: number; world?: WorldState; comparisonResults?: ComparisonResult[]; demoStep?: number; presenterMode?: boolean };
      if (saved.version !== 1 || !saved.world || saved.world.version !== 1 || saved.world.citizens?.length !== 100) return;
      setWorld(cloneWorld(saved.world));
      setComparisonResults(Array.isArray(saved.comparisonResults) ? saved.comparisonResults : []);
      setDemoStep(typeof saved.demoStep === "number" ? Math.min(Math.max(saved.demoStep, 0), DEMO_STEPS.length - 1) : 0);
      setDemoActive(false);
      setPresenterMode(Boolean(saved.presenterMode));
      setRecoveryAvailable(false);
      setSelectedId("citizen-001");
    } catch {
      setRecoveryAvailable(false);
    }
  }, [dataSource]);

  const injectAudienceEvent = useCallback(() => {
    const prompt = audiencePrompt.trim();
    if (!prompt) return;
    if (dataSource === "live") {
      setLiveError("Audience event injection is local-only; use a supported LIVE API command.");
      return;
    }
    setRecoveryAvailable(false);
    setWorld((previous) => {
      const next = cloneWorld(previous);
      addDemoEvent(next, `Audience event injected · ${prompt}`, "warning");
      return next;
    });
    setAudiencePrompt("");
  }, [audiencePrompt, dataSource]);

  useEffect(() => {
    if (!demoActive) return undefined;
    const timer = window.setTimeout(() => {
      const currentStep = demoStep;
      if (currentStep === 5) {
        const seed = Number.parseInt(seedInput, 10) || 42;
        const results = (["baseline", ...INTERVENTIONS] as InterventionStrategy[]).map((candidate) => simulateStrategy(seed, candidate, 7));
        setComparisonResults(results);
      }
      setWorld((previous) => {
        const next = cloneWorld(previous);
        if (currentStep === 0) {
          addDemoEvent(next, DEMO_STEPS[0], "info");
        } else if (currentStep === 1) {
          addDemoEvent(next, "5 scammers entered the city · observing target selection.", "danger");
        } else if (currentStep === 2) {
          next.phase = "running";
          advanceWorld(next, 30);
          next.phase = "paused";
        } else if (currentStep === 3) {
          addDemoEvent(next, `Baseline snapshot · ${next.metrics.victims} victims · ${formatMoney(next.metrics.moneyLost)} lost.`, "warning");
        } else if (currentStep === 4) {
          activateDemoIntervention(next, "social-guardian");
          next.phase = "running";
          advanceWorld(next, 34);
          next.phase = "paused";
        } else if (currentStep === 5) {
          addDemoEvent(next, "Before / after comparison generated from the same seed.", "success");
        } else if (currentStep === 6) {
          addDemoEvent(next, DEMO_STEPS[7], "success");
        } else if (currentStep === 7) {
          next.phase = "complete";
        }
        return next;
      });
      if (currentStep >= 7) {
        setDemoActive(false);
      } else {
        setDemoStep(currentStep + 1);
      }
    }, demoStep === 0 ? 1500 : presenterMode ? 25_500 : 8500);
    return () => window.clearTimeout(timer);
  }, [demoActive, demoStep, presenterMode, seedInput]);

  const phaseText = world.phase === "running" ? "LIVE" : world.phase.toUpperCase();

  const connectionLabel = connectionState === "connected" ? "API ONLINE" : connectionState === "checking" ? "API CHECKING" : "OFFLINE / LOCAL";
  const checkLabel = lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  const sourceLabel = dataSource === "live" ? "LIVE API" : "LOCAL DEMO";
  const snapshotLabel = dataSource === "live"
    ? `SNAP ${liveSnapshotId ?? "—"} · CURSOR T${liveCursor?.tick ?? world.tick}`
    : `LOCAL · T${world.tick}`;

  return (
    <main className="scamcity-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark">SC</div><div><div className="brand-name">SCAMCITY</div><div className="brand-subtitle">AI SOCIETY SIMULATION LAB</div></div></div>
        <div className="top-narrative">Test interventions on synthetic societies<br /><span>before deploying them in the real world.</span></div>
        <div className="top-status"><span className="live-dot" /> <b>{phaseText}</b><span className="divider" />DAY {world.day} · {world.time.split("·")[1]?.trim()}<span className={`source-badge ${dataSource}`}><i />{sourceLabel}</span><span className="snapshot-meta">{snapshotLabel}</span><span className={`connection-status compact ${connectionState}`} title={`Last API health check: ${checkLabel}`}><i />{connectionLabel}</span></div>
      </header>

      <div className="hero-strip">
        <div><span className="eyebrow">SCENARIO / TELECOM &amp; ONLINE FRAUD</span><h1>One synthetic city.<br /><em>Infinite intervention paths.</em></h1></div>
        <div className="hero-stat-row"><div><b>100</b><span>AI CITIZENS</span></div><div><b>05</b><span>SCAM AGENTS</span></div><div><b>04</b><span>INTERVENTIONS</span></div><div><b>01</b><span>SYNTHETIC CITY</span></div></div>
      </div>

      <section className="control-strip panel">
        <div className="control-group source-group"><span className="eyebrow">STATE SOURCE</span><div className="source-picker"><button className={dataSource === "local" ? "active" : ""} onClick={switchToLocal} disabled={liveBusy}>LOCAL DEMO</button><button className={dataSource === "live" ? "active" : ""} onClick={() => { void switchToLive(); }} disabled={liveBusy}>{liveBusy && dataSource === "local" ? "CONNECTING…" : "LIVE API"}</button></div></div>
        <div className="control-group"><span className="eyebrow">SIMULATION CONTROL</span><div className="button-row"><button className="control-button ghost" onClick={reset} disabled={liveBusy}>↻ RESET CITY</button><button className="control-button primary" onClick={world.phase === "running" ? pause : start} disabled={liveBusy}>{world.phase === "running" ? "Ⅱ PAUSE" : "▶ START SIMULATION"}</button><button className="control-button ghost" onClick={step} disabled={liveBusy}>STEP</button><button className="control-button ghost" onClick={runSevenDays} disabled={liveBusy}>RUN 7 DAYS</button></div></div>
        <div className="control-group speed-group"><span className="eyebrow">SIMULATION SPEED</span><div className="speed-picker">{([1, 5, 20] as Speed[]).map((value) => <button key={value} className={speed === value ? "active" : ""} onClick={() => setSpeed(value)} disabled={dataSource === "live"}>{value}×</button>)}</div></div>
        <div className="control-group seed-group"><label className="eyebrow" htmlFor="seed">SEED</label><div className="seed-input"><span>#</span><input id="seed" value={seedInput} onChange={(event) => setSeedInput(event.target.value.replace(/\D/g, "").slice(0, 8))} /></div></div>
        <button className={`demo-button ${demoActive && !presenterMode ? "active" : ""}`} onClick={demoActive && !presenterMode ? () => setDemoActive(false) : startDemo} disabled={dataSource === "live"}>{demoActive && !presenterMode ? "■ DEMO RUNNING" : "✦ DEMO MODE"}</button>
        <button className={`presenter-button ${presenterMode ? "active" : ""}`} onClick={presenterMode ? () => setPresenterMode(false) : startPresenter} disabled={dataSource === "live"}>{presenterMode ? "■ PRESENTER OPEN" : "▶ 3-MIN PRESENTER"}</button>
        {recoveryAvailable && dataSource === "local" ? <button className="recover-button control-button" onClick={recoverSession}>↺ RECOVER</button> : null}
      </section>
      {liveError ? <div className="live-error panel" role="status"><span>!</span>{liveError}<button className="mini-toggle" onClick={() => setLiveError(undefined)}>DISMISS</button></div> : null}

      <PresenterConsole
        active={presenterMode}
        step={demoStep}
        demoActive={demoActive}
        connectionState={connectionState}
        recoveryAvailable={recoveryAvailable}
        audiencePrompt={audiencePrompt}
        onAudiencePromptChange={setAudiencePrompt}
        onInjectAudienceEvent={injectAudienceEvent}
        onPause={pausePresenter}
        onResume={resumePresenter}
        onRestart={startPresenter}
        onSkip={runSevenDays}
        onExit={() => { setDemoActive(false); setPresenterMode(false); }}
        onRecover={recoverSession}
      />

      <div className="dashboard-grid">
        <aside className="left-column">
          <section className="panel scenario-panel">
            <SectionTitle eyebrow="01 / SCENARIO" title="Synthetic city" right={<span className="status-chip"><i />{world.phase}</span>} />
            <div className="scenario-line"><span>Citizens</span><b>{world.citizens.length}</b></div>
            <div className="scenario-line"><span>Relationships</span><b>{numberFormatter.format(relationships)}</b></div>
            <div className="scenario-line"><span>Total assets</span><b>{formatMoney(totalAssets)}</b></div>
            <div className="scenario-line"><span>Simulation day</span><b>0{world.day} / 07</b></div>
            <div className="scenario-line"><span>Active scammers</span><b className="danger-text">{world.scammers.filter((scammer) => scammer.active).length}</b></div>
            <div className="scenario-tags"><span>TELECOM</span><span>ONLINE FRAUD</span><span>RESEARCH PROTOTYPE</span></div>
          </section>
          <section className="panel agents-panel">
            <SectionTitle eyebrow="02 / THREAT SURFACE" title="Scam agents" right={<span className="tiny-live"><i />LIVE</span>} />
            <div className="agent-list">{world.scammers.map((scammer) => <div className="agent-row" key={scammer.id}><span className="agent-icon">!</span><div><strong>{scammer.name}</strong><span>{SCAM_STRATEGY_LABELS[scammer.strategy]}</span></div><b>{scammer.messagesSent.toString().padStart(2, "0")}</b></div>)}</div>
          </section>
          <section className={`panel intervention-panel ${showIntervention ? "open" : ""}`}>
            <SectionTitle eyebrow="03 / INTERVENTION LAB" title="Change the conditions" right={<button className="mini-toggle" onClick={() => setShowIntervention((value) => !value)}>{showIntervention ? "CLOSE" : "OPEN"}</button>} />
            {showIntervention ? <><p className="panel-copy">Choose a strategy, activate it, and watch the same social graph respond.</p><select className="strategy-select" value={strategy} onChange={(event) => setStrategy(event.target.value as InterventionStrategy)}>{INTERVENTIONS.map((item) => <option key={item} value={item}>{INTERVENTION_LABELS[item]}</option>)}</select><button className="activate-button" onClick={applyIntervention} disabled={liveBusy}>ACTIVATE {INTERVENTION_LABELS[strategy].toUpperCase()} ↗</button><div className="active-list">{world.activeInterventions.length ? world.activeInterventions.map((item) => <span key={item}>● {INTERVENTION_LABELS[item]}</span>) : <span>● Baseline observation mode</span>}</div></> : <p className="panel-copy">Four intervention strategies are ready. Open the lab to test warning reach, bank friction, guardians and network hubs.</p>}
          </section>
          <section className="panel agent-decision-panel">
            <SectionTitle eyebrow="AGENT / EXECUTED DECISION" title="Observe → choose → activate" />
            <p className="panel-copy">One bounded decision on the current city. Activation budget only; future running costs are excluded. Simulation remains rule-based.</p>
            {dataSource === "live" ? <>
              <label className="panel-copy" htmlFor="agent-budget">Activation budget (simulation units)</label>
              <input id="agent-budget" className="strategy-select" type="number" min="0" max="100000" step="1" value={agentBudget} onChange={(event) => setAgentBudget(event.target.value)} disabled={liveBusy} />
              <button className="activate-button" onClick={() => { void decideIntervention(); }} disabled={liveBusy || !liveSnapshotId}>{agentBusy ? "AGENT IS DECIDING…" : "ASK AGENT TO INTERVENE ↗"}</button>
              {agentError ? <p role="alert" className="panel-copy agent-error">{agentError}</p> : null}
              {agentDecision ? <div className="thought-block" aria-live="polite"><div className="eyebrow">{agentDecision.source === "model" ? "MODEL" : agentDecision.source === "fallback" ? "RULES / MODEL FAILED" : "RULES"} {agentDecision.model ?? ""}</div><p><b>{agentDecision.strategy === "baseline" ? "NO ADDITIONAL INTERVENTION" : `ACTIVATED: ${INTERVENTION_LABELS[agentDecision.strategy]}`}</b></p><p>{agentDecision.reason}</p><small>Activation cost {agentDecision.actualCost} / budget {agentDecision.budget} · T+{agentDecision.beforeTick} → T+{agentDecision.afterTick}. Advance the city to observe future effects.</small></div> : null}
            </> : <p className="panel-copy">Switch to LIVE API to let the Agent execute against the server city.</p>}
          </section>
          <section className="panel thoughts-panel">
            <SectionTitle
              eyebrow="04 / CITIZEN NARRATION"
              title="Why they decided"
              right={<span className={thoughts?.mode === "live" ? "tiny-live" : "tiny-live offline"}><i />{thoughts?.mode === "live" ? "MODEL" : "RULES"}</span>}
            />
            {dataSource === "live" ? (
              <>
                <p className="panel-copy">
                  The deterministic engine decides; a language model explains that decision in the
                  citizen&apos;s own voice. The narration never changes the outcome.
                </p>
                <button className="activate-button" onClick={fetchThoughts} disabled={thoughtsBusy}>
                  {thoughtsBusy ? "NARRATING…" : "NARRATE RECENT DECISIONS ↗"}
                </button>
                {thoughtsError ? <p className="panel-copy danger-text">{thoughtsError}</p> : null}
                {thoughts ? (
                  <div className="thoughts-list">
                    {thoughts.thoughts.length === 0 ? (
                      <p className="panel-copy">No scam interactions yet. Advance the simulation first.</p>
                    ) : thoughts.thoughts.map((item) => (
                      <article className="thought-row" key={`${item.citizenId}-${item.tick}`}>
                        <header>
                          <strong>{item.citizenName}</strong>
                          <span className="thought-meta">
                            {SCAM_STRATEGY_LABELS[item.strategy as keyof typeof SCAM_STRATEGY_LABELS] ?? item.strategy}
                            {" · "}tick {item.tick}
                            {" · "}p={Math.round(item.probability * 100)}%
                          </span>
                        </header>
                        <blockquote>{item.thought}</blockquote>
                        <footer>
                          <span className="thought-decision">ENGINE: {item.engineDecision.toUpperCase()}</span>
                          {item.source === "fallback" ? <span className="thought-fallback">DETERMINISTIC FALLBACK</span> : null}
                        </footer>
                      </article>
                    ))}
                    <p className="thought-provenance">
                      {thoughts.mode === "live" ? thoughts.model : "deterministic"}
                      {" · "}{thoughts.latencyMs}ms
                      {thoughts.note ? ` · ${thoughts.note}` : ""}
                      {" · synthetic citizens, not real people"}
                    </p>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="panel-copy">
                Narration reads the shared API store, so it is only available in live mode. Switch
                the data source to live and the panel will describe the same city shown here.
              </p>
            )}
          </section>
        </aside>

        <section className="center-column">
          <section className="panel map-panel">
            <SectionTitle eyebrow="04 / CITY LAYER" title="Social graph / live state" right={<div className="map-controls"><span className="map-live"><i />LIVE MAP</span><button className="mini-toggle" onClick={focusStory}>FOLLOW A CITIZEN ↗</button></div>} />
            <CityMap world={world} selectedId={selectedId} onSelect={setSelectedId} />
          </section>
          <section className="panel event-panel">
            <SectionTitle eyebrow="05 / OBSERVABILITY" title="Live event stream" right={<span className="event-count">{world.eventFeed.length.toString().padStart(2, "0")} EVENTS</span>} />
            <div className="event-stream" ref={eventsRef}>{recentEvents.map((event) => <div className={eventClass(event)} key={event.id}><span className="event-time">{event.time.split("·")[1]?.trim() ?? event.time}</span><span className="event-bullet">{event.severity === "danger" ? "◆" : event.severity === "success" ? "✓" : event.severity === "warning" ? "⚠" : "·"}</span><span className="event-message">{event.message}</span><span className="event-tick">T{event.tick.toString().padStart(3, "0")}</span></div>)}</div>
          </section>
        </section>

        <aside className="right-column">
          <section className="panel metrics-panel">
            <SectionTitle eyebrow="06 / LIVE METRICS" title="City health" right={<span className="refresh-dot">●</span>} />
            <div className="metric-grid"><MetricCard label="Victims" value={world.metrics.victims.toString().padStart(2, "0")} note="current city / cumulative" tone="red" icon="◆" /><MetricCard label="Money lost" value={formatMoney(world.metrics.moneyLost)} note="cumulative" tone="red" icon="＄" /><MetricCard label="Fraud attempts" value={world.metrics.fraudAttempts} note="scam interactions" tone="amber" icon="↗" /><MetricCard label="Warnings sent" value={world.metrics.warningsSent} note="social reach" tone="cyan" icon="⌁" /><MetricCard label="False positives" value={world.metrics.falsePositives} note="bank friction" tone="violet" icon="◌" /><MetricCard label="Interventions" value={world.metrics.successfulInterventions} note="successful saves" tone="green" icon="✓" /></div>
            <div className="index-grid"><div><div className="index-label"><span>SAFETY INDEX</span><b>{world.metrics.safetyIndex}</b></div><ProgressBar value={world.metrics.safetyIndex} tone="green" /></div><div><div className="index-label"><span>TRUST INDEX</span><b>{world.metrics.trustIndex}</b></div><ProgressBar value={world.metrics.trustIndex} tone="violet" /></div></div>
          </section>
          <section className="panel chart-panel"><LossChart points={world.metrics.lossHistory} /></section>
          <section className="panel funnel-panel"><SectionTitle eyebrow="07 / BEHAVIORAL PIPELINE" title="Fraud funnel" right={<span className="funnel-live">LIVE</span>} /><Funnel world={world} /></section>
          <section className="panel detail-panel"><SectionTitle eyebrow="08 / CITIZEN INSPECTOR" title={selectedCitizen ? selectedCitizen.name : "Select a citizen"} right={<span className="inspector-id">{selectedCitizen?.id ?? "—"}</span>} /><CitizenDetails citizen={selectedCitizen} world={world} onClose={() => setSelectedId("")} /></section>
        </aside>
      </div>

      <ComparisonPanel results={comparisonResults} context={comparisonContext} />
      <section className="action-dock"><div><span className="eyebrow">RESEARCH ACTIONS</span><p>{demoActive ? DEMO_STEPS[Math.min(demoStep, DEMO_STEPS.length - 1)] : "Run the same social graph under different conditions and compare the observed outcomes."}</p></div><div className="dock-actions"><button className="compare-button" onClick={() => compareStrategies("seed")} disabled={isComparing || liveBusy}>{isComparing ? "RUNNING 5 REPLAYS…" : "COMPARE FROM SEED ↗"}</button><button className="compare-button" onClick={() => compareStrategies("snapshot")} disabled={isComparing || liveBusy}>COMPARE CURRENT SNAPSHOT ↗</button><button className="research-button" onClick={() => { setShowIntervention(true); setStrategy("social-guardian"); }}>OPEN INTERVENTION LAB</button></div></section>
      <footer className="footer"><span>SCAMCITY / AI SOCIETY SIMULATION LAB</span><span>SEED {world.seed} · BUILD 0.1 · {dataSource === "live" ? "LIVE API" : "LOCAL DEMO / OFFLINE READY"}</span><span>All citizens, behaviors and outcomes in this demo are synthetic. This simulation is a research prototype and does not predict real individuals.</span></footer>
    </main>
  );
}
