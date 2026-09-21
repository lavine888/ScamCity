#!/usr/bin/env node

/**
 * File-backed coordination for local agents (including pi instances).
 *
 * The coordinator deliberately has no provider/token integration. Agents use
 * their own runtime credentials; only task metadata, leases and redacted
 * receipts enter AGENT-STATE/coordination.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const STATE_ROOT = resolve(REPO_ROOT, "AGENT-STATE");
// A soak harness can redirect the coordinator into a scratch directory so a
// stress run never writes into the shared queue. Defaults to AGENT-STATE/coordination.
const ISOLATED_ROOT = process.env.AGENT_SYNC_COORD_ROOT ? resolve(process.env.AGENT_SYNC_COORD_ROOT) : null;
const COORD_ROOT = ISOLATED_ROOT ?? resolve(STATE_ROOT, "coordination");
const SCHEMA_VERSION = "scamcity.agent-sync/v1";
const DEFAULT_LEASE_SECONDS = 900;
const MAX_LEASE_SECONDS = 6 * 60 * 60;
const LOCK_WAIT_MS = 25;
const LOCK_TIMEOUT_MS = 8_000;
const LOCK_STALE_MS = 30_000;

const DIRS = {
  events: join(COORD_ROOT, "events"),
  receipts: join(COORD_ROOT, "receipts"),
  leases: join(COORD_ROOT, "leases"),
  locks: join(COORD_ROOT, "locks"),
};

const TOKEN_KEY = /(?:token|secret|password|passwd|api[_-]?key|authorization|cookie|private[_-]?key)/i;
const CREDENTIAL_VALUE = /(?:bearer\s+[a-z0-9._~+/=-]{12,}|(?:sk|pk|rk)-[a-z0-9_-]{12,}|eyj[a-z0-9_-]{10,}\.[a-z0-9._-]+\.[a-z0-9._-]+)/i;

class SyncError extends Error {
  constructor(message, code = "SYNC_ERROR", exitCode = 1) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

function fail(message, code = "SYNC_ERROR", exitCode = 1) {
  throw new SyncError(message, code, exitCode);
}

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`, "USAGE", 2);
    const key = token.slice(2);
    if (!key) fail("Empty option name.", "USAGE", 2);
    if (key === "json") {
      flags.json = true;
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) fail(`Option --${key} requires a value.`, "USAGE", 2);
    flags[key] = value;
    index += 1;
  }
  return { command, flags };
}

function option(flags, name, { required = false, fallback } = {}) {
  const value = flags[name] ?? fallback;
  if (required && (!value || !String(value).trim())) fail(`Missing --${name}.`, "USAGE", 2);
  return typeof value === "string" ? value.trim() : value;
}

function safeText(value, field, maxLength = 240) {
  if (typeof value !== "string") fail(`${field} must be text.`, "USAGE", 2);
  const text = value.trim();
  if (!text) fail(`${field} must not be empty.`, "USAGE", 2);
  if (text.length > maxLength) fail(`${field} is too long.`, "USAGE", 2);
  if (CREDENTIAL_VALUE.test(text)) fail(`${field} looks like a credential; refusing to persist it.`, "CREDENTIAL_REJECTED", 2);
  return text;
}

function safeKey(key) {
  if (TOKEN_KEY.test(key)) fail(`Credential-like field is not allowed: ${key}.`, "CREDENTIAL_REJECTED", 2);
}

function assertSafePayload(value, path = "payload") {
  if (typeof value === "string") {
    if (CREDENTIAL_VALUE.test(value)) fail(`${path} looks like a credential; refusing to persist it.`, "CREDENTIAL_REJECTED", 2);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafePayload(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      safeKey(key);
      assertSafePayload(child, `${path}.${key}`);
    }
  }
}

function hashPayload(payload) {
  assertSafePayload(payload);
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function slug(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "item";
}

function idHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 40);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureLayout() {
  const boundary = `${resolve(STATE_ROOT)}${process.platform === "win32" ? "\\" : "/"}`;
  if (!ISOLATED_ROOT && !resolve(COORD_ROOT).startsWith(boundary)) {
    fail("Coordination root escaped AGENT-STATE.", "PATH_REJECTED");
  }
  await mkdir(COORD_ROOT, { recursive: true });
  for (const directory of Object.values(DIRS)) await mkdir(directory, { recursive: true });
  const manifestPath = join(COORD_ROOT, "manifest.json");
  if (await exists(manifestPath)) {
    const manifest = await readJson(manifestPath);
    if (manifest.schemaVersion !== SCHEMA_VERSION) fail(`Unsupported coordination schema: ${manifest.schemaVersion ?? "missing"}.`, "SCHEMA_MISMATCH");
    return;
  }
  // Only the first writer initializes, and the lock keeps two fresh agents from
  // racing to create the manifest. Every later call takes the fast path above,
  // so the bootstrap lock is not on the hot path for ordinary commands.
  await withLock("bootstrap", async () => {
    if (await exists(manifestPath)) return;
    await atomicWriteJson(manifestPath, {
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      protocol: "immutable events + fenced task leases + operation receipts",
    });
  });
}

async function readJson(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    fail(`Cannot read ${relative(REPO_ROOT, path)}: ${error.message}`, "IO_ERROR");
  }
  try {
    const value = JSON.parse(raw);
    assertSafePayload(value);
    return value;
  } catch (error) {
    if (error instanceof SyncError) throw error;
    fail(`Invalid JSON in ${relative(REPO_ROOT, path)}; refusing recovery overwrite.`, "CORRUPT_STATE");
  }
}

async function atomicWriteJson(path, value) {
  assertSafePayload(value);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    fail(`Atomic write failed for ${relative(REPO_ROOT, path)}: ${error.message}`, "IO_ERROR");
  }
}

async function withLock(name, fn) {
  const lockPath = join(DIRS.locks, `${slug(name)}.lock`);
  const nonce = randomUUID();
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > LOCK_TIMEOUT_MS) fail(`Lock conflict: ${name}.`, "LOCK_CONFLICT", 3);
    if (await tryAcquireLock(lockPath, nonce)) break;
    const held = await inspectLock(lockPath);
    if (held.stale) await retireLock(lockPath, "stale", held.nonce);
    await delay(LOCK_WAIT_MS);
  }
  try {
    return await fn();
  } finally {
    await releaseLock(lockPath, nonce);
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/**
 * Take the lock with an exclusive create.
 *
 * This uses a lock FILE rather than a lock directory. Windows refuses to rename
 * a directory while another process is inspecting it, so directory-based release
 * failed with EPERM under load and leaked the lock permanently. An exclusive
 * create is atomic on every platform, so exactly one contender can win.
 */
