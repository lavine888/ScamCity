# ScamCity 六小时重塑审计

> 这是重塑前的发现记录。执行结果、已闭环能力和仍需现场动作见 `POST_RESHAPE_STATUS.md`。

审计范围：当前 ScamCity Web Demo、Next API、Fabric Minecraft bridge、bridge harness、空间蓝图，以及能否在现场形成一条可重复、可解释、可回退的 3 分钟展示链路。

审计时间：2026-09-19。本文只新增规划与验收文档，不修改现有源码、不写入 Minecraft 世界存档。

## 先给结论

项目应该从“一个会动的 AI 小镇”重塑成 **ScamCity / AI Society Control Room**：

> 给定同一个合成社会和同一个随机种子，先让观众看见诈骗如何穿过城市，再让观众选择一个干预，最后把同一批人的结果投影到网页控制台和 Minecraft 城市中。

当前最需要解决的不是增加更多 Agent，而是建立一条可信的单一状态链：

```text
唯一模拟状态（API store）
        ↓
网页控制台（讲故事、发出控制）
        ↓
Minecraft bridge（把状态变成空间）
        ↓
同一组 tick / eventSequence / metrics
```

目前网页组件直接在浏览器内运行 `createDemoWorld()`、`advanceWorld()` 和 `activateDemoIntervention()`；Minecraft bridge 则轮询 `GET /api/simulation`。两者不是同一个 `WorldState`。这意味着用户在网页上点击干预后，Minecraft 默认不会看到这个干预；这是现场叙事的 P0 风险。

## 已核对的事实

以下结论来自工作区文件和本轮命令，不把 README 中的目标设计当作已实现功能。

| 范围 | 已确认事实 | 证据 |
| --- | --- | --- |
| Web API | `GET /api/simulation` 当前返回 HTTP 200；seed 42 初始快照包含 100 位市民、5 个骗子、327 条社会关系、2 条初始事件，`eventSequence=2`，tick 0、Day 1 | 现场请求 `http://localhost:3000/api/simulation` |
| 模拟器 | 世界由 seed 驱动；默认 100 位市民、5 个骗子、72 ticks/day、7 天比较；事件高水位独立于截断后的 `eventFeed` 长度 | `simulation/world.ts`、`types/index.ts` |
| Web 交互 | 页面状态初始来自 `createDemoWorld()`；定时推进、干预和比较均调用本地 UI adapter | `components/scamcity-dashboard.tsx:399-507`、`components/scamcity-demo.ts` |
| API 控制面 | API 支持 `reset`、`tick`、`run`、`intervention`、`pause`、`resume`、`compare`，存储是进程内单例 | `app/api/simulation/route.ts`、`lib/simulation-api.ts` |
| Bridge harness | bridge schema 为 `scamcity.minecraft-bridge/v1`；离线 fixture 验证 100/5/4 个对象，首次同步 105 个 marker 命令，增量同步可降到 1 个 marker 命令 | `node bridge-harness/verify.mjs` 通过 |
| Fabric bridge | 目标是 Minecraft 1.21.11 + Fabric Loader 0.19.3；支持 `demo`、`refresh`、`start`、`stop`、`clear`、`status`；HTTP 超时会回退到内置离线快照 | `minecraft-bridge/README.md`、`BridgeController.java` |
| Minecraft 命令格式 | 1.21.5+ inline SNBT 格式检查通过；源码发送 `text_display`、`block_display`、`title` 命令 | `node minecraft-bridge/verify-command-format.mjs` 通过 |
| 离线回退 | bridge 的 `DemoSnapshot` 仍是一份独立的简化数据：ID 为 `C001` 形式，没有完整位置、事件 ID 和社会边；它能展示“有东西”，不能证明 Web 与 Minecraft 同步 | `minecraft-bridge/.../DemoSnapshot.java` |
| 现场诊断 | `npm run doctor` 能确认 API 与 `D:\Minecraft\mods\scamcity-bridge-0.1.0.jar`，但当前日志检查仍报告 profile line 缺失和 373 个旧 parser errors；这不是“真实 Minecraft 已验收”的证据 | `scripts/scamcity-doctor.mjs` 输出 |
| 空间蓝图 | 已定义控制塔、事件墙、干预实验室、骗子入口和安全控制台；蓝图要求稳定 ID、事件高水位和碰撞处理 | `minecraft-world/README.md`、`minecraft-world/layout.json` |

