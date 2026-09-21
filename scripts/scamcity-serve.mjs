#!/usr/bin/env node
/**
 * Start the ScamCity web server and publish the port it actually bound to.
 *
 * Why this exists: the Minecraft bridge used to hardcode
 * http://localhost:3000/api/simulation. On 2026-09-20 Minecraft's own
 * "Open to LAN" server took port 3000, so the bridge connected to Minecraft
 * and reported "HTTP/1.1 header parser received no bytes" — the same message
 * as an unrelated HTTP/2 bug from the previous day, which cost real debugging
 * time. Next.js meanwhile had moved itself to a random high port (51662).
 *
 * Guessing that port is not possible, and the Minecraft launcher GUI does not
 * inherit shell environment variables, so SCAMCITY_API could not solve it
 * either. Both processes do share a filesystem, so the server writes where it
 * ended up and the bridge reads it. See ApiEndpoints.java for the read side,
 * which re-validates everything here.
 *
 * The file is advisory. The bridge still falls back to the default port and
 * still verifies the response carries schemaVersion before trusting it, so a
 * stale or absent file degrades rather than breaks.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argv, env, execPath, exit } from "node:process";

/** Must match ApiEndpoints.DISCOVERY_FILE. */
const DISCOVERY_FILE = join(tmpdir(), "scamcity-endpoint.json");
/** Must match SIMULATION_API_SCHEMA in lib/simulation-api.ts. */
const SCHEMA_VERSION = "scamcity.simulation/v1";
const DEFAULT_PORT = 3000;
/** Bridge timeout is 5s per attempt; give the dev server longer than that. */
const READY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 400;

const mode = argv[2] === "start" ? "start" : "dev";

/**
 * Find a free port, preferring the conventional one.
 *
 * Binding to 127.0.0.1 specifically: a port can be free on loopback while
 * taken on another interface, and loopback is the only one that matters here.
 */
async function pickPort(preferred) {
  for (const candidate of [preferred, 0]) {
    const port = await tryBind(candidate);
    if (port !== null) return port;
  }
  throw new Error("no free loopback port available");
}

function tryBind(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(null));
    probe.listen({ port, host: "127.0.0.1" }, () => {
      const bound = probe.address().port;
      probe.close(() => resolve(bound));
    });
  });
}

/**
 * Wait until the API answers with a real ScamCity snapshot.
 *
 * Checking the schema rather than just a 200 keeps this honest: the whole
 * point of the exercise is that "something answered on this port" was the
 * misleading signal in the first place.
 */
async function waitForApi(origin) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/simulation`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const body = await response.json();
        if (body?.schemaVersion === SCHEMA_VERSION) return true;
        console.warn(`[serve] ${origin} answered but is not ScamCity; still waiting`);
      }
    } catch {
      // Server not up yet. Retrying is the expected path, not an error.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}

/**
 * Publish the endpoint atomically.
 *
 * Written to a temp file and renamed so the bridge can never read a
 * half-written document; it polls this file without any locking.
 */
function publish(origin, port) {
  const payload = {
    url: `${origin}/api/simulation`,
    origin,
    port,
    schemaVersion: SCHEMA_VERSION,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  };
  const staging = mkdtempSync(join(tmpdir(), "scamcity-endpoint-"));
  const temp = join(staging, "endpoint.json");
  writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  try {
    // rename(2) is atomic within a filesystem; both paths are under tmpdir.
    renameSync(temp, DISCOVERY_FILE);
  } catch {
    // Cross-device or a platform that refuses to clobber: a direct write is
    // still better than no endpoint file at all.
    writeFileSync(DISCOVERY_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function cleanup() {
  try {
    rmSync(DISCOVERY_FILE, { force: true });
  } catch {
    // Best effort: a stale file is rejected by the bridge's schema check.
  }
}

const port = await pickPort(Number(env.PORT ?? DEFAULT_PORT));
const origin = `http://localhost:${port}`;
if (port !== DEFAULT_PORT) {
  console.log(`[serve] port ${DEFAULT_PORT} unavailable, using ${port}`);
}

// Next's own entry script is resolved and run with this same Node binary, so
// there is no shell in the chain: `shell: true` would concatenate arguments
// into a command string unescaped, which is a command-injection path for any
// value reaching argv. Resolving the module also avoids depending on npx and
// on Windows .cmd shims.
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(
  execPath,
  [nextBin, mode, "--port", String(port), "--hostname", "127.0.0.1"],
  { stdio: "inherit", env: { ...env, PORT: String(port) } },
);

let published = false;
const ready = await waitForApi(origin);
if (ready) {
  publish(origin, port);
  published = true;
  console.log(`[serve] ScamCity API ready at ${origin}/api/simulation`);
  console.log(`[serve] endpoint published to ${DISCOVERY_FILE}`);
  console.log("[serve] the Minecraft bridge will pick this up automatically");
} else {
  console.error(`[serve] API did not become ready at ${origin} within ${READY_TIMEOUT_MS}ms`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanup();
    child.kill(signal);
    exit(0);
  });
}

child.on("exit", (code) => {
  if (published) cleanup();
  exit(code ?? 0);
});