async function tryAcquireLock(lockPath, nonce) {
  try {
    await writeFile(lockPath, `${JSON.stringify({ pid: process.pid, nonce, acquiredAt: new Date().toISOString() })}\n`, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    // EEXIST is ordinary contention; the rest are transient Windows races with
    // a holder that is creating or retiring the lock right now.
    if (["EEXIST", "EPERM", "EACCES", "ENOENT", "EISDIR"].includes(error?.code)) return false;
    throw error;
  }
}

async function inspectLock(lockPath) {
  try {
    const info = await stat(lockPath);
    let nonce = null;
    try {
      nonce = JSON.parse(await readFile(lockPath, "utf8"))?.nonce ?? null;
    } catch {
      // Created but not yet stamped; a fresh mtime keeps it out of the sweep.
      nonce = null;
    }
    return { exists: true, stale: Date.now() - info.mtimeMs > LOCK_STALE_MS, nonce };
  } catch {
    return { exists: false, stale: false, nonce: null };
  }
}

/**
 * Hand the lock back by renaming it out of the way before deleting it.
 *
 * Deleting the lock path directly is unsafe: a successor can create it in the
 * gap between our ownership check and the removal, and we would then delete a
 * lock we no longer own. The rename is atomic, so the lock path only becomes
 * free at the instant we stop owning it. If the file turns out to belong to
 * somebody else after all, it is renamed straight back.
 */
async function retireLock(lockPath, label, expectedNonce) {
  const graveyard = `${lockPath}.${label}-${randomUUID()}`;
  try {
    await rename(lockPath, graveyard);
  } catch {
    return false;
  }
  if (typeof expectedNonce === "string") {
    let owner = null;
    try {
      owner = JSON.parse(await readFile(graveyard, "utf8"));
    } catch {
      owner = null;
    }
    if (owner?.nonce !== expectedNonce) {
      await rename(graveyard, lockPath).catch(() => {});
      return false;
    }
  }
  await unlink(graveyard).catch(() => {});
  return true;
}

async function releaseLock(lockPath, nonce) {
  if (await retireLock(lockPath, "release", nonce)) return;
  // Renaming can still lose a race with an inspecting process; fall back to a
  // checked delete so a lock is never leaked while it is still ours.
  let owner = null;
  try {
    owner = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    return;
  }
  if (owner?.nonce === nonce) await unlink(lockPath).catch(() => {});
}

async function listJson(directory) {
  const names = await readdir(directory).catch(() => []);
  const result = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    result.push(await readJson(join(directory, name)));
  }
  return result;
}

