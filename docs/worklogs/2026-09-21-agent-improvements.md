# ScamCity Web 改进验收记录

时间：2026-09-21（Asia/Shanghai）。

本轮在无 Git 工作树的父项目中完成了 Web 层改进；没有重建或安装 Fabric bridge JAR，也没有进行真实付费模型调用。

## 命令证据

| 检查 | 结果 |
| --- | --- |
| `node scripts/verify-counterfactual.mjs` | PASS；3 个 seed，保留当前世界状态、事件、既有干预，验证分支隔离、可重复、未来时长和旧接口兼容 |
| `node scripts/verify-intervention-agent.mjs` | PASS；真实本地 store 规则工具执行、预算、重复拒绝、baseline、模拟网关和 stale 竞态 |
| `node scripts/verify-live-thought-consistency.mjs` | PASS；叙述 fallback/模拟模型不能改写 `actualDecision`，支持 `blocked` |
| `SCAMCITY_URL=http://127.0.0.1:3011 node scripts/verify-simulation-contract.mjs` | PASS；schema、事件幂等、结构化影响和统一 verdict |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | PASS |
| `D:\Nodejs\npm.cmd run lint` | PASS；No ESLint warnings or errors |
| `npm run build` | PASS；Next 路由含 `/api/agent/intervene` |

PowerShell 实际使用 `D:\Nodejs\node.exe`、`D:\Nodejs\npm.cmd`；本地开发服务为 `http://127.0.0.1:3011`，模型环境显式关闭。

## 浏览器证据

使用本机 Edge 可执行文件和已存在的 Playwright 包运行 `.scamcity-work/verify-ui.cjs`。生产构建后先遇到开发服务复用 `.next` 导致的 500，重启干净开发服务后复跑通过；该 500 是验证环境冲突，不是业务错误。最终页面加载确认无 console/page 错误；点击 `FOLLOW A CITIZEN` 后市民检查器显示消息、引擎状态和时间线；切换 `LIVE API` 后点击 `COMPARE CURRENT SNAPSHOT` 显示 T+ 起点、已有干预、累计指标和 `No additional intervention`；输入默认预算点击 Agent 后显示 `RULES`、实际策略、激活费用和 before/after tick；点击 `NARRATE RECENT DECISIONS` 显示 deterministic fallback。截图保存在当前任务工作区 `.scamcity-work/ui-initial.png` 和 `.scamcity-work/ui-live.png`。

## 真实边界

`source=rules` 是无密钥本地执行，不等于模型决策；模拟 gateway 只验证响应解析与 stale 保护。Snapshot 比较复用同一初始 RNG 状态，但干预可能改变随机数消耗，不能称为严格配对因果实验。指标仍是累计值，展示未来增量需减去来源快照指标。Minecraft 端本轮没有新的现场证据。
