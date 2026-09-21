#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatBridgeLog,
  resultForWorld,
  toBridgeSnapshot,
  unwrapWorld,
  validateBridgeSnapshot,
} from "./lib/bridge.mjs";
import { candidates } from "../scripts/lib/endpoint.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  return `SCAMCITY ↔ Minecraft bridge harness

Usage:
  node bridge-harness/cli.mjs --fixture bridge-harness/fixtures/offline-snapshot.json
  node bridge-harness/cli.mjs --url http://localhost:3000/api/simulation --out bridge-harness/out/latest.json

Options:
  --fixture <file>       Read an API-shaped snapshot from disk (offline mode).
  --url <url>            GET a live ScamCity snapshot. Default: the endpoint published
                         by \`npm run serve\`, else http://localhost:3000/api/simulation
  --previous <file>      Compare against a previous bridge result or API snapshot.
  --out <file>           Write the complete JSON result to this path.
  --json                 Print the complete JSON result instead of the readable log.
  --origin <x,y,z>       Minecraft map anchor (default: 0,64,0).
  --size <width,depth>   Minecraft map dimensions (default: 128,128).
  --help                 Show this help.
`;
}

function parseArgs(argv) {
  // Default resolved rather than hardcoded: port 3000 is regularly taken over
  // by Minecraft's own "Open to LAN" server, which pushes Next.js to a random
  // high port. An explicit --url still wins.
  const args = { url: candidates()[0] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--json") args.json = true;
    else if (token === "--fixture") args.fixture = argv[++index];
    else if (token === "--url") args.url = argv[++index];
    else if (token === "--previous") args.previous = argv[++index];
    else if (token === "--out") args.out = argv[++index];
    else if (token === "--origin") args.origin = argv[++index];
    else if (token === "--size") args.size = argv[++index];
    else throw new Error(`Unknown option: ${token}`);
  }
  return args;
}

function parseTuple(value, expected, label) {
  if (!value) return null;
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== expected || parts.some((part) => !Number.isFinite(part))) throw new Error(`${label} must be comma-separated numbers`);
  return parts;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  return response.json();
}

function previousBridgeSnapshot(payload, options) {
  if (payload?.snapshot?.schemaVersion) return payload.snapshot;
  if (payload?.schemaVersion && payload?.citizens && payload?.scammers) return payload;
  return toBridgeSnapshot(unwrapWorld(payload), options);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const origin = parseTuple(args.origin, 3, "--origin");
  const size = parseTuple(args.size, 2, "--size");
  const options = {
    map: {
      ...(origin ? { origin: { x: origin[0], y: origin[1], z: origin[2] } } : {}),
      ...(size ? { width: size[0], depth: size[1] } : {}),
    },
  };

  const sourcePayload = args.fixture ? await readJson(path.resolve(args.fixture)) : await fetchJson(args.url);
  const world = unwrapWorld(sourcePayload);
  let previous = null;
  if (args.previous) previous = previousBridgeSnapshot(await readJson(path.resolve(args.previous)), options);
  const result = resultForWorld(world, options, previous);
  validateBridgeSnapshot(result.snapshot);

  const output = {
    schemaVersion: result.snapshot.schemaVersion,
    source: args.fixture ? { kind: "fixture", path: path.resolve(args.fixture) } : { kind: "http", url: args.url },
    snapshot: result.snapshot,
    delta: result.delta,
    commandPlan: result.commandPlan,
  };

  if (args.out) {
    const outputPath = path.resolve(args.out);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.error(`wrote ${outputPath}`);
  }
  if (args.json) console.log(JSON.stringify(output, null, 2));
  else console.log(formatBridgeLog(result));
}

main().catch((error) => {
  console.error(`bridge-harness error: ${error instanceof Error ? error.message : String(error)}`);
  console.error("Use --help for usage.");
  process.exitCode = 1;
});