## 已实现、部分实现、未实现

### 已实现，适合保留

- 可重复的合成社会：固定 seed 可以复盘同一批市民、骗子选择和事件顺序。
- 可解释的风险因素：数字素养、风险意识、压力、冲动、信任渠道、社会证明和警告疲劳都有明确贡献项。
- 五类骗子与四类干预：覆盖故事、目标选择、家庭提醒、银行阻断、网络传播等展示所需的基本闭环。
- 事件 ID 使用 `event-${seed}-${sequence}`，不会把截断后的事件数组长度误当游标。
- Web 端有地图、事件流、损失曲线、漏斗、居民详情和七日比较，足够支撑“观察—干预—复盘”的叙事。
- Bridge 有独立 harness 和离线 fixture；这是继续重塑时最有价值的回归边界。
- 清理使用 `scamcity` 标签，具备比无选择范围的 `/kill` 更安全的回滚基础。

### 部分实现，不能在 Pitch 中当作完成

- **双端同步**：API 和 bridge 通路存在，但网页控制台仍是本地模拟器；没有统一状态源。
- **增量同步**：harness 已能生成 delta，Fabric bridge 每次刷新仍先 `kill @e[tag=scamcity]` 再重建，未使用 delta。
- **事件高水位**：harness 按事件 ID 去重；Fabric bridge 没有用 `eventSequence` 跳过重复事件，每次同步都会重新生成最近事件的文字实体。
- **空间布局**：蓝图定义了坐标和稳定碰撞策略；Fabric bridge 实际把居民按数组下标排成 10×10 网格，未使用 `layout.json` 的位置投影、区域和螺旋去重。
- **离线回退**：能避免 API 不通时黑屏，但回退快照与在线世界的 ID、事件和关系结构不同，现场容易误认为是另一套实验。
- **三分钟模式**：源码中定义了 `PresenterConsole`、3 分钟常量和观众输入的 UI 结构，但当前文件中没有找到 `PresenterConsole` 的渲染调用；已可运行的 `DEMO MODE` 仍按约 1.5 秒 + 7 个 8.5 秒阶段运行，约 1 分钟。
  > **状态（2026-09-21 就地标注）：本条前半句已过期，后半句仍成立。** `PresenterConsole` 确实有渲染调用（`components/scamcity-dashboard.tsx:963`，入口按钮在 `:958`）；presenter 模式下阶段间隔为 25.5 秒（`:926`），8 个阶段实际约 204 秒，而面板标题按 `PRESENTER_DURATION_MS=180_000` 显示 `3:00`，即**标签与真实时长有约 24 秒偏差**，尚未修正。`DEMO MODE`（非 presenter）仍是 1.5 秒 + 7 × 8.5 秒 ≈ 61 秒，「约 1 分钟」的结论成立。此处正文保留原样作为发现记录。
- **指标解释**：安全指数、信任指数和干预成本都有数值，但没有统一的“为什么这个策略胜出”判定。比较卡片按 `moneyLost` 选最佳，未同时考虑成本、误报和覆盖率。

### 未实现，必须明确为六小时增量

- Minecraft 或网页端发出的干预能回写 API 并影响同一局世界。
- 观众输入能成为结构化、可重复的外部事件，而不是只写入本地事件流。
- bridge 加载、权限、API、同步 tick、展示实体数量的现场健康检查。
- 真实 Minecraft 进程中的一次完整验收：新世界、副本世界、已加载 profile、权限和退出回滚。
- 版本化的 run manifest：seed、场景、启动时间、策略、初始快照、最终快照和比较结果可被保存并复核。

## 未考虑的高价值缺口

### P0：单一状态源缺失

> **状态（2026-09-20 就地标注）：已闭环，本节描述的是重塑前的情况。** Web 的 `LIVE API` 模式与 Minecraft bridge 现在读写同一个 API store，快照带 `schemaVersion`/`snapshotId`/cursor，两端都显示数据源（`LIVE` / `LOCAL DEMO` / `DEMO`）。详见 `POST_RESHAPE_STATUS.md` 的「已闭环」表前两行。此处正文保留原样作为发现记录，不改写；仍未验收的是双端 live 同步的现场确认（见 `AGENT-STATE://memories/acceptance-pending.md`）。