async function nextRevision() {
  return withLock("journal", async () => {
    const sequencePath = join(COORD_ROOT, "revision.json");
    const current = await exists(sequencePath) ? await readJson(sequencePath) : { revision: 0 };
    const revision = Number.isSafeInteger(current.revision) ? current.revision + 1 : 1;
    await atomicWriteJson(sequencePath, { schemaVersion: SCHEMA_VERSION, revision });
    return revision;
  });
}

async function appendEvent(type, payload, payloadHash) {
  assertSafePayload(payload);
  const revision = await nextRevision();
  const event = {
    schemaVersion: SCHEMA_VERSION,
    eventId: randomUUID(),
    operationId: payload.operationId ?? randomUUID(),
    revision,
    at: new Date().toISOString(),
    type,
    payloadHash: payloadHash ?? hashPayload(payload),
    ...payload,
  };
  const filename = `${String(revision).padStart(10, "0")}-${event.eventId}.json`;
  await atomicWriteJson(join(DIRS.events, filename), event);
  return event;
}

function receiptPath(operationId) {
  return join(DIRS.receipts, `${idHash(operationId)}.json`);
}

async function withReceipt(operationId, payload, action) {
  const operation = safeText(operationId, "operationId", 160);
  const payloadHash = hashPayload(payload);
  return withLock(`operation-${createHash("sha256").update(operation).digest("hex").slice(0, 24)}`, async () => {
    const path = receiptPath(operation);
    if (await exists(path)) {
      const receipt = await readJson(path);
      if (receipt.payloadHash !== payloadHash) fail(`operationId ${operation} was reused with a different payload.`, "IDEMPOTENCY_CONFLICT", 3);
      return { ...receipt.result, idempotent: true };
    }
    const priorEvent = (await listJson(DIRS.events)).find((event) => event.operationId === operation);
    if (priorEvent) {
      if (priorEvent.payloadHash !== payloadHash) fail(`operationId ${operation} was reused with a different payload.`, "IDEMPOTENCY_CONFLICT", 3);
      const recovered = resultFromEvent(priorEvent);
      await atomicWriteJson(path, {
        schemaVersion: SCHEMA_VERSION,
        operationId: operation,
        payloadHash,
        committedAt: new Date().toISOString(),
        recovered: true,
        result: recovered,
      });
      return { ...recovered, idempotent: true, recovered: true };
    }
    const result = await action(payloadHash);
    await atomicWriteJson(path, {
      schemaVersion: SCHEMA_VERSION,
      operationId: operation,
      payloadHash,
      committedAt: new Date().toISOString(),
      result,
    });
    // Keep the response shape identical for the committing call and for replays;
    // the marker is what distinguishes them, so callers can always read it.
    return { ...result, idempotent: false };
  });
}

function resultFromEvent(event) {
  const common = { taskId: event.taskId, eventId: event.eventId, revision: event.revision };
  switch (event.type) {
    case "task.created": return { status: "queued", ...common };
    case "task.claimed": return { status: "claimed", ownerId: event.ownerId, leaseId: event.leaseId, generation: event.generation, expiresAt: event.expiresAt, ...common };
    case "task.heartbeat": return { status: "renewed", expiresAt: event.expiresAt, leaseId: event.leaseId, generation: event.generation, ...common };
    case "task.handoff": return { status: "handed-off", ownerId: event.toAgent, leaseId: event.leaseId, generation: event.generation, expiresAt: event.expiresAt, ...common };
    case "task.complete": return { status: "completed", ...common };
    case "task.fail": return { status: "failed", ...common };
    case "task.lease-expired": return { status: "needs-reconcile", ...common };
    default: fail(`Cannot recover unsupported event type ${event.type}.`, "CORRUPT_STATE");
  }
}

