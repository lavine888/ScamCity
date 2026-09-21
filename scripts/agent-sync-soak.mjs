#!/usr/bin/env node

/**
 * Multi-process soak test for the AGENT-STATE coordination protocol.
 *
 * The smoke test walks one happy path from one process. This harness instead
 * starts many real OS processes that race on the same tasks, keeps a lease
 * renewing for a sustained window, and then audits the on-disk journal for the
 * invariants SCHEMA.md promises. It writes to an isolated scratch root, so a
 * soak run never leaves tasks in the shared queue.
 *
 *   node scripts/agent-sync-soak.mjs [--agents 16] [--seconds 8] [--workers 3] [--keep]
 */

import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("./agent-sync.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
}

const AGENTS = Math.max(2, Number(flag("agents", 16)) || 16);
const SECONDS = Math.max(1, Number(flag("seconds", 8)) || 8);
const WORKERS = Math.max(1, Number(flag("workers", 3)) || 3);
const KEEP = argv.includes("--keep");
const INTERVAL_MS = 250;

const ROOT = flag("root", null) ?? (await mkdtemp(join(tmpdir(), "agent-sync-soak-")));
const CHILD_ENV = { ...process.env, AGENT_SYNC_COORD_ROOT: ROOT };

/** Invoke the real CLI in a real child process. */
async function call(args) {
  try {
    const { stdout } = await run(process.execPath, [CLI, ...args, "--json"], {
      cwd: REPO_ROOT,
      env: CHILD_ENV,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, data: JSON.parse(stdout) };
  } catch (error) {
    const stderr = String(error.stderr ?? "");
    const match = stderr.match(/^([A-Z_]{3,}):/m);
    return { ok: false, code: match ? match[1] : "UNCLASSIFIED", stderr: stderr.trim().slice(0, 200) };
  }
}

const checks = [];
function check(name, passed, detail = "") {
  checks.push({ name, passed: Boolean(passed), detail: passed ? "" : detail });
  const mark = passed ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${name}${passed || !detail ? "" : ` -- ${detail}`}`);
  return Boolean(passed);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const receiptFile = (operationId) => join(ROOT, "receipts", `${createHash("sha256").update(operationId).digest("hex").slice(0, 40)}.json`);

async function readAll(directory) {
  const names = (await readdir(join(ROOT, directory)).catch(() => [])).filter((name) => name.endsWith(".json"));
  const items = [];
  for (const name of names) {
    const raw = await readFile(join(ROOT, directory, name), "utf8");
    items.push({ name, value: JSON.parse(raw) });
  }
  return items;
}

console.log(`agent-sync soak · agents=${AGENTS} workers=${WORKERS} seconds=${SECONDS}`);
console.log(`isolated root: ${ROOT}\n`);

// ---------------------------------------------------------------- init race
console.log("phase 1: concurrent bootstrap");
{
  const results = await Promise.all(Array.from({ length: AGENTS }, () => call(["init"])));
  check("every concurrent init succeeds", results.every((item) => item.ok), results.find((item) => !item.ok)?.stderr);
  const manifest = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8"));
  check("bootstrap manifest is well formed", manifest.schemaVersion === "scamcity.agent-sync/v1", JSON.stringify(manifest));
}

// -------------------------------------------------------------- enqueue race
console.log("\nphase 2: enqueue race (same taskId, distinct operations)");
const raceTask = `soak-race-${randomUUID()}`;
{
  const results = await Promise.all(
    Array.from({ length: AGENTS }, (_, index) =>
      call(["enqueue", "--task-id", raceTask, "--title", "soak enqueue race", "--operation-id", `soak-enq-${raceTask}-${index}`]),
    ),
  );
  const winners = results.filter((item) => item.ok);
  const dupes = results.filter((item) => !item.ok && item.code === "TASK_EXISTS");
  check("exactly one enqueue wins", winners.length === 1, `winners=${winners.length}`);
  check("all losers report TASK_EXISTS", dupes.length === AGENTS - 1, `dupes=${dupes.length} codes=${results.filter((i) => !i.ok).map((i) => i.code).join(",")}`);
}

// --------------------------------------------------------------- claim race
console.log("\nphase 3: claim race (same task, distinct agents)");
const raceTask2 = `soak-claim-${randomUUID()}`;
await call(["enqueue", "--task-id", raceTask2, "--title", "soak claim race", "--operation-id", `soak-enq2-${raceTask2}`]);
let lease;
{
  const results = await Promise.all(
    Array.from({ length: AGENTS }, (_, index) =>
      call(["claim", "--task-id", raceTask2, "--agent", `soak-agent-${index}`, "--lease-seconds", "120", "--operation-id", `soak-claim-${raceTask2}-${index}`]),
    ),
  );
  const winners = results.filter((item) => item.ok);
  const conflicts = results.filter((item) => !item.ok && item.code === "LEASE_CONFLICT");
  check("exactly one claim wins", winners.length === 1, `winners=${winners.length}`);
  check("all losers report LEASE_CONFLICT", conflicts.length === AGENTS - 1, `conflicts=${conflicts.length} codes=${results.filter((i) => !i.ok).map((i) => i.code).join(",")}`);
  lease = winners[0]?.data;
  check("winner received a full lease triple", Boolean(lease?.ownerId && lease?.leaseId && lease?.generation === 1), JSON.stringify(lease));
}

// ------------------------------------------------------- sustained heartbeat
console.log(`\nphase 4: sustained heartbeat soak (${WORKERS} processes for ${SECONDS}s)`);
{
  const deadline = Date.now() + SECONDS * 1000;
  let renewals = 0;
  const errors = [];
  const expiresAt = new Set();
  async function worker() {
    while (Date.now() < deadline) {
      const result = await call([
        "heartbeat", "--task-id", raceTask2, "--agent", lease.ownerId,
        "--lease-id", lease.leaseId, "--generation", String(lease.generation),
        "--lease-seconds", "120", "--operation-id", `soak-hb-${randomUUID()}`,
      ]);
      if (result.ok) {
        renewals += 1;
        expiresAt.add(result.data.expiresAt);
      } else {
        errors.push(result.code);
      }
      await sleep(INTERVAL_MS);
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker));
  check("no heartbeat failed during the soak", errors.length === 0, `errors=${errors.slice(0, 5).join(",")}`);
  check("heartbeats actually renewed the lease", renewals > 0, `renewals=${renewals}`);
  check("lease expiry advanced across renewals", expiresAt.size > 1, `distinct=${expiresAt.size}`);
  console.log(`  renewals=${renewals} distinct-expiries=${expiresAt.size}`);
}

// -------------------------------------------------------------- stale fencing
console.log("\nphase 5: lease fencing rejects stale writers");
{
  const wrongLease = await call(["heartbeat", "--task-id", raceTask2, "--agent", lease.ownerId, "--lease-id", randomUUID(), "--generation", String(lease.generation)]);
  check("unknown leaseId rejected as STALE_LEASE", !wrongLease.ok && wrongLease.code === "STALE_LEASE", wrongLease.code);

  const wrongGeneration = await call(["heartbeat", "--task-id", raceTask2, "--agent", lease.ownerId, "--lease-id", lease.leaseId, "--generation", String(lease.generation + 7)]);
  check("wrong generation rejected as STALE_LEASE", !wrongGeneration.ok && wrongGeneration.code === "STALE_LEASE", wrongGeneration.code);

  const wrongAgent = await call(["heartbeat", "--task-id", raceTask2, "--agent", "soak-impostor", "--lease-id", lease.leaseId, "--generation", String(lease.generation)]);
  check("wrong owner rejected as STALE_LEASE", !wrongAgent.ok && wrongAgent.code === "STALE_LEASE", wrongAgent.code);

  const thief = await call(["claim", "--task-id", raceTask2, "--agent", "soak-thief", "--lease-seconds", "120", "--operation-id", `soak-thief-${raceTask2}`]);
  check("live lease blocks a competing claim", !thief.ok && thief.code === "LEASE_CONFLICT", thief.code);
}

// ------------------------------------------------------------------ handoff
console.log("\nphase 6: handoff bumps generation and fences the old owner");
let handed;
{
  const result = await call([
    "handoff", "--task-id", raceTask2, "--agent", lease.ownerId, "--to-agent", "soak-agent-next",
    "--lease-id", lease.leaseId, "--generation", String(lease.generation), "--note", "soak handoff", "--operation-id", `soak-handoff-${raceTask2}`,
  ]);
  check("handoff succeeds", result.ok, result.code);
  handed = result.data;
  check("handoff increments generation", handed?.generation === lease.generation + 1, `gen=${handed?.generation}`);
  check("handoff issues a new leaseId", handed?.leaseId !== lease.leaseId);

  const staleOwner = await call(["heartbeat", "--task-id", raceTask2, "--agent", lease.ownerId, "--lease-id", lease.leaseId, "--generation", String(lease.generation)]);
  check("previous owner is fenced after handoff", !staleOwner.ok && staleOwner.code === "STALE_LEASE", staleOwner.code);

  const staleComplete = await call(["complete", "--task-id", raceTask2, "--agent", lease.ownerId, "--lease-id", lease.leaseId, "--generation", String(lease.generation)]);
  check("previous owner cannot complete after handoff", !staleComplete.ok && staleComplete.code === "STALE_LEASE", staleComplete.code);
}

// ------------------------------------------------- idempotency under pressure
console.log("\nphase 7: idempotent replay under concurrent load");
const replayOp = `soak-idem-${randomUUID()}`;
{
  const args = ["heartbeat", "--task-id", raceTask2, "--agent", handed.ownerId, "--lease-id", handed.leaseId, "--generation", String(handed.generation), "--operation-id", replayOp];
  const results = await Promise.all(Array.from({ length: WORKERS * 3 }, () => call(args)));
  check("every concurrent replay succeeds", results.every((item) => item.ok), results.find((item) => !item.ok)?.code);
  const settled = results.filter((item) => item.ok);
  const core = settled.map((item) => {
    const { idempotent, recovered, ...rest } = item.data;
    return JSON.stringify(rest);
  });
  check("concurrent replays agree on the operation result", new Set(core).size === 1, `distinct=${new Set(core).size}`);
  const committed = settled.filter((item) => item.data.idempotent === false).length;
  const replayed = settled.filter((item) => item.data.idempotent === true).length;
  check("exactly one caller committed the operation", committed === 1, `committed=${committed}`);
  check("every other caller is marked as a replay", replayed === settled.length - 1, `replayed=${replayed} settled=${settled.length}`);

  const events = await readAll("events");
  const matching = events.filter((item) => item.value.operationId === replayOp);
  check("replay appended exactly one event", matching.length === 1, `events=${matching.length}`);

  const conflicting = await call([...args, "--lease-seconds", "99"]);
  check("same operationId + different payload is rejected", !conflicting.ok && conflicting.code === "IDEMPOTENCY_CONFLICT", conflicting.code);
}

// ----------------------------------------------------------- crash recovery
console.log("\nphase 8: receipt loss recovers from the journal");
{
  await rm(receiptFile(replayOp));
  const replay = await call(["heartbeat", "--task-id", raceTask2, "--agent", handed.ownerId, "--lease-id", handed.leaseId, "--generation", String(handed.generation), "--operation-id", replayOp]);
  check("replay after receipt loss succeeds", replay.ok, replay.code);
  check("recovered result is flagged", replay.data?.recovered === true, JSON.stringify(replay.data));
  const events = await readAll("events");
  check("recovery did not append a duplicate event", events.filter((item) => item.value.operationId === replayOp).length === 1);
}

// ----------------------------------------------------------------- terminal
console.log("\nphase 9: terminal state closes the task");
{
  const done = await call(["complete", "--task-id", raceTask2, "--agent", handed.ownerId, "--lease-id", handed.leaseId, "--generation", String(handed.generation), "--note", "soak done", "--operation-id", `soak-done-${raceTask2}`]);
  check("complete succeeds", done.ok, done.code);

  const late = await call(["claim", "--task-id", raceTask2, "--agent", "soak-agent-late", "--lease-seconds", "60", "--operation-id", `soak-late-${raceTask2}`]);
  check("completed task cannot be re-claimed", !late.ok && late.code === "TASK_TERMINAL", late.code);

  const reDone = await call(["complete", "--task-id", raceTask2, "--agent", handed.ownerId, "--lease-id", handed.leaseId, "--generation", String(handed.generation), "--operation-id", `soak-redone-${raceTask2}`]);
  check("completed task has no lease left to write", !reDone.ok && reDone.code === "LEASE_CONFLICT", reDone.code);
}

// -------------------------------------------------------- expiry and reaping
console.log("\nphase 10: expiry lands in needs-reconcile, reap records it");
const expireTask = `soak-expire-${randomUUID()}`;
{
  await call(["enqueue", "--task-id", expireTask, "--title", "soak expiry", "--operation-id", `soak-enq3-${expireTask}`]);
  await call(["claim", "--task-id", expireTask, "--agent", "soak-agent-expiry", "--lease-seconds", "1", "--operation-id", `soak-claim3-${expireTask}`]);
  await sleep(1600);

  const before = await call(["status"]);
  const task = before.data.tasks.find((item) => item.taskId === expireTask);
  check("expired lease surfaces as needs-reconcile", task?.status === "needs-reconcile", `status=${task?.status}`);

  const reaped = await call(["reap"]);
  check("reap reports the expired task", reaped.ok && reaped.data.count >= 1, JSON.stringify(reaped.data));

  const after = await call(["status"]);
  const reapedTask = after.data.tasks.find((item) => item.taskId === expireTask);
  check("reaped task stays needs-reconcile for a human", reapedTask?.status === "needs-reconcile", `status=${reapedTask?.status}`);

  const second = await call(["reap"]);
  check("second reap is a no-op", second.ok && second.data.tasks.every((item) => item.taskId !== expireTask), JSON.stringify(second.data.tasks));
}

// -------------------------------------------------------- credential refusal
console.log("\nphase 11: credential-shaped input is refused");
{
  const cases = [
    ["bearer title", ["enqueue", "--task-id", `soak-cred-${randomUUID()}`, "--title", "Bearer abcdefghijklmnop123456"]],
    ["api-key title", ["enqueue", "--task-id", `soak-cred-${randomUUID()}`, "--title", "sk-abcdefghijklmnop1234567890"]],
    ["jwt-shaped note", ["enqueue", "--task-id", `soak-cred-${randomUUID()}`, "--title", "ok", "--priority", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop"]],
  ];
  for (const [label, args] of cases) {
    const result = await call(args);
    check(`${label} rejected as CREDENTIAL_REJECTED`, !result.ok && result.code === "CREDENTIAL_REJECTED", result.code);
  }
  const events = await readAll("events");
  check("no credential-shaped value reached the journal", !events.some((item) => /bearer\s+[a-z0-9._~+/=-]{12,}|(?:sk|pk|rk)-[a-z0-9_-]{12,}/i.test(JSON.stringify(item.value))));
}

// ------------------------------------------------------------ journal audit
console.log("\nphase 12: journal integrity audit");
{
  const events = await readAll("events");
  const receipts = await readAll("receipts");
  const leases = await readAll("leases");

  const revisions = events.map((item) => item.value.revision);
  check("every event carries the schema version", events.every((item) => item.value.schemaVersion === "scamcity.agent-sync/v1"));
  check("eventIds are unique", new Set(events.map((item) => item.value.eventId)).size === events.length);
  check("revisions are unique under concurrency", new Set(revisions).size === revisions.length, `total=${revisions.length} unique=${new Set(revisions).size}`);
  const sorted = [...revisions].sort((a, b) => a - b);
  check("revisions are contiguous from 1", sorted.every((value, index) => value === index + 1), `first=${sorted[0]} last=${sorted.at(-1)} count=${sorted.length}`);
  check("every event has a payload hash", events.every((item) => /^[0-9a-f]{64}$/.test(item.value.payloadHash ?? "")));
  check("event filenames match their revision", events.every((item) => item.name.startsWith(String(item.value.revision).padStart(10, "0"))));
  check("receipts are unique per operation", new Set(receipts.map((item) => item.value.operationId)).size === receipts.length);
  check("receipt hashes match their payload shape", receipts.every((item) => /^[0-9a-f]{64}$/.test(item.value.payloadHash ?? "")));
  check("no lease survives its terminal event", !leases.some((item) => [raceTask, raceTask2].includes(item.value.taskId)));

  const status = await call(["status"]);
  const raceRecord = status.data.tasks.find((item) => item.taskId === raceTask2);
  check("folded state reports the raced task completed", raceRecord?.status === "completed", `status=${raceRecord?.status}`);
  check("folded revision equals the event count", status.data.revision === events.length, `revision=${status.data.revision} events=${events.length}`);
  console.log(`  events=${events.length} receipts=${receipts.length} leases=${leases.length}`);
}

// ------------------------------------------------------------------- summary
const failed = checks.filter((item) => !item.passed);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log("failures:");
  for (const item of failed) console.log(`  - ${item.name}${item.detail ? ` (${item.detail})` : ""}`);
}

if (!KEEP) await rm(ROOT, { recursive: true, force: true });
else console.log(`kept scratch root: ${ROOT}`);

process.exitCode = failed.length ? 1 : 0;
