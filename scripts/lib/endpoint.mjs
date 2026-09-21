/**
 * Shared endpoint resolution for the Node-side tooling.
 *
 * The Minecraft bridge has its own copy of this logic in
 * minecraft-bridge/.../ApiEndpoints.java, because it cannot import JavaScript.
 * The two are kept in agreement by DISCOVERY_FILE and SCHEMA_VERSION below,
 * which verify-simulation-contract.mjs asserts against the Java source.
 *
 * Background: port 3000 is regularly taken over by Minecraft's own "Open to
 * LAN" server, which pushes Next.js onto a random high port. Anything that
 * hardcodes 3000 then reports a failure that has nothing to do with the real
 * state of the service — that is exactly how `doctor` came to print FAIL while
 * the server was running perfectly well on 51662.
 */
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Must match ApiEndpoints.DISCOVERY_FILE. */
export const DISCOVERY_FILE = join(tmpdir(), "scamcity-endpoint.json");
/** Must match ApiEndpoints.SCHEMA_VERSION and SIMULATION_API_SCHEMA. */
export const SCHEMA_VERSION = "scamcity.simulation/v1";
/** Must match ApiEndpoints.DEFAULT_URL. */
export const DEFAULT_URL = "http://localhost:3000/api/simulation";
const API_PATH = "/api/simulation";

/**
 * Plaintext HTTP to this machine only.
 *
 * The discovery file sits in a shared temp directory, so it is untrusted input:
 * a hostile file must not be able to point the tooling at a remote host.
 */
export function isLoopbackHttp(url) {
  if (typeof url !== "string" || !url.startsWith("http://")) return false;
  const rest = url.slice("http://".length);
  const authority = rest.split("/", 1)[0];
  if (authority.includes("@")) return false;
  const colon = authority.lastIndexOf(":");
  let host = authority;
  if (colon >= 0) {
    const digits = authority.slice(colon + 1);
    if (!/^\d+$/.test(digits)) return false;
    host = authority.slice(0, colon);
  }
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/** Canonicalise a URL, completing a bare origin with the API path. */
export function normalise(url) {
  if (typeof url !== "string") return "";
  let trimmed = url.trim();
  if (!isLoopbackHttp(trimmed)) return "";
  while (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
  return trimmed.indexOf("/", "http://".length) < 0 ? trimmed + API_PATH : trimmed;
}

/** Read the endpoint published by scripts/scamcity-serve.mjs, if any. */
export function readDiscovered(path = DISCOVERY_FILE) {
  try {
    return normalise(JSON.parse(readFileSync(path, "utf8"))?.url);
  } catch {
    // Absent or corrupt is the normal case under plain `next dev`.
    return "";
  }
}

/**
 * Endpoints to try, in order.
 *
 * An explicit setting is returned alone: the operator named a port, so quietly
 * succeeding against a different one would hide their mistake.
 */
export function candidates(explicit = process.env.SCAMCITY_API, path = DISCOVERY_FILE) {
  const configured = normalise(explicit);
  if (configured) return [configured];
  const discovered = readDiscovered(path);
  return discovered ? [discovered, DEFAULT_URL] : [DEFAULT_URL];
}

/**
 * Whether a payload really came from ScamCity.
 *
 * Reaching a listener proves a port is open, not that the right service is
 * behind it.
 */
export function looksLikeSnapshot(payload) {
  return payload?.schemaVersion === SCHEMA_VERSION;
}

/**
 * Fetch a snapshot, walking the candidate list.
 *
 * Returns the endpoint that answered alongside the payload so callers can
 * report which port was actually used rather than which one they assumed.
 */
export async function fetchSnapshot({ explicit, timeoutMs = 4000 } = {}) {
  const attempts = candidates(explicit);
  const errors = [];
  for (const endpoint of attempts) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        errors.push(`${endpoint}: HTTP ${response.status}`);
        continue;
      }
      const payload = await response.json();
      if (!looksLikeSnapshot(payload)) {
        errors.push(`${endpoint}: not ScamCity (missing schemaVersion=${SCHEMA_VERSION})`);
        continue;
      }
      return { endpoint, payload, attempts };
    } catch (error) {
      errors.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { endpoint: null, payload: null, attempts, errors };
}
