# ScamCity Web 改进（2026-09-21）

本轮已完成并验证：

- `simulation/world.ts`：`compareFromSnapshot` 从当前世界分叉，保留事件、历史与既有干预；`lib/simulation-api.ts` 的 `compare` 支持 `mode: "snapshot"`，返回 `comparisonContext` 并在后续世界命令后清理旧比较。
- `agents/intervention-planner.ts` + `app/api/agent/intervene/route.ts`：单轮 observe → choose → activate；预算只覆盖激活费用；允许规则/模型/回退来源，快照过期返回 409，不推进时间；观察含活动事件、近期策略和累计指标。
- `components/scamcity-dashboard.tsx`：市民焦点、当前快照比较、LIVE API Agent 执行反馈与规则标识；浏览器还验证了无密钥叙述 fallback。
- `agents/live-thoughts.ts` / `agents/llm-adapter.ts`：叙述上下文带 `actualDecision`，模型输出若改写引擎结果会回退；支持 blocked/cancelled 叙述。
- `README.md`：补充比较模式与 Agent 接口边界。

验收入口与结果（2026-09-21）：

- `D:\Nodejs\node.exe scripts/verify-counterfactual.mjs`：PASS，3 个 seed，输入不变、事件/既有干预保留、分支隔离、可重复、未来 horizon、旧接口兼容。
- `D:\Nodejs\node.exe scripts/verify-intervention-agent.mjs`：PASS，本地 store 规则执行、激活费用、重复拒绝、baseline 保留、模拟 gateway 与 stale 竞态；未调用真实模型。
- `D:\Nodejs\node.exe scripts/verify-live-thought-consistency.mjs`：PASS，fallback 和 mock 模型不能改写引擎决策，blocked 支持。
- `$env:SCAMCITY_URL='http://127.0.0.1:3011'; D:\Nodejs\node.exe scripts/verify-simulation-contract.mjs`：PASS，既有 HTTP/事件契约。
- `D:\Nodejs\node.exe node_modules/typescript/bin/tsc --noEmit --incremental false`：PASS。
- `D:\Nodejs\npm.cmd run build`：PASS；路由包含 `/api/agent/intervene`，构建输出无错误。
- 本地 Edge + Playwright：`D:\Codex-Workspace\Baytech Hackthon\Evomap Hackthon\.scamcity-work\verify-ui.cjs`，页面无 console/page 错误；焦点市民、当前快照比较、规则 Agent 干预、无密钥叙述均实际操作通过。截图在 `.scamcity-work/ui-initial.png` 与 `ui-live.png`。

边界：父目录尚非 Git 仓库；本轮未改 Fabric bridge、未重建或安装 Minecraft JAR，当前 JAR hash 仍以 `AGENT-STATE://resources/artifacts.md` 为准；真实模型调用与 Minecraft 新链路仍未验收。不要把 synthetic 结果说成现实世界因果结论。