function leasePath(taskId) {
  return join(DIRS.leases, `${idHash(taskId)}.json`);
}

async function readLease(taskId) {
  const path = leasePath(taskId);
  return (await exists(path)) ? await readJson(path) : null;
}

function leaseIsActive(lease, now = Date.now()) {
  return Boolean(lease && Date.parse(lease.expiresAt) > now);
}

function assertLease(lease, flags) {
  if (!lease) fail(`Task ${flags["task-id"]} has no active lease.`, "LEASE_CONFLICT", 3);
  const agent = safeText(option(flags, "agent", { required: true }), "agent", 120);
  const leaseId = safeText(option(flags, "lease-id", { required: true }), "lease-id", 160);
  const generation = Number(option(flags, "generation", { required: true }));
  if (!Number.isSafeInteger(generation) || generation < 1) fail("generation must be a positive integer.", "USAGE", 2);
  if (lease.ownerId !== agent || lease.leaseId !== leaseId || lease.generation !== generation) {
    fail("Lease fencing rejected this write; reclaim the task before continuing.", "STALE_LEASE", 3);
  }
  if (!leaseIsActive(lease)) fail("Lease has expired; reclaim the task before continuing.", "LEASE_EXPIRED", 3);
  return { agent, leaseId, generation };
}

function leaseSeconds(flags) {
  const seconds = Number(option(flags, "lease-seconds", { fallback: DEFAULT_LEASE_SECONDS }));
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > MAX_LEASE_SECONDS) {
    fail(`lease-seconds must be between 1 and ${MAX_LEASE_SECONDS}.`, "USAGE", 2);
  }
  return seconds;
}

function displayRoot() {
  return ISOLATED_ROOT ? COORD_ROOT : relative(REPO_ROOT, COORD_ROOT);
}

async function commandInit() {
  await ensureLayout();
  return { status: "initialized", schemaVersion: SCHEMA_VERSION, root: displayRoot() };
}

async function commandEnqueue(flags) {
  const taskId = safeText(option(flags, "task-id", { required: true }), "task-id", 160);
  const title = safeText(option(flags, "title", { required: true }), "title", 240);
  const priority = option(flags, "priority", { fallback: "normal" });
  const dependencies = option(flags, "depends-on", { fallback: "" }).split(",").map((item) => item.trim()).filter(Boolean);
  const agent = option(flags, "agent", { fallback: "" });
  const operationId = option(flags, "operation-id", { fallback: `enqueue:${taskId}` });
  const payload = { taskId, title, priority, dependencies, createdBy: agent || undefined };
  return withReceipt(operationId, payload, async (payloadHash) => withLock(`task-${idHash(taskId)}`, async () => {
    const exists = (await listJson(DIRS.events)).some((event) => event.type === "task.created" && event.taskId === taskId);
    if (exists) fail(`Task ${taskId} already exists.`, "TASK_EXISTS", 3);
    const event = await appendEvent("task.created", { ...payload, operationId }, payloadHash);
    return { status: "queued", taskId, eventId: event.eventId, revision: event.revision };
  }));
}