这是最高优先级。当前网页按钮不会控制 API；Minecraft 只读 API；因此“网页上看到 guardian 成功”与“Minecraft 里哪一个市民变绿”可能不是同一事件。

六小时内应把 API store 设为唯一现场状态源。网页改为 API client，Minecraft 继续轮询同一 API；本地 adapter 只保留为明确标注的离线回退。每次状态应带 `runId`、`seed`、`tick`、`eventSequence` 和 `source=live|offline`，控制台和 Minecraft HUD 同时显示。

### P0：观众动作没有闭环

> **状态（2026-09-20 就地标注）：已闭环，本节描述的是重塑前的情况。** `components/scamcity-dashboard.tsx` 的干预按钮已 POST `/api/simulation`，Minecraft 侧 `/scamcity intervene social-guardian` 等五个受限命令亦走同一 API。详见 `POST_RESHAPE_STATUS.md` 的「已闭环」表。此处正文保留原样作为发现记录，不改写；仍未验收的是双端 live 同步的现场确认（见 `AGENT-STATE://memories/acceptance-pending.md`）。

“干预实验室”现在主要是网页本地按钮；Minecraft 端没有 `intervene` 子命令，也没有把四个站点变成可触发的操作。若现场只展示漂亮地图，观众看不到“我做了决定，城市因此改变”。

最小闭环只需要一个可控动作：`social-guardian`。网页按钮、Minecraft `/scamcity intervene social-guardian` 或一个操作台都应发同一个 API POST；API 返回新的 `tick/eventSequence/metrics`；两个展示面在同一事件上更新。其他策略可以保留为比较结果，不必在六小时内全部做成 Minecraft 交互。

### P0：真实运行状态不可判定

> **状态（2026-09-20 就地标注）：大部分已闭环，本节描述的是重塑前的情况。** `npm run doctor` 给出三态 readiness（API schema/实体数、JAR 实测 hash、Minecraft 日志与 parser error），`npm run report` 产出 run-manifest 与 comparison 摘要；bridge 侧另有屏幕叠层显示数据源与 verdict。详见 `POST_RESHAPE_STATUS.md` 的「现场报告」行。**仍成立的部分**：`doctor` 的 `minecraft-log`/`command-errors` 读 `latest.log`，新装包后它们只证明上次加载成功；`command-errors` 在零命令发出时是空过的；无副作用权限探针仍未实现（见 `AGENT-STATE://memories/pitfalls.md`）。此处正文保留原样作为发现记录，不改写。

现有 `status` 只报告“运行中/已暂停、HTTP/离线演示、队列长度”，不能告诉操作员：模组是否加载、API 是否可达、上次快照 tick、实体是否成功生成、是否有权限执行 `/summon`、是否发生 parser error。`doctor` 也会把旧日志中的错误混在当前状态里。

现场必须有一个红绿三态的 readiness gate：

1. API：HTTP 200、schema、100/5、seed/runId。
2. Minecraft：目标版本、bridge loaded、权限可执行一条无副作用探针命令。
3. Sync：最近快照时间、tick、eventSequence、source、已渲染市民数。
4. Recovery：`clear` 后可以重新渲染；失败时可以只展示网页离线模式。

### P1：空间表达与数据表达不一致

蓝图希望展示真实模拟位置、区域、中心性和事件关系；当前 Fabric bridge 使用下标网格且每位居民生成一个方块和一个悬浮文字，远看会变成密集的文字墙。harness 的 risk score 也没有直接进入 Fabric bridge；初始 API 市民没有 `riskScore` 字段时，游戏端主要按 `state` 显示。

六小时内应优先做到“远看读懂、近看可追踪”：默认只显示色块和 hub 环，选中或最近事件的市民才显示文字；控制塔显示图例；事件墙只保留高水位后的 5–8 条；市民以 `citizen.id` 投影并做稳定碰撞处理。

### P1：指标容易被评委误读

所有指标都是合成模拟量，这是项目的优点也是必须主动解释的边界。当前 safety index 没有把 false positives 和 intervention cost 直接扣除；比较页面的“最佳”主要按损失排序；研究发现中的网络 evidence 也使用了简化叙述。若不修正，评委会追问“你们是不是调参数让 guardian 赢”。

推荐把结果改成三栏：`impact`（victims / loss）、`friction`（false positives / warnings）、`cost`（interventionCost），并给出一条可重复的主判定：

