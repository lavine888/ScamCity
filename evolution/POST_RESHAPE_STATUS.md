# 重塑后状态

这份状态表记录六小时自主重塑完成后的证据，`PRODUCT_AUDIT.md` 和 `ACCEPTANCE_MATRIX.md` 保留为重塑前的基线审计。

## 已闭环

| 能力 | 当前行为 | 证据 |
| --- | --- | --- |
| API 唯一 live 状态源 | Web 的 `LIVE API` 模式读取同一快照，并把 reset/tick/run/pause/resume/intervention/compare 发回 API；Minecraft bridge 继续轮询该 API | `components/scamcity-dashboard.tsx`、`node scripts/verify-simulation-contract.mjs` |
| 状态可追踪 | 每个快照带 `schemaVersion`、`snapshotId`、revision/tick/eventSequence cursor；页面和 `/scamcity status` 显示元数据 | API 生产服务返回 200；bridge 静态检查通过 |
| 观众事件 | `bank-outage`、`deepfake-voice`、`market-panic` 白名单；`eventId` 幂等；事件出现在 `world.audienceEvents`、顶层 `activeEvents` 和 eventFeed | 契约脚本覆盖合法、非法、重复请求 |
| Minecraft 干预回写 | `/scamcity intervene social-guardian` 等五个受限命令 POST API，并以响应快照刷新空间 | `minecraft-bridge/verify-command-format.mjs`、Gradle build |
| 离线可回退 | Web 明确显示 `LOCAL DEMO`；Minecraft `/scamcity demo` 显示 `DEMO`，回退快照补齐 schema、cursor、seed、tick 和稳定 ID | `DemoSnapshot.java`、生产构建 |
| 现场报告 | `npm run doctor` 检查 API/JAR/日志；`npm run report` 生成 run-manifest、readiness 和 comparison 摘要 | `scripts/scamcity-doctor.mjs`、`scripts/scamcity-report.mjs` |

## 已验证

