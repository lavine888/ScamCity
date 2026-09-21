import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("./agent-sync.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ROOT = await mkdtemp(join(tmpdir(), "repro-"));
const ENV = { ...process.env, AGENT_SYNC_COORD_ROOT: ROOT };

async function call(args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args, "--json"], { cwd: REPO_ROOT, env: ENV, windowsHide: true, maxBuffer: 1 << 26 });
    if (stderr.trim()) childStderr.push(stderr.trim());
    return { ok: true, data: JSON.parse(stdout) };
  } catch (error) {
    if (String(error.stderr ?? "").trim()) childStderr.push(String(error.stderr).trim());
    return { ok: false, code: (String(error.stderr).match(/^([A-Z_]{3,}):/m) ?? [, "UNCLASSIFIED"])[1], stderr: String(error.stderr).trim() };
  }
}

const task = `repro-${randomUUID()}`;
await call(["enqueue", "--task-id", task, "--title", "repro", "--operation-id", `enq-${task}`]);
const claim = await call(["claim", "--task-id", task, "--agent", "repro-a", "--lease-seconds", "600", "--operation-id", `clm-${task}`]);
const lease = claim.data;

const failures = new Map();
const childStderr = [];
const N = Number(process.argv[2] ?? 12);
const ROUNDS = Number(process.argv[3] ?? 25);

for (let round = 0; round < ROUNDS; round += 1) {
  const op = `repro-op-${round}-${randomUUID()}`;
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      call(["heartbeat", "--task-id", task, "--agent", lease.ownerId, "--lease-id", lease.leaseId, "--generation", String(lease.generation), "--operation-id", op]),
    ),
  );
  for (const result of results) {
    if (!result.ok) {
      const key = result.stderr.split("\n")[0];
      failures.set(key, (failures.get(key) ?? 0) + 1);
    }
  }
}

console.log(`rounds=${ROUNDS} concurrency=${N} failures=${[...failures.values()].reduce((a, b) => a + b, 0)}`);
for (const [message, count] of failures) console.log(`  x${count}  ${message}`);
const leftover = await readdir(join(ROOT, "locks"));
console.log(`leftover lock entries: ${leftover.length}${leftover.length ? ` -> ${leftover.slice(0, 5).join(", ")}` : ""}`);
if (childStderr.length) {
  const grouped = new Map();
  for (const message of childStderr) for (const line of message.split("\n")) grouped.set(line, (grouped.get(line) ?? 0) + 1);
  console.log("child stderr:");
  for (const [line, count] of [...grouped].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  x${count}  ${line}`);
}
await rm(ROOT, { recursive: true, force: true });