```text
优先级 = 少损失 → 少受害 → 可接受误报 → 成本可解释
```

Pitch 中只说“这个 seed 下的 modeled outcome”，不说“准确率”或“真实世界下降了多少”。

### P1：观众输入没有结构化契约

“GPT-7 发布”“银行宕机”“AI 监管升级”都很有戏剧性，但当前世界模型没有外部事件类型、强度、持续时间或受影响的策略；随意把文本塞进 event feed 不会改变行为。六小时内只定义 3 个白名单事件即可：

- `bank-outage`: 强化 fake-customer-service 和 authority-scam 的目标选择。
- `deepfake-voice`: 强化 impersonation 的社会证明。
- `market-panic`: 强化 fake-investment 的压力与金额。

自由文本只作为显示文案，真正影响模拟的字段必须是结构化事件，且写入事件 ID 和 run manifest。

### P2：运行、许可和回滚文档分散

工作区的 staging manifest 写着 `staged-only`，而诊断脚本默认检查 `D:\Minecraft\mods`；bridge README 又描述了另一套安装边界。用户在现场只需要一页“现在到底从哪里启动、哪个世界、如何清理、如何回滚”。应把安装目录、profile、API 地址、权限前提和回滚步骤集中到 runbook，并把 repo 事实与机器现场事实分开。

## 推荐的重塑边界

六小时内只承诺四个可被看见的能力：

1. **A city**：100 个合成市民、5 个诈骗 Agent、可读的颜色和控制塔。
2. **A threat**：同一 seed 下发生一个可观察的诈骗事件，事件 ID 和 tick 在 Web/Minecraft 一致。
3. **An intervention**：观众触发 Social Guardian，某一位市民从风险色变成 protected，并产生一条 guardian 事件。
4. **A decision**：同 seed 复盘 baseline 与 guardian，展示 victims、loss、warnings、false positives、cost，并解释这是合成实验结果。

这四个能力跑通后，再加 bank agent、network intervention、外部事件和更复杂的建筑。顺序不能反过来。

## 六小时执行编排

| 时间 | 目标 | 必须产出 | 通过条件 |
| --- | --- | --- | --- |
| 00:00–00:30 | 锁定实验 | 固定 seed、runId、主策略 Social Guardian、三条演示事件、截图基线 | 所有人使用同一份场景 manifest；没有“临场随机讲故事” |
| 00:30–01:30 | 统一状态源 | API 作为 live world；网页和 bridge 读取同一快照；明确 offline 标志 | 网页按钮改变 API 后，下一次 GET 的 tick/eventSequence/metrics 改变 |
| 01:30–02:30 | 观众动作闭环 | `intervention` 和一个结构化 `inject-event` 控制；成功/失败返回原因 | API POST → event → Web/Minecraft 同步；重试不重复事件 |
| 02:30–03:30 | Minecraft 可读性 | 稳定 ID 投影、hub 标识、控制塔 HUD、事件墙、有限文字 | 100 个市民不跳位；刷新不清除非 ScamCity 实体；远景 5 秒内看懂图例 |
| 03:30–04:15 | 健康与回退 | readiness gate、离线 demo、权限错误、API 超时提示 | API 关闭时仍能演示，且画面明确标注 DEMO/OFFLINE |
| 04:15–05:00 | 指标与证据 | baseline/guardian 同 seed 报告；影响/摩擦/成本三栏 | 评委可以从 run manifest 重放结果；不使用“预测准确率”措辞 |
| 05:00–06:00 | 现场排练 | 3 分钟脚本、QA 卡、截图/录屏、回滚演练 | 连续 3 次从干净状态成功；任何一次失败都有网页-only fallback |

若只剩 90 分钟，砍掉外部事件、四个 Minecraft 干预台和动态关系线，保留 API 单一状态源、Social Guardian 一键闭环、控制塔 HUD、离线回退和 3 分钟脚本。

## 不能在现场声称的内容

- 不能说模型预测了真实个人或真实诈骗概率。
- 不能把 HK$ 金额当成现实部署成本；当前 intervention cost 是抽象比较单位。
- 不能把离线快照当成 live API 结果。
- 不能把 Web UI 和 Minecraft 的两个独立状态称为“同步”，除非 P0-1 通过。
- 不能用一次 seed 的最佳结果证明某策略普遍最优；至少要说明 seed、时间窗和比较口径。