- `npm run typecheck` 通过。
- `npm run build` 通过；生产路由包含 `/api/health` 和 `/api/simulation`。
- 生产服务 `http://localhost:3002`：首页 HTTP 200，页面包含 `3-MIN PRESENTER` 和 `STATE SOURCE`；健康接口 HTTP 200。
- `node scripts/verify-simulation-contract.mjs` 通过：同 seed、暂停 no-op、长运行日期、非法命令、观众事件幂等均通过。
- `node bridge-harness/verify.mjs` 通过：100 citizens、5 scammers、唯一事件、delta 计划均通过。
- `node minecraft-bridge/verify-command-format.mjs` 通过；Fabric Gradle build 通过。
- 最终 bridge JAR 已复制到 `D:\Minecraft\mods`，SHA-256 为 `BCF2FE7F43473BBF384C5F37822BBBBF13A1D908A4669B43E976AD6C124708DF`，旧版本保存在 `D:\Minecraft\.codex-backups`。
- （2026-09-19 15:57 更新）刷新稳定性改造后重新构建的 JAR SHA-256 为 `a223c206caebbb9c5d2c6a6fa58a7dd49d1f711e10b825c03681ed40dc99b7e8`，已同步到 `minecraft-staging/mods` 与 `D:\Minecraft\mods`，旧 JAR 备份在 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-refresh-stability-20260919-155735.jar`。离线 `verifyBridgeLifecycle` 回归与命令格式检查通过；真实游戏内 E2E 仍未验收（证据：`docs/worklogs/2026-09-19-bridge-refresh-verification.md`）。
- （2026-09-19 16:53 更新）市民布局已从数组下标改为按 `citizen.id` 稳定投影（新增 `CitizenGrid`，FNV-1a + 排序去重 + 线性探测，按 cell 序发命令）。JAR SHA-256 变为 `7adfb50962f51f98ed44ecf5000084ecce632712e32c1e15df27ea50aec13c41`（连续两次 `clean build` 一致），已同步到 `minecraft-staging/mods` 与 `D:\Minecraft\mods`，旧 JAR 备份在 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-stable-grid-20260919-165331.jar`。新增 10 项离线回归通过，并对真实 live API 的 100 个 id 复算为 100 个互不相同的 cell；readiness gate（doctor/contract/report/bridge-harness）全部通过。这关闭了验收矩阵 A-13 的「同 ID 跨 refresh 不跳位」与「碰撞按稳定哈希解决」，但退出条件中的 `layout.json` 外部布局文件**未实现**，且真实游戏内不跳位仍未验收（证据：`docs/worklogs/2026-09-19-stable-citizen-grid.md`）。
- （2026-09-19 17:43 更新，**首次真机运行**）模组已确认可在 Fabric 1.21.11 / Loader 0.19.3 下加载（17:16:56 日志 `ScamCity bridge loaded`）。现场发现并修复了一个离线验收无法发现的缺陷：`BridgeController` 的 `HttpClient` 未指定版本，JDK 默认 HTTP/2 会对明文 `http://` 尝试 h2c 升级，Next.js dev server 不应答而直接断开，导致 `/scamcity refresh` 持续回退离线演示并报 `IOException: HTTP/1.1 header parser received no bytes`（且请求从未进入服务端日志）。已固定为 `HTTP_1_1`；Java 探针连跑 5 次结果零偏差（HTTP_2 必败、HTTP_1_1 必成 200 / 130191 字节），且 `ProxySelector` 返回 `[DIRECT]` 排除了系统代理。JAR SHA-256 变为 `16f0d4adc0f7d0d0585325ccabcf86cb7b98cf34e63984820ae4ae63002a7287`（两次 `clean build` 一致），已同步三处，旧 JAR 备份在 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-http1-20260919-174311.jar`，readiness gate 全部通过。**但修复后的 JAR 尚未在游戏内跑过**，且命令权限仍被存档 `allowCommands=0` 阻断（需用户在 GUI 开 `Allow Cheats`，Agent 无法代做），故 A-02/A-03 的双端 live 闭环仍不得宣称成立（证据：`docs/worklogs/2026-09-19-http1-fix-and-live-attempt.md`）。

- （2026-09-19 本轮更新，**模型口径改造，仅离线验收**）关闭了审计中两个与真机无关的缺口：
  1. **观众事件从观测层变为结构化影响（A-04）**：新增 `simulation/audience-events.ts`，三个白名单事件各自声明 `affectedStrategies` 与有上限的效果；受影响策略的消息会带 `audience-incident` 风险因子（与数字素养、压力、信任并列显示），白名单外策略不受影响，并发事件按上限截断，`market-panic` 另有 1.25× 金额乘数。金额乘数在种子抽样之后应用，因此同 seed 的决策序列不变。调用方 `label` 仍只作显示文案。
  2. **比较口径统一（A-19）**：新增 `simulation/comparison.ts`，输出 impact（victims/loss）、friction（false positives/warnings）、cost 三栏，并把「最佳」收敛为一条带理由的判定（少损失 → 少受害 → 可接受误报 → 成本可解释）。`bestComparison` 改为调用该规则；API 快照新增 `verdict` 字段；网页比较卡片不再自行按 `moneyLost` 排序，并显示规则、理由与 synthetic 声明。

  证据：`npm run typecheck` 通过；`npm run build` 通过；`node scripts/verify-simulation-contract.mjs` 在生产构建（临时端口 3007）上通过，新增断言覆盖「受影响策略出现该因子（28 条）」「白名单外为 0 条」「同 seed 同事件序列复盘完全一致」「verdict 的 ranking 与 best 一致且三栏字段齐全」；`node bridge-harness/verify.mjs` 通过。**未验收**：真实游戏内未观察该风险因子与新比较口径；未做影响系数的敏感度分析。现场须称为 “modeled amplification”，不得说成真实停机/深伪对诈骗率的标定估计。

- （2026-09-20 01:26 更新，**按槽位增量渲染，仅离线验收**）Minecraft 侧不再每次刷新都整城重建。新增 `Scene`，每个展示实体同时带共享清理标签 `scamcity` 与自己的槽位标签（`sc_c<cell>` / `sc_s<i>` / `sc_e<i>` / `sc_h<i>`），因此单个标记可被单独 `kill`；`SceneQueue` 保留原有的帧合并，并额外以**最后一次完整渲染完的帧**为基准算 delta。全量同步仍保留给首帧、`anchor`、`demo` 和手动 `refresh`（手动刷新刻意不信任已渲染状态，因为操作者请求重绘通常正是怀疑画面已漂移）。

  证据：`./gradlew clean build` 通过（含 `verifyBridgeLifecycle`）；`node minecraft-bridge/verify-command-format.mjs` 通过，并新增断言锁住双标签结构不被回退；`node bridge-harness/verify.mjs`、`npm run doctor`（`READY`）、`npm run report`（`source=live` 全 PASS）、`node scripts/verify-simulation-contract.mjs` 均通过。新增的离线回归断言把「不闪烁」写成数字：满编 100 格城市单个市民状态变化只发 3 条命令（全量为 102 条），仅指标变化不触碰任何实体，重排但内容相同的快照零重绘，删除的槽位会被 kill，渲染中途的帧绝不作为基准，发送失败后重试退回全量。JAR SHA-256 `243d4dfe9784fb6bad36136992f3cefe86bdcca9c7cb9e6923f44f1f54b481cc`（两次 `clean build` 一致），已同步三处，旧 JAR 备份在 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-incremental-render-20260920-012603.jar`。**未验收**：真实游戏内未观察闪烁是否消失，也未测量队列耗时；A-12 只能算离线 PASS。

  过程中修正了一个我自己写错的断言：最初断言「slot 顺序属于帧身份」，但 `Scene.equals` 基于 `Map.equals`，对顺序不敏感。代码行为是对的（顺序无关正是期望语义，与 `CitizenGrid` 既有设计一致），已改为断言「重排但内容相同的帧零重绘」。

## 仍需现场动作
- 必须完全退出并重新启动 Minecraft 目标 profile，才能证明新 JAR 在真实进程中加载。当前 doctor 看到的是旧日志，不能把它当成新版本 E2E 证据。
- 进入世界后执行 `/scamcity clear`、`/scamcity anchor`、`/scamcity refresh`、`/scamcity status`，再执行 `/scamcity intervene social-guardian`；比较 Web 与 Minecraft 的 snapshotId、cursor 和事件。
- 权限探针、实体队列耗时和多世界 E2E 仍未完成；增量渲染已实现但只有离线证据。现场不能把离线 harness 结果说成真实 Minecraft 已验收。

## 演示决策

主路径使用固定 seed `42` 和 `Social Guardian`。若 Minecraft 重启后仍不可用，立即切换为 `LIVE API` 的 Web-only 演示；若 API 不可用，再切换为明确标注的 `LOCAL DEMO` / `/scamcity demo`。所有结果继续使用“synthetic modeled outcome”表述。
