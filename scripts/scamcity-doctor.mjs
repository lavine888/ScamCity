import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fetchSnapshot } from "./lib/endpoint.mjs";

const gameDir = process.env.MINECRAFT_GAME_DIR ?? "D:\\Minecraft";
const bridgePath = resolve(gameDir, "mods", "scamcity-bridge-0.1.0.jar");
const logPath = resolve(gameDir, "logs", "latest.log");
const jsonOutput = process.argv.includes("--json");

const checks = [];
const add = (name, status, detail) => checks.push({ name, status, detail });

// The endpoint is resolved rather than assumed: hardcoding port 3000 made this
// check report FAIL while the server was running fine on another port, because
// Minecraft's "Open to LAN" had taken 3000 and Next.js had moved itself.
const { endpoint: apiUrl, payload, attempts, errors } = await fetchSnapshot();
if (!payload) {
  add("api", "fail", `no ScamCity API on ${attempts.join(", ")} — ${(errors ?? []).join("; ")}`);
} else {
  const world = payload?.world;
  const citizens = world?.citizens?.length ?? 0;
  const scammers = world?.scammers?.length ?? 0;
  const sequence = world?.eventSequence;
  if (citizens === 100 && scammers === 5 && Number.isInteger(sequence)) {
    add("api", "pass", `${apiUrl} · 100 citizens · 5 scammers · eventSequence ${sequence}`);
  } else {
    add("api", "fail", `unexpected snapshot from ${apiUrl}: citizens=${citizens}, scammers=${scammers}, eventSequence=${sequence}`);
  }
}

if (existsSync(bridgePath)) {
  const hash = createHash("sha256").update(readFileSync(bridgePath)).digest("hex").toUpperCase();
  add("bridge-jar", "pass", `${bridgePath} · ${Math.round(statSync(bridgePath).size / 1024)} KiB · ${hash.slice(0, 16)}…`);
} else {
  add("bridge-jar", "fail", `missing ${bridgePath}`);
}

if (existsSync(logPath)) {
  const log = readFileSync(logPath, "utf8");
  const tail = log.slice(-120_000);
  const loadMatches = [...tail.matchAll(/ScamCity bridge loaded|scamcity_bridge/gi)];
  const loaded = loadMatches.length > 0;
  // A Minecraft log can survive a mod replacement. Count parser errors from
  // the latest bridge load onward so an old failed jar does not poison a new
  // readiness check. When the bridge has not loaded yet, keep the warning
  // visible and report the historical count as context.
  const lastLoad = loadMatches.at(-1);
  const activeLog = lastLoad?.index === undefined ? tail : tail.slice(lastLoad.index);
  const commandErrors = (activeLog.match(/Unknown or incomplete command/g) ?? []).length;
  // The launch banner is printed once at the very top of the log, so it must be
  // matched against the whole file. Searching only the tail made this report
  // "profile line not found" on any log past ~120 KB while still reporting pass,
  // because the load marker was inside the window and the banner was not.
  const version = log.match(/Loading Minecraft ([^\s]+) with Fabric Loader ([^\s]+)/i);
  // Status tracks both facts it claims: the profile banner and the bridge load.
  add("minecraft-log", loaded && version ? "pass" : "warn", [
    version ? `Minecraft ${version[1]} · Fabric ${version[2]}` : "profile line not found",
    loaded ? "bridge loaded" : "bridge not loaded in this log",
  ].join(" · "));
  add("command-errors", commandErrors === 0 ? "pass" : "warn", commandErrors === 0
    ? (loaded ? "no parser errors since latest bridge load" : "no parser errors observed; launch the target profile")
    : (loaded
      ? `${commandErrors} parser errors since latest bridge load; restart after installing the fixed JAR`
      : `${commandErrors} historical parser errors; launch the target profile to create a fresh log`));
} else {
  add("minecraft-log", "warn", `no log at ${logPath}; launch the Fabric profile once`);
}

const result = {
  ok: checks.every((check) => check.status !== "fail"),
  // Null when nothing answered, so a report can never imply an endpoint was
  // reached when it was not.
  apiUrl: apiUrl ?? null,
  apiCandidates: attempts,
  gameDir,
  checks,
};

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log("SCAMCITY DOCTOR");
  for (const check of checks) console.log(`${check.status.toUpperCase().padEnd(5)} ${check.name}: ${check.detail}`);
  console.log(result.ok ? "READY: core bridge prerequisites are present." : "BLOCKED: fix the failed checks before the live demo.");
}

process.exitCode = result.ok ? 0 : 1;