async function commandClaim(flags) {
  const taskId = safeText(option(flags, "task-id", { required: true }), "task-id", 160);
  const agent = safeText(option(flags, "agent", { required: true }), "agent", 120);
  const seconds = leaseSeconds(flags);
  const operationId = option(flags, "operation-id", { fallback: `claim:${taskId}:${agent}:${randomUUID()}` });
  const payload = { taskId, agent, leaseSeconds: seconds };
  return withReceipt(operationId, payload, async (payloadHash) => withLock(`task-${idHash(taskId)}`, async () => {
    const events = await listJson(DIRS.events);
    const task = foldEvents(events, []).find((item) => item.taskId === taskId);
    if (!task) fail(`Task ${taskId} does not exist.`, "TASK_NOT_FOUND", 3);
    if (task.status === "completed" || task.status === "failed") {
      fail(`Task ${taskId} is already ${task.status}.`, "TASK_TERMINAL", 3);
    }
    const existing = await readLease(taskId);
    if (leaseIsActive(existing)) fail(`Task ${taskId} is leased by ${existing.ownerId}.`, "LEASE_CONFLICT", 3);
    const generation = Math.max(existing?.generation ?? 0, task.generation ?? 0) + 1;
    const lease = {
      schemaVersion: SCHEMA_VERSION,
      taskId,
      ownerId: agent,
      leaseId: randomUUID(),
      generation,
      claimedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
    };
    await atomicWriteJson(leasePath(taskId), lease);
    const event = await appendEvent("task.claimed", { taskId, ownerId: agent, leaseId: lease.leaseId, generation, expiresAt: lease.expiresAt, operationId }, payloadHash);
    return { status: "claimed", taskId, ownerId: agent, leaseId: lease.leaseId, generation, expiresAt: lease.expiresAt, eventId: event.eventId, revision: event.revision };
  }));
}

async function commandHeartbeat(flags) {
  const taskId = safeText(option(flags, "task-id", { required: true }), "task-id", 160);
  const operationId = option(flags, "operation-id", { fallback: `heartbeat:${taskId}:${option(flags, "lease-id", { required: true })}:${option(flags, "generation", { required: true })}:${randomUUID()}` });
  const seconds = leaseSeconds(flags);
  const payload = { taskId, agent: option(flags, "agent", { required: true }), leaseId: option(flags, "lease-id", { required: true }), generation: Number(option(flags, "generation", { required: true })), leaseSeconds: seconds };
  return withReceipt(operationId, payload, async (payloadHash) => withLock(`task-${idHash(taskId)}`, async () => {
    const lease = await readLease(taskId);
    const identity = assertLease(lease, flags);
    const updated = { ...lease, expiresAt: new Date(Date.now() + seconds * 1000).toISOString(), heartbeatAt: new Date().toISOString() };
    await atomicWriteJson(leasePath(taskId), updated);
    const event = await appendEvent("task.heartbeat", { taskId, ownerId: identity.agent, leaseId: identity.leaseId, generation: identity.generation, expiresAt: updated.expiresAt, operationId }, payloadHash);
    return { status: "renewed", taskId, expiresAt: updated.expiresAt, leaseId: identity.leaseId, generation: identity.generation, eventId: event.eventId, revision: event.revision };
  }));
}

async function commandHandoff(flags) {
  const taskId = safeText(option(flags, "task-id", { required: true }), "task-id", 160);
  const target = safeText(option(flags, "to-agent", { required: true }), "to-agent", 120);
  const note = option(flags, "note", { fallback: "" });
  const operationId = option(flags, "operation-id", { fallback: `handoff:${taskId}:${target}:${option(flags, "lease-id", { required: true })}:${option(flags, "generation", { required: true })}:${randomUUID()}` });
  const payload = { taskId, target, note, fromAgent: option(flags, "agent", { required: true }), leaseId: option(flags, "lease-id", { required: true }), generation: Number(option(flags, "generation", { required: true })) };
  return withReceipt(operationId, payload, async (payloadHash) => withLock(`task-${idHash(taskId)}`, async () => {
    const current = await readLease(taskId);
    const identity = assertLease(current, flags);
    const next = {
      schemaVersion: SCHEMA_VERSION,
      taskId,
      ownerId: target,
      leaseId: randomUUID(),
      generation: identity.generation + 1,
      claimedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + DEFAULT_LEASE_SECONDS * 1000).toISOString(),
    };
    await atomicWriteJson(leasePath(taskId), next);
    const event = await appendEvent("task.handoff", { taskId, fromAgent: identity.agent, toAgent: target, oldLeaseId: identity.leaseId, leaseId: next.leaseId, generation: next.generation, note, expiresAt: next.expiresAt, operationId }, payloadHash);
    return { status: "handed-off", taskId, ownerId: target, leaseId: next.leaseId, generation: next.generation, expiresAt: next.expiresAt, eventId: event.eventId, revision: event.revision };
  }));
}

