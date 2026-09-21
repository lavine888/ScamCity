# 2026-09-20 按槽位增量渲染（A-12）

## 范围

把 Minecraft bridge 的刷新从「整城重建」改为「按槽位算 delta」，并补离线回归。对应验收矩阵 A-12（原状态 PARTIAL）。同一轮还在 Web 侧关闭了 A-04、A-19，记录在 `evolution/POST_RESHAPE_STATUS.md`。

## 问题

`applySnapshot` 每次都先 `kill @e[tag=scamcity]`，再把控制塔、100 个市民、骗子、事件墙全部重新 `summon`。后果：

- 单个市民状态变化要发 ~105 条命令，其中 102 条是把没变化的东西原样重画；
- 每批开头的全量 kill 会让整座城市短暂消失，也就是矩阵里记的「清屏/重建闪烁」；
- `COMMANDS_PER_TICK = 8` 意味着一次全量刷新要跨十几个 tick 才排空，闪烁窗口被拉长。

`SceneQueue` 原本已经能做**帧合并**（快照来得比队列排空快时丢掉中间帧），但它持有的是扁平的 `List<String>`，只能整帧比较「相同/不同」，无法表达「只有第 42 格变了」。

## 实现

新增 `minecraft-bridge/src/main/java/com/baytech/scamcity/bridge/Scene.java`：

- 一帧从扁平命令列表变成 `LinkedHashMap<槽位标签, 命令列表>` 加一段 `trailing`（actionbar，不是实体）；
- 每个展示实体带**两个**标签：共享的 `scamcity`（保证 `/scamcity clear` 仍能一次清干净）和自己的槽位标签，后者让单个标记可被单独 `kill`；
- 槽位标签按位置而非 id 命名（市民 `sc_c<cell>`、骗子 `sc_s<i>`、事件行 `sc_e<i>`、控制塔 `sc_h<i>`）。用 cell 而不是 citizen id 是有意的：id 可能是非 ASCII 或超长，而 cell 已经是 `CitizenGrid` 对该 id 的稳定投影；
- `deltaFrom(previous)` 先 kill 消失的槽位（缩编名单不留孤立标记），再逐槽替换有差异的，未变化的槽位一条命令都不发；`fullSync()` 保留为恢复路径；
- 超长命令过滤从 `BridgeController` 移到入场前（`add(...)`），这样场景记录的内容与真正发出去的内容一致，delta 才不会骗人。

`SceneQueue` 改为持有 `Scene`，并区分两种状态：`active`（正在排空）与 `rendered`（已完整渲染完，可作 delta 基准）。基准绝不取渲染中途的帧——批次在飞行途中时画面处于两帧之间。世界切换、`/scamcity clear`、`/scamcity stop`、命令发送失败都会丢弃基准，下一帧自动退回全量同步。手动 `refresh` 也刻意走全量：操作者请求重绘通常正是因为怀疑画面已漂移。

控制塔拆成 4 个槽位，所以指标变化不会连带重画静态图例和底座。

`/scamcity status` 增加显示增量基准是否已建立、累计已发送命令数、跳过的帧数。

## 已执行

- `./gradlew clean build` 通过（含 `verifyBridgeLifecycle`），输出 `PASS: request lifecycle, scene diffing, scene queue and citizen grid regressions`
- 新增 delta 回归断言，把「不闪烁」写成数字：
  - 满编 100 格城市，单个市民状态变化只发 3 条命令（`kill @e[tag=sc_c42]` + 两条 summon + 指标行），而全量是 102 条
  - 仅指标变化不触碰任何实体（只发 `title`）
  - 重排但内容相同的快照零重绘
  - 删除的槽位会被 kill；新增的槽位直接 summon，不发多余的 kill
  - 渲染中途的帧绝不作为 delta 基准（活跃帧先排空，新帧再对它算差异）
  - `reset` / 发送失败后重试退回全量同步
  - 手动重绘不信任已渲染状态
- `node minecraft-bridge/verify-command-format.mjs` 通过；新增断言锁住双标签结构（两个展示实体都必须带槽位标签、单标签形式不得回归、kill 命令必须集中在 `Scene`）
- 产物可复现：连续两次 `clean build` 的 SHA-256 均为 `243d4dfe9784fb6bad36136992f3cefe86bdcca9c7cb9e6923f44f1f54b481cc`
- 安装前确认无 Minecraft / javaw 进程；新 JAR 已同步到 `minecraft-bridge/build/libs`、`minecraft-staging/mods/`、`D:\Minecraft\mods\`，三处 hash 一致
- 回滚备份：`D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-incremental-render-20260920-012603.jar`（内容为上一基线 `16f0d4ad...`）
- readiness gate 复跑：`npm run doctor`（api PASS、bridge-jar PASS `243D4DFE…`，两个 WARN 都是「未启动目标 profile」的预期状态）、`npm run report` 全 PASS（`evolution/runs/2026-09-19T17-27-06-932Z/`）、`node scripts/verify-simulation-contract.mjs` OK、`node bridge-harness/verify.mjs` passed
- 验证后已关闭临时服务，端口 3000 与 3007 均已释放

## 过程中的一次自我修正

最初写的断言是「slot 顺序属于帧身份」，跑回归时失败。原因是 `Scene.equals` 基于 `Map.equals`，按条目集合比较，对插入顺序不敏感。这里**代码是对的、断言是错的**：顺序无关正是想要的语义，与 `CitizenGrid` 既有的「只依赖 id 集合」设计一致，否则重排但内容相同的快照会白重绘一次。已改为断言「重排但内容相同的帧零重绘」。

## 边界与未完成

- **真实游戏内未验收**：以上全是离线编译、回归与磁盘证据。闪烁是否真的消失、队列耗时是多少，仍需重启 Fabric profile 后在世界里观察。A-12 只能算离线 PASS。
- **未测量队列耗时**：断言的是命令条数，不是毫秒。命令条数下降是闪烁下降的必要条件，不是充分证明。
- **delta 假设「世界只被 bridge 改动」**：如果玩家手动 kill 掉某个展示实体，bridge 会认为它还在，直到下一次全量同步才恢复。缓解手段是 `/scamcity refresh` 始终走全量。
- **无 id 的 payload** 仍退化为 `index-<i>` 键（沿用上一轮边界，本轮未改）。
- **`layout.json` 仍未实现**，A-13 依旧不能宣称按原文完全关闭。
- **权限阻塞未变**：存档 `allowCommands=0`，需用户在 GUI 执行 `Open to LAN` → `Allow Cheats: ON` → `Start LAN World`，Agent 无法代做。在此之前 `summon` / `kill` 仍会被拒，增量渲染在真机上也无从观察。
