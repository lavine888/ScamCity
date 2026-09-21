# 资源与产物

更新时间：2026-09-19T09:44:11Z；来源：磁盘 hash/mtime 核对与 readiness gate 实跑。

## 当前产物

- Fabric bridge 构建产物：`minecraft-bridge/build/libs/scamcity-bridge-0.1.0.jar`。
- staging 副本：`minecraft-staging/mods/scamcity-bridge-0.1.0.jar`。
- 现场安装：`D:\Minecraft\mods\scamcity-bridge-0.1.0.jar`。
- 三者当前 SHA-256：`a3d289a62a27970fc46b3a9d3e805b445636dc55859de3f768004895434313f4`（2026-09-20 16:20 七态市民配色 + 骗子人形化构建；连续两次 `clean build` hash 一致）。安装时 `tasklist` 确认 `javaw` 计数 0。注意：该产物尚未在游戏内跑过。
- 上一基线 SHA-256：`d4bbcb2e326ce6037582f6ca52a8f15cbe674378f8a44184ec817ba7e6ba0686`（骗子人形化，未含七态配色）；回滚备份 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-statecolors-20260920-162030.jar`。该产物未在游戏内跑过。
- 更早基线 SHA-256：`0882f4471bb95f36a1966d6150e16d2fbd46be71eba5c50e7176f17d1a2b028b`（叠层面板宽度改为字体实测）；回滚备份 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-humanoid-scammers-20260920-134605.jar`。**该产物已在游戏内加载过**（2026-09-20 13:01:58 日志出现 `ScamCity bridge loaded`），但那次会话**未执行过 `/scamcity refresh`**（日志无任何「正在同步」记录），故叠层与城市渲染仍未观察。
- 更早基线 SHA-256：`3938312a06f643a3e58394b333a44f57b2ad643971d5a4ebceb287f375ac20de`（屏幕叠层 + 端口自发现）；回滚备份 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-hudwidth-20260920-123744.jar`。**该产物已在游戏内加载过**（2026-09-20 12:26:24），同样未跑 `refresh`。注意：它的叠层面板宽度按 6px/字符估算，对中文（约 9px）会明显偏窄导致文字溢出背板。
- 更早基线 SHA-256：`c04894be98605793a89b152b0a2a439991c4c8510ad78435d45422274cac3aaf`（市民人形化小试版）；回滚备份 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-hud-endpoint-20260920-114734.jar`。该产物未在游戏内跑过。
- 更早基线 SHA-256：`243d4dfe9784fb6bad36136992f3cefe86bdcca9c7cb9e6923f44f1f54b481cc`（按槽位增量渲染构建）；回滚备份 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-humanoid-20260920-083431.jar`。该产物已在游戏内加载过（2026-09-20 08:10，仅离线演示数据）。
- 更早基线 SHA-256：`16f0d4adc0f7d0d0585325ccabcf86cb7b98cf34e63984820ae4ae63002a7287`（HTTP/1.1 修复构建）；回滚备份 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-incremental-render-20260920-012603.jar`。
- 更早基线 SHA-256：`7adfb50962f51f98ed44ecf5000084ecce632712e32c1e15df27ea50aec13c41`（市民稳定投影构建）；回滚备份 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-http1-20260919-174311.jar`。
- 更早基线 SHA-256：`a223c206caebbb9c5d2c6a6fa58a7dd49d1f711e10b825c03681ed40dc99b7e8`（刷新稳定性构建）；回滚备份 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-stable-grid-20260919-165331.jar`。
- 更早基线 SHA-256：`BCF2FE7F43473BBF384C5F37822BBBBF13A1D908A4669B43E976AD6C124708DF`；回滚备份 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-refresh-stability-20260919-155735.jar`。
- 目标 profile gameDir：`D:\Minecraft`。
- 运行报告：`evolution/runs/final-live/`，manifest SHA-256 `D004F2154DE9D825BF3ECDCC92B24687CAC2AEA62275A90F51EB9FA0D0D1ED33`。
- 新 JAR 安装后的 readiness 报告：`evolution/runs/2026-09-19T17-27-06-932Z/`（`source=live`，全部 PASS，记录 bridge-jar hash `243D4DFE…`）；上一份为 `evolution/runs/2026-09-19T09-43-33-802Z/`（hash `16F0D4AD…`），再上一份 `evolution/runs/2026-09-19T08-54-28-357Z/`（hash `7ADFB509…`）。

## 服务启动（本轮新增，推荐用法）

- `npm run serve`（dev）/ `npm run serve:prod`（生产构建后）：选一个可用端口启动 Next，并把**实际绑定的 URL** 原子写入 `<tmpdir>/scamcity-endpoint.json`，退出时删除。Minecraft bridge、`doctor`、`report`、`bridge-harness` 都会自动读取该文件，因此端口 3000 被 `Open to LAN` 占用时无需任何手工配置。
- 仍可用 `npm run dev`；此时不产生发现文件，各工具回退到 3000 默认值。
- 显式覆盖：`SCAMCITY_API=http://localhost:51662/api/simulation`（或给 Minecraft profile 加 `-Dscamcity.api=...`）。显式配置会**单独生效**，不再尝试其他候选。

## 已有验证命令

- `D:\Nodejs\npm.cmd run typecheck`
- `D:\Nodejs\npm.cmd run build`
- `$env:SCAMCITY_URL='http://localhost:3000'; node scripts/verify-simulation-contract.mjs`（含跨语言常量防漂移断言）
- `node bridge-harness/verify.mjs`
- `node minecraft-bridge/verify-command-format.mjs`
- `D:\Nodejs\npm.cmd run doctor`
- `node scripts/agent-sync-smoke.mjs`（默认隔离根；`--shared` 才写共享日志）
- `node scripts/agent-sync-soak.mjs --agents 16 --seconds 8 --workers 3`（隔离根，50/50 通过）

## 边界

**离线验收无法发现真实 HTTP 行为缺陷**：`verify-command-format.mjs`、`verifyBridgeLifecycle`、`bridge-harness/verify.mjs` 都不发真实 HTTP 请求；`doctor` 用 Node 的 fetch 而非 Java 的 `HttpClient`。2026-09-19 的 HTTP/2 协商缺陷就是因此漏掉的，只在真机跑起来才暴露。

**屏幕叠层的离线验收只覆盖逻辑与签名**：`HudState` 有回归、`HudElement`/`DrawContext` 签名经 `javap` 对 `fabric-api 0.141.6+1.21.11` 与 1.21.11 yarn 映射核对，但绘制位置、可读性、与 F3/聊天的互让、帧数代价都是运行时观感，未测量。

以上是仓库和安装文件证据；`doctor` 在新 Minecraft 进程启动前不能证明 bridge 已加载，也不能代替真实世界中的 `/scamcity refresh`、`intervene`、`clear` 验收。本次只完成离线编译、`verifyBridgeLifecycle` 回归、命令格式检查与 hash 核对，真实游戏内 E2E 仍待验收（见 `AGENT-STATE://memories/acceptance-pending.md`）。
