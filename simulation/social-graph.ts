import type { Citizen, RelationshipType, SocialEdge, SocialGraph } from "@/types";
import { clamp, round, SeededRandom } from "@/simulation/seeded-random";

function edgeType(random: SeededRandom): RelationshipType {
  return random.weighted(
    ["family", "friend", "coworker", "neighbor"] as const,
    [0.16, 0.42, 0.2, 0.22],
  );
}

function addEdge(
  citizens: Citizen[],
  edges: SocialEdge[],
  adjacency: Record<string, string[]>,
  sourceIndex: number,
  targetIndex: number,
  random: SeededRandom,
): boolean {
  const source = citizens[sourceIndex];
  const target = citizens[targetIndex];
  if (!source || !target || source.id === target.id) return false;
  if (source.connections.includes(target.id) || target.connections.includes(source.id)) return false;
  if (source.connections.length >= 8 || target.connections.length >= 8) return false;

  const type = edgeType(random);
  const edge: SocialEdge = {
    id: `edge-${source.id}-${target.id}`,
    source: source.id,
    target: target.id,
    type,
    strength: round(random.int(48, 98)),
    trust: round(
      clamp(
        type === "family"
          ? (source.familyTrust + target.familyTrust) / 2
          : type === "friend"
            ? random.int(45, 90)
            : random.int(25, 78),
      ),
    ),
  };
  edges.push(edge);
  source.connections.push(target.id);
  target.connections.push(source.id);
  adjacency[source.id].push(target.id);
  adjacency[target.id].push(source.id);
  return true;
}

export function createSocialGraph(citizens: Citizen[], random: SeededRandom): SocialGraph {
  const nodes = citizens.map((citizen) => citizen.id);
  const adjacency: Record<string, string[]> = Object.fromEntries(nodes.map((id) => [id, []]));
  const edges: SocialEdge[] = [];
  citizens.forEach((citizen) => {
    citizen.connections = [];
    citizen.isHub = false;
  });

  // A ring guarantees that every synthetic citizen has at least two contacts.
  for (let index = 0; index < citizens.length; index += 1) {
    addEdge(citizens, edges, adjacency, index, (index + 1) % citizens.length, random);
  }

  const targetDegrees = citizens.map(() => random.int(2, 8));
  let candidates = random.shuffle(
    Array.from({ length: citizens.length }, (_, source) => source).flatMap((source) =>
      Array.from({ length: citizens.length - source - 1 }, (_, offset) => ({
        source,
        target: source + offset + 1,
      })),
    ),
  );
  let changed = true;
  while (changed && candidates.length > 0) {
    changed = false;
    const remaining: typeof candidates = [];
    for (const pair of candidates) {
      const source = citizens[pair.source];
      const target = citizens[pair.target];
      const sourceNeeds = source.connections.length < targetDegrees[pair.source];
      const targetNeeds = target.connections.length < targetDegrees[pair.target];
      if ((sourceNeeds || targetNeeds) && addEdge(citizens, edges, adjacency, pair.source, pair.target, random)) {
        changed = true;
      } else if (source.connections.length < 8 && target.connections.length < 8) {
        remaining.push(pair);
      }
    }
    candidates = remaining;
  }

  const centrality: Record<string, number> = {};
  for (const citizen of citizens) {
    centrality[citizen.id] = round(
      clamp((citizen.connections.length / 8) * 70 + citizen.socialInfluence * 0.3, 0, 100),
    );
  }
  const hubs = [...citizens]
    .sort((left, right) => centrality[right.id] - centrality[left.id] || right.socialInfluence - left.socialInfluence)
    .slice(0, 5)
    .map((citizen) => citizen.id);
  for (const citizen of citizens) citizen.isHub = hubs.includes(citizen.id);

  return { nodes, edges, adjacency, centrality, hubs };
}

export function getNeighbors(graph: SocialGraph, citizenId: string): string[] {
  return graph.adjacency[citizenId] ? [...graph.adjacency[citizenId]] : [];
}

export function getEdgesForCitizen(graph: SocialGraph, citizenId: string): SocialEdge[] {
  return graph.edges.filter((edge) => edge.source === citizenId || edge.target === citizenId);
}

export function findFamilyGuardian(
  citizens: Citizen[],
  graph: SocialGraph,
  targetId: string,
): Citizen | undefined {
  const target = citizens.find((citizen) => citizen.id === targetId);
  if (!target) return undefined;
  const neighbors = getNeighbors(graph, targetId)
    .map((id) => citizens.find((citizen) => citizen.id === id))
    .filter((citizen): citizen is Citizen => Boolean(citizen));
  const familyEdges = getEdgesForCitizen(graph, targetId).filter((edge) => edge.type === "family");
  const familyIds = new Set(familyEdges.map((edge) => (edge.source === targetId ? edge.target : edge.source)));
  return (
    neighbors
      .filter((citizen) => familyIds.has(citizen.id))
      .sort((left, right) => right.familyTrust - left.familyTrust)[0] ??
    neighbors.sort((left, right) => right.familyTrust - left.familyTrust)[0]
  );
}

export function influenceReach(graph: SocialGraph, sourceIds: string[], hops = 2): Set<string> {
  const reached = new Set(sourceIds);
  let frontier = [...sourceIds];
  for (let level = 0; level < hops; level += 1) {
    const next: string[] = [];
    for (const source of frontier) {
      for (const target of graph.adjacency[source] ?? []) {
        if (!reached.has(target)) {
          reached.add(target);
          next.push(target);
        }
      }
    }
    frontier = next;
  }
  return reached;
}

export function propagateWarning(
  citizens: Citizen[],
  graph: SocialGraph,
  sourceIds: string[],
  amount = 10,
  hops = 1,
): string[] {
  const citizenMap = new Map(citizens.map((citizen) => [citizen.id, citizen]));
  const reached = influenceReach(graph, sourceIds, hops);
  for (const id of reached) {
    const citizen = citizenMap.get(id);
    if (!citizen) continue;
    citizen.warningsReceived += 1;
    citizen.riskAwareness = clamp(citizen.riskAwareness + amount * (sourceIds.includes(id) ? 1 : 0.5));
    citizen.warningFatigue = clamp(citizen.warningFatigue + (sourceIds.includes(id) ? 0.5 : 0.2));
  }
  return [...reached];
}

