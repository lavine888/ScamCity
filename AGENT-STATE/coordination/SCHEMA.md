# Coordination schema

协议版本：`scamcity.agent-sync/v1`。

每个 event 都至少包含：

```json
{
  "schemaVersion": "scamcity.agent-sync/v1",
  "eventId": "uuid",
  "operationId": "caller-chosen-idempotency-key",
  "revision": 1,
  "at": "2026-09-19T00:00:00.000Z",
  "type": "task.created",
  "payloadHash": "sha256",
  "taskId": "example"
}
```

任务状态事件：`task.created`、`task.claimed`、`task.heartbeat`、`task.handoff`、`task.lease-expired`、`task.complete`、`task.fail`。

强制不变量：

- 一个 task 同时只能有一个未过期 `ownerId + leaseId + generation`。
- 一个 `taskId` 只能有一个 `task.created`；重复创建必须返回 `TASK_EXISTS`，不能用第二条创建事件覆盖原任务。
- 所有 lease 写入都校验完整三元组；旧 Agent 延迟恢复时得到 `STALE_LEASE`。
- 同一 `operationId` 只能绑定一个 payload hash；不同 payload 返回 `IDEMPOTENCY_CONFLICT`。
- 正式 JSON 先写同目录临时文件再 rename；损坏 JSON 会 fail closed，不覆盖原文件。
- token-like 字段名和 bearer/API-key/JWT 形态的值会被拒绝；CLI 不接收 token 专用参数。
- lease 到期只进入 `needs-reconcile`，不会自动执行未知外部副作用。
- event 已落盘但 receipt 尚未落盘时，按同一 `operationId` 重试必须从事件恢复结果并写回 receipt；恢复结果带 `recovered: true`。
