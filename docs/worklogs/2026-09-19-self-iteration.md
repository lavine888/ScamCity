# 2026-09-19 自我迭代（接手后第一轮）

## 触发

用户要求「先进行一轮自我迭代」。本轮目标不是新增功能，而是：审计上一轮自己的结论、跑通仍挂着的验收项、修掉审计中发现的真实缺陷，并把证据写回共享记忆。

## 自我审计（上一轮结论复核）

- 上一轮称「安装时 Minecraft 未运行」：本轮用 `Get-CimInstance Win32_Process` 核对，唯一的 `java.exe` 是 Gradle daemon（`--add-opens=java.base/java.lang=ALL-UNNAMED`），Minecraft 未运行，结论成立。
- 上一轮称「`clean build` 前后 hash 一致」：已复核，`a223c206…` 稳定，结论成立。
- 上一轮称 4 项队列/请求问题「已修正并有回归」：已逐条读源码并运行 `verifyBridgeLifecycle`，结论成立。

## 新发现并修复的缺陷

**`scripts/agent-sync-smoke.mjs` 会污染共享协调日志。**

- 现象：跑一次 smoke，`AGENT-STATE/coordination/` 的 revision 从 10 涨到 18，多出一个 `smoke-*` 任务。这正是历史上「测试数据已清理」说法与磁盘不符的根因——smoke 既没有隔离根目录，也没有清理逻辑。
- 修复：smoke 默认改用 `mkdtemp` 临时根（`AGENT_SYNC_COORD_ROOT`），结束后删除；显式 `--shared` 才写共享日志。同时新增终态断言（任务必须 fold 成 `completed`）。
- 验证：修复后跑 smoke，共享 revision 前后均为 18，`PASS: shared journal untouched`。
- 边界：`--shared` 分支沿用原代码路径（保留对 `ensureLayout` 路径守卫的覆盖），本轮未运行以避免再次污染；默认路径未覆盖该守卫。

## 跑通的待验收项

**跨 Agent 多进程 soak**（此前一直挂在 acceptance-pending）：

```
node scripts/agent-sync-soak.mjs --agents 16 --seconds 8 --workers 3
→ 50/50 checks passed
```

覆盖：并发 bootstrap、enqueue 竞争、claim 竞争、持续 heartbeat（54 次续约 / 54 个不同到期时间）、旧 lease fencing、handoff 代际递增、并发幂等重放、receipt 丢失后从事件恢复、终态封口、过期回收、凭据拒绝、日志完整性（revision 连续、eventId 唯一、receipt 唯一）。沙箱 `spawn EPERM` 限制在当前环境不存在。

## 完整 readiness gate（新 JAR 已安装）

启动 `npm run dev`（端口 3000）后：

- `npm run doctor` → API PASS（100 citizens · 5 scammers）、bridge-jar PASS（`D:\Minecraft\mods\…` · `A223C206…`）；Minecraft 日志仍为 WARN（旧 `latest.log`，373 条历史 parser error），符合「未重启游戏」预期。
- `SCAMCITY_URL=http://localhost:3000 node scripts/verify-simulation-contract.mjs` → OK（schema、100 citizens、eventCursor、观众事件幂等）。
- `SCAMCITY_API=http://localhost:3000/api/simulation npm run report` → 全部 PASS，生成 `evolution/runs/2026-09-19T08-11-58-236Z/`，其中 bridge-jar 记录新 hash `A223C206…`。
- `node bridge-harness/verify.mjs` → passed（100 citizens / 5 scammers / 4 unique events）。
- 验证后已关闭 dev server，端口 3000 已释放。

## 仍未完成

- 真实 Minecraft E2E（重启 profile、进世界、RUNBOOK 七项）。
- `--shared` smoke 分支未实跑。
- 共享协调日志仍有历史 smoke 残留；因日志 append-only 且删除会破坏 revision 连续性，本轮不删，仅记录。