async function commandTerminal(flags, type) {
  const taskId = safeText(option(flags, "task-id", { required: true }), "task-id", 160);
  const operationId = option(flags, "operation-id", { fallback: `${type}:${taskId}:${option(flags, "lease-id", { required: true })}:${option(flags, "generation", { required: true })}:${randomUUID()}` });
  const note = option(flags, "note", { fallback: "" });
  const payload = { taskId, agent: option(flags, "agent", { required: true }), leaseId: option(flags, "lease-id", { required: true }), generation: Number(option(flags, "generation", { required: true })), note };
  return withReceipt(operationId, payload, async (payloadHash) => withLock(`task-${idHash(taskId)}`, async () => {
    const current = await readLease(taskId);
    const identity = assertLease(current, flags);
    const event = await appendEvent(`task.${type}`, { taskId, ownerId: identity.agent, leaseId: identity.leaseId, generation: identity.generation, note, operationId }, payloadHash);
    await unlink(leasePath(taskId)).catch(() => {});
    return { status: type === "complete" ? "completed" : "failed", taskId, eventId: event.eventId, revision: event.revision };
  }));
}

async function commandReap() {
  const leases = await listJson(DIRS.leases);
  const expired = [];
  for (const lease of leases) {
    if (!leaseIsActive(lease)) {
      const operationId = `reap:${lease.taskId}:${lease.generation}`;
      const receipt = await withReceipt(operationId, { taskId: lease.taskId, generation: lease.generation }, async (payloadHash) => withLock(`task-${idHash(lease.taskId)}`, async () => {
        const current = await readLease(lease.taskId);
        if (!current || current.generation !== lease.generation || leaseIsActive(current)) return { status: "skipped", taskId: lease.taskId };
          const event = await appendEvent("task.lease-expired", { taskId: current.taskId, ownerId: current.ownerId, leaseId: current.leaseId, generation: current.generation, status: "needs-reconcile", operationId }, payloadHash);
          await unlink(leasePath(current.taskId)).catch(() => {});
          return { status: "needs-reconcile", taskId: current.taskId, eventId: event.eventId, revision: event.revision };
      }));
      if (receipt.status === "needs-reconcile") {
        await withLock(`task-${idHash(lease.taskId)}`, async () => {
          const current = await readLease(lease.taskId);
          if (current?.leaseId === lease.leaseId && current.generation === lease.generation) await unlink(leasePath(lease.taskId)).catch(() => {});
        });
      }
      if (receipt.status !== "skipped") expired.push(receipt);
    }
  }
  return { status: "reaped", count: expired.length, tasks: expired };
}

function foldEvents(events, leases) {
  const tasks = new Map();
  for (const event of events.sort((left, right) => (left.revision ?? 0) - (right.revision ?? 0))) {
    if (!event.taskId) continue;
    const task = tasks.get(event.taskId) ?? { taskId: event.taskId, title: "", status: "unknown", revision: 0 };
    task.revision = Math.max(task.revision, event.revision ?? 0);
    if (event.type === "task.created") Object.assign(task, { title: event.title, priority: event.priority, dependencies: event.dependencies, status: "queued", createdBy: event.createdBy });
    if (event.type === "task.claimed" || event.type === "task.heartbeat") Object.assign(task, { status: "claimed", ownerId: event.ownerId, leaseId: event.leaseId, generation: event.generation, expiresAt: event.expiresAt });
    if (event.type === "task.handoff") Object.assign(task, { status: "claimed", ownerId: event.toAgent, leaseId: event.leaseId, generation: event.generation, expiresAt: event.expiresAt, handoffNote: event.note });
    if (event.type === "task.lease-expired") Object.assign(task, { status: "needs-reconcile", ownerId: event.ownerId, leaseId: event.leaseId, generation: event.generation, reconcileReason: "lease expired" });
    if (event.type === "task.complete") Object.assign(task, { status: "completed", completedBy: event.ownerId, note: event.note, terminalLeaseId: event.leaseId, terminalGeneration: event.generation });
    if (event.type === "task.fail") Object.assign(task, { status: "failed", failedBy: event.ownerId, note: event.note, terminalLeaseId: event.leaseId, terminalGeneration: event.generation });
    tasks.set(event.taskId, task);
  }
  for (const lease of leases) {
    const task = tasks.get(lease.taskId) ?? { taskId: lease.taskId, title: "[lease without event]", status: "needs-reconcile" };
    const matchesCurrentEvent = task.leaseId === lease.leaseId && task.generation === lease.generation;
    if (leaseIsActive(lease)) {
      if (task.status === "completed" || task.status === "failed") {
        Object.assign(task, { status: "needs-reconcile", reconcileReason: "active lease remains after terminal event" });
      } else if (!matchesCurrentEvent || task.status !== "claimed") {
        Object.assign(task, { status: "needs-reconcile", ownerId: lease.ownerId, leaseId: lease.leaseId, generation: lease.generation, expiresAt: lease.expiresAt, reconcileReason: "lease has no matching state event" });
      } else {
        Object.assign(task, { status: "claimed", ownerId: lease.ownerId, leaseId: lease.leaseId, generation: lease.generation, expiresAt: lease.expiresAt });
      }
    } else if (matchesCurrentEvent && task.status === "claimed") {
      Object.assign(task, { status: "needs-reconcile", reconcileReason: "lease expired without reconciliation" });
    }
    tasks.set(lease.taskId, task);
  }
  for (const task of tasks.values()) {
    if (task.status === "claimed" && !leases.some((lease) => lease.taskId === task.taskId && lease.leaseId === task.leaseId && lease.generation === task.generation)) {
      Object.assign(task, { status: "needs-reconcile", reconcileReason: "state event has no current lease" });
    }
  }
  return [...tasks.values()].sort((left, right) => left.taskId.localeCompare(right.taskId));
}

