#!/usr/bin/env node

/**
 * One-process happy-path smoke for the AGENT-STATE coordination protocol.
 *
 * By default this runs against an isolated scratch root (like the soak
 * harness) so a smoke run never appends test tasks to the shared journal.
 * Pass --shared to exercise the real AGENT-STATE/coordination layout
 * (including the path-escape guard in ensureLayout); that mode intentionally
 * leaves the completed smoke task in the append-only journal.
 */

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("./agent-sync.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const taskId = `smoke-${randomUUID()}`;
const operation = `smoke-op-${taskId}`;

const shared = process.argv.includes("--shared");
const root = shared ? null : await mkdtemp(join(tmpdir(), "agent-sync-smoke-"));
const env = root ? { ...process.env, AGENT_SYNC_COORD_ROOT: root } : process.env;

async function call(args) {
  const { stdout } = await run(process.execPath, [cli, ...args], { cwd: repoRoot, env, windowsHide: true });
  return JSON.parse(stdout);
}

try {
  await call(["init", "--json"]);
  await call(["enqueue", "--task-id", taskId, "--title", "agent sync smoke", "--operation-id", operation, "--json"]);
  const claimed = await call(["claim", "--task-id", taskId, "--agent", "smoke-agent", "--lease-seconds", "60", "--operation-id", `${operation}-claim`, "--json"]);
  await call(["heartbeat", "--task-id", taskId, "--agent", "smoke-agent", "--lease-id", claimed.leaseId, "--generation", String(claimed.generation), "--operation-id", `${operation}-heartbeat`, "--json"]);
  const handed = await call(["handoff", "--task-id", taskId, "--agent", "smoke-agent", "--to-agent", "smoke-agent-b", "--lease-id", claimed.leaseId, "--generation", String(claimed.generation), "--operation-id", `${operation}-handoff`, "--json"]);
  await call(["complete", "--task-id", taskId, "--agent", "smoke-agent-b", "--lease-id", handed.leaseId, "--generation", String(handed.generation), "--operation-id", `${operation}-complete`, "--json"]);
  const status = await call(["status", "--json"]);
  const record = status.tasks.find((task) => task.taskId === taskId);
  if (record?.status !== "completed") throw new Error(`expected completed task, got ${record?.status}`);
  console.log(`agent-sync smoke passed: ${taskId}`);
  console.log(shared ? "root: shared AGENT-STATE/coordination" : `root: isolated ${root}`);
} finally {
  if (root) await rm(root, { recursive: true, force: true });
}
