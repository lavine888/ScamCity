# 2026-09-19 跨 Agent 协调验收

## 范围

验证 `scripts/agent-sync.mjs` 在 Windows 工作区中的本地任务队列、租约 fencing、幂等 receipt、过期回收和凭据拒绝。

## 已执行

- `node --check scripts/agent-sync.mjs`
- `node --check scripts/agent-sync-smoke.mjs`
- `node scripts/agent-sync.mjs init --json`
- `npm run agent:sync -- status --json`
- 手工 CLI 链路：`enqueue → claim → heartbeat → handoff → complete`
- 重复 `enqueue`：同一 `operationId` 返回 `idempotent: true`，没有新增事件
- 同一 `taskId` 使用不同 operation 再次 `enqueue`：返回 `TASK_EXISTS`，没有覆盖原任务
- 旧 lease heartbeat：返回 `STALE_LEASE`
- 第二个 Agent 在活跃租约期间 claim：返回 `LEASE_CONFLICT`
- 1 秒租约等待过期后 `status`：显示 `needs-reconcile`；`reap` 后写入 `task.lease-expired`
- 删除一份 receipt 后重放同一 operation：从已有事件恢复，返回 `recovered: true`
- `reap` 恢复旧 `task.lease-expired` 事件时：仅在 leaseId/generation 仍匹配时清理 lease，不误删新 Agent 的接管租约
- 并发初始化路径：bootstrap manifest 创建受短时目录锁保护；最终 smoke 覆盖该路径并通过
- 带 `Bearer ...` 形态的标题：返回 `CREDENTIAL_REJECTED`，没有写入事件

## 环境边界

在当前 Codex 受限执行环境中直接运行 smoke 会收到 Windows `spawn EPERM`；这属于执行沙箱边界，不是协调 CLI 的业务断言失败。获准在沙箱外运行后，`node scripts/agent-sync-smoke.mjs` 于本次验收通过；运行产物已清理，未把测试任务留在共享队列。