async function commandStatus(flags) {
  const events = await listJson(DIRS.events);
  const leases = await listJson(DIRS.leases);
  const tasks = foldEvents(events, leases);
  const result = { schemaVersion: SCHEMA_VERSION, root: displayRoot(), revision: Math.max(0, ...events.map((event) => event.revision ?? 0)), tasks, eventCount: events.length, leaseCount: leases.length };
  if (flags.json) return result;
  console.log(`AGENT SYNC ${result.schemaVersion} · revision ${result.revision} · events ${result.eventCount}`);
  if (!tasks.length) console.log("No tasks.");
  for (const task of tasks) console.log(`${task.status.padEnd(16)} ${task.taskId} · ${task.title || "(untitled)"}${task.ownerId ? ` · ${task.ownerId}` : ""}`);
  return result;
}

function usage() {
  console.log(`Usage: node scripts/agent-sync.mjs <command> [options]

Commands:
  init
  enqueue --task-id ID --title TEXT [--priority P] [--depends-on ID,ID] [--operation-id OP]
  claim --task-id ID --agent AGENT [--lease-seconds N] [--operation-id OP]
  heartbeat --task-id ID --agent AGENT --lease-id LEASE --generation N
  handoff --task-id ID --agent FROM --to-agent TO --lease-id LEASE --generation N [--note TEXT]
  complete|fail --task-id ID --agent AGENT --lease-id LEASE --generation N [--note TEXT]
  reap
  status [--json]

No command accepts provider tokens or credentials. Give pi its token through
its own runtime secret store/environment; only the coordination metadata is persisted here.`);
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }
  await ensureLayout();
  let result;
  switch (command) {
    case "init": result = await commandInit(); break;
    case "enqueue": result = await commandEnqueue(flags); break;
    case "claim": result = await commandClaim(flags); break;
    case "heartbeat": result = await commandHeartbeat(flags); break;
    case "handoff": result = await commandHandoff(flags); break;
    case "complete": result = await commandTerminal(flags, "complete"); break;
    case "fail": result = await commandTerminal(flags, "fail"); break;
    case "reap": result = await commandReap(); break;
    case "status": result = await commandStatus(flags); break;
    default: fail(`Unknown command: ${command}.`, "USAGE", 2);
  }
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else if (command !== "status") console.log(`${result.status ?? "ok"}${result.taskId ? ` · ${result.taskId}` : ""}`);
}

main().catch((error) => {
  const code = error instanceof SyncError ? error.code : "SYNC_ERROR";
  const exitCode = error instanceof SyncError ? error.exitCode : 1;
  console.error(`${code}: ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = exitCode;
});
