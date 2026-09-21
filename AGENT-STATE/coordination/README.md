# Cross-Agent Coordination Protocol

本目录是本地 pi/Agent 实例共享的任务协调层。它不调用模型供应商，也不接收主办方 token；token 必须留在各自 pi 的运行时 secret store 或进程环境中，不能进入任务标题、备注、事件、receipt、日志或命令行参数。

## 设计

- `events/`：每个状态变化一份不可变 JSON，避免多个 Agent append 同一个 Markdown/JSONL 文件造成交错写入。
- `taskId` 是任务唯一键；同一个任务只能创建一次，后续协作使用 claim/handoff，不重复 enqueue。
- `leases/`：每个任务当前租约；包含 `ownerId`、`leaseId`、`generation`、过期时间。旧 generation 不能写回。
- `receipts/`：`operationId` 幂等收据；同一 operation 重试返回原结果，换 payload 返回 `IDEMPOTENCY_CONFLICT`。
- 事件也记录 `payloadHash`；若进程在事件落盘后、receipt 落盘前崩溃，重试会从事件恢复结果并标记 `recovered: true`，不会重复追加同一操作事件。
- `locks/`：短时目录锁，只保护提交临界区，不替代 lease fencing；锁位于此目录内，过期锁由有限规则回收。
- `manifest.json`、`revision.json`：协议版本和事件 revision。

## 测试隔离

`scripts/agent-sync-smoke.mjs` 和 `scripts/agent-sync-soak.mjs` 默认把 `AGENT_SYNC_COORD_ROOT` 指向临时目录，不会向共享队列追加测试任务。smoke 只有显式 `--shared` 才写 `AGENT-STATE/coordination/`（用于验证真实布局与路径守卫），此时会在日志中留下一个已完成的 smoke 任务。不要用删除事件的方式“清理”日志：日志 append-only，删除会破坏 revision 连续性。

## CLI

从仓库根目录运行：

```powershell
node scripts/agent-sync.mjs init
node scripts/agent-sync.mjs enqueue --task-id api-contract --title "验证 API 契约" --priority P0
node scripts/agent-sync.mjs claim --task-id api-contract --agent pi-a --lease-seconds 900
node scripts/agent-sync.mjs heartbeat --task-id api-contract --agent pi-a --lease-id <LEASE> --generation 1
node scripts/agent-sync.mjs handoff --task-id api-contract --agent pi-a --to-agent pi-b --lease-id <LEASE> --generation 1 --note "契约脚本已通过，继续现场验证"
node scripts/agent-sync.mjs complete --task-id api-contract --agent pi-b --lease-id <NEW_LEASE> --generation 2 --note "已完成"
node scripts/agent-sync.mjs status --json
```

`claim`、`handoff` 的返回值提供下一步 lease 凭据；不要把它们复制到公共日志以外的地方。Agent 挂起超过 TTL 后必须重新 claim，不能继续 heartbeat 或 complete。未显式提供 `--operation-id` 时，带租约的写操作会生成一次性 operation ID；需要在网络重试时复用结果，必须由调用方显式传入同一个 operation ID。

## pi 接入约定

每个 pi 实例启动时：

1. 读取 `AGENT-STATE://.abstract.md` 和 `AGENT-STATE://.overview.md`。
2. 用稳定的 `--agent` 名称 claim 一个任务，先读取相关 L2 记忆。
3. 工作期间按 TTL 的一半发送 heartbeat。
4. 交接时使用 `handoff`，在 note 写入证据路径和下一步，不写 token。
5. 完成/失败必须用 `complete`/`fail`，并在 `AGENT-STATE://memories/events.md` 追加人类可读摘要。
6. 崩溃恢复先运行 `reap`；`needs-reconcile` 任务必须人工判断，不得自动宣称外部副作用成功。

## 明确边界

当前协议同步的是本地文件状态，不是模型上下文窗口，也不是远程调度服务。真实 Minecraft、外部 API、部署等副作用仍需写入可核对的证据；协调层不会替 Agent 伪造验收。
