# ScamCity 重塑验收矩阵

> 本文件保留重塑前的基线状态，便于回看为什么要改造。重塑后的证据和当前结论见同目录的 `POST_RESHAPE_STATUS.md`；不要把下表的旧 FAIL 直接当成最终实现状态。

状态含义：

- **PASS**：已有命令或代码证据通过，仍需在目标现场保持。
- **PARTIAL**：有一部分实现或离线证据，真实链路尚未闭合。
- **FAIL**：当前行为不能满足验收条件。
- **TARGET**：六小时重塑后必须达到的退出条件。

## 事实与功能矩阵

| ID | 优先级 | 验收项 | 当前状态 | 当前证据 | 退出条件 |
| --- | --- | --- | --- | --- | --- |
| A-01 | P0 | API 基础快照可用 | PASS | GET 返回 200、100 citizens、5 scammers、seed 42、eventSequence 2 | readiness gate 每次打印 URL、runId/seed、tick、eventSequence |
| A-02 | P0 | Web 与 Minecraft 使用同一状态源 | FAIL | Web 从 `createDemoWorld()` 本地推进；bridge 读取 GET API | Web 控制导致 API 快照改变，Minecraft 随后显示同一 tick 和事件 |
| A-03 | P0 | 干预能形成闭环 | FAIL | API 有 `intervention` 命令，Minecraft 没有回写命令；Web 只改本地 world | 触发 Social Guardian 后，API 返回事件，Web/Minecraft 同时出现 protected 状态 |
| A-04 | P0 | 观众事件有结构化契约 | PASS（离线） | `simulation/audience-events.ts` 白名单声明 `affectedStrategies` 与上限；契约脚本断言受影响策略出现 `audience-incident` 因子 28 条、白名单外 0 条、同 seed 同事件序列复盘一致 | 白名单事件包含 type、duration、affectedStrategies、event ID；自由文本不改数值 |
| A-05 | P0 | live/offline 状态显式可见 | PARTIAL | bridge API 失败会回退 `DemoSnapshot`；Web 有离线提示相关结构 | 两端都显示 `LIVE` 或 `OFFLINE DEMO`，且 run manifest 记录 source |
| A-06 | P0 | Minecraft profile 与 bridge 真实加载 | PARTIAL | JAR 存在；`npm run doctor` 可检查 JAR，但日志报告 profile line 缺失及 373 个旧 parser errors | 重启目标 profile 后日志证明 bridge loaded，parser errors=0，使用新鲜日志而非历史尾部 |
| A-07 | P0 | 执行权限可判定 | FAIL | 当前仅在命令失败后显示发送失败；没有无副作用探针和权限状态 | readiness gate 能区分未加载、无权限、API 不通、命令队列失败 |
| A-08 | P0 | 干净世界可重复启动 | PARTIAL | `/scamcity clear` 只清理 `tag=scamcity`；蓝图禁止写入存档 | 在副本/测试世界连续执行 clear → render → clear，不删除非 ScamCity 实体 |
| A-09 | P0 | 三分钟主流程可连续完成 | PARTIAL（见下方更正） | `DEMO_STEPS` 有 8 个阶段；当前可见 DEMO MODE 约 1 分钟，PresenterConsole 未找到渲染调用 | 180±10 秒内完成 setup → threat → baseline → intervention → comparison → takeaway |
| A-10 | P1 | 同 seed 可复盘 | PARTIAL | 世界使用 `SeededRandom`；比较在相同 seed 创建新世界 | 同 seed、同设置产生一致事件序列和指标；不同策略只有预期条件差异 |
| A-11 | P1 | 事件 ID 唯一且增量安全 | PASS/PARTIAL | `node bridge-harness/verify.mjs` 通过 4 个唯一事件、增量新事件 1 个；Fabric bridge 不使用高水位 | bridge 保存 `lastEventSequence`/event IDs，重复轮询不重复广播或重建事件 |
| A-12 | P1 | 增量更新不闪烁 | PASS（离线）/ 现场部分见证 | 新增 `Scene` 按 slot 双标签寻址（`scamcity` + `sc_c<cell>`）；`SceneQueue` 以最后一次完整渲染帧为基准算 delta。离线回归断言：满编 100 格城市单个市民状态变化只发 3 条命令（原为全量 102 条），仅指标变化不触碰任何实体，重排快照零重绘。**2026-09-20 08:20 真机日志**首次出现 `增量基准 已建立 / 已发送 450 条 / 跳过 3 帧`，证明 delta 基准与跳帧在游戏内生效；但该帧来自 `离线演示` 数据源，且「不闪烁」仍是观感未测量 | 一次初始 full sync 后，单 citizen 变化只更新该 citizen；无明显清屏/重建闪烁 |
| A-13 | P1 | 市民位置按稳定 ID 投影 | PARTIAL | `CitizenGrid` 已用 `citizen.id` 的 FNV-1a + 排序去重 + 线性探测取代数组下标，离线回归覆盖乱序/逆序/重复/超容/非 ASCII；**`layout.json` 外部布局未实现**，真机不跳位未验收 | 位置来自 `layout.json` 公式；同一 ID 跨 refresh 不跳位；碰撞按稳定哈希解决 |
| A-14 | P1 | Web/Minecraft 状态颜色语义一致 | PARTIAL | Web 有 7 个 state 色；bridge 主要按 state/risk 兼容字段映射；API 初始市民无 riskScore | 图例只定义一套颜色；同一 citizen 的状态、颜色和 label 在两端一致 |
| A-15 | P1 | 远景可读性 | PARTIAL | 当前每位市民生成 block_display + text_display；最多 100 位市民，可能造成文字拥挤。**2026-09-20 新增 `/scamcity style people`**：市民可改为染色皮革盔甲架（人形轮廓，状态色不变），默认仍为色块；单市民命令数 2 → 6，状态变化增量 3 → 7 条。文字拥挤未解决，100 个盔甲架的帧数代价**未测量** | 默认色块/hub 环；只为选中或最近事件显示文字；评委从 10 秒远景看懂状态 |
| A-16 | P1 | 控制塔显示核心指标 | PARTIAL | bridge 有居民、骗子、money 和 actionbar；蓝图规划 victims/loss/safety/tick | 控制塔同时显示 day/time、tick、citizens、agents、victims、loss、safety、source |
| A-17 | P1 | 事件墙按高水位更新 | PARTIAL | bridge 显示最近 5 条 eventFeed；harness 以 event ID 去重 | 新事件只追加一次；eventFeed 截断后仍不会漏报或重复；danger/success 有视觉效果 |
| A-18 | P1 | 关系与 hub 可见 | PARTIAL | Web 有 327 edges 和 5 hubs；离线 DemoSnapshot social graph 不完整；Minecraft bridge 不画关系边 | 至少显示 5 个 hub；关系边可选，不能遮挡 100 个市民；离线模式明确“简化图” |
| A-19 | P1 | 指标口径不会误导 | PASS（离线） | `simulation/comparison.ts` 输出 impact / friction / cost 三栏，`bestComparison` 与 API `verdict`、网页卡片共用一条判定规则（少损失 → 少受害 → 可接受误报 → 成本可解释）并显示理由与 synthetic 声明 | comparison 分开 impact/friction/cost；标题使用 “modeled outcome”；统一 best 规则并显示原因 |
| A-20 | P1 | 研究发现与数据一致 | PARTIAL | `generateResearchFindings()` 从 interactions/comparison 生成文字 | 每条 finding 带 seed、时间窗、分母/样本数；样本不足时显示 insufficient evidence |
| A-21 | P1 | 离线回退可完成主故事 | PARTIAL | API 异常会进入 `DemoSnapshot`；fixture 只含简化数据且关系为 0 | API 关闭时 Web/Minecraft 都能完成一条短演示，并明确 `OFFLINE DEMO`；不冒充 live |
| A-22 | P1 | API 重启边界可见 | PASS/KNOWN LIMITATION | API store 是进程内存储，README 已说明重启即丢失 | readiness gate 检测 reset；run manifest 可保存/导入最近一次排练 |
| A-23 | P1 | 版本与安装文档一致 | PARTIAL | staging manifest 标注 staged-only；doctor 默认检查 `D:\Minecraft`；多个 README 的安装表述不同 | 一页 runbook 明确 profile、gameDir、mods、API URL、备份和回滚；安装状态由机器事实确认 |
| A-24 | P2 | 命令/网络负载有预算 | FAIL | Fabric 每 tick 最多发送 8 条命令；full sync 约 100×2 + 其他实体，但没有现场耗时指标 | 记录 full/delta 命令数、完成耗时、队列峰值；在目标机器上不阻塞操作和镜头 |
| A-25 | P2 | 运行日志可诊断 | PARTIAL | `scripts/scamcity-doctor.mjs` 能检查 API、JAR、日志，但旧日志统计会污染判断 | 每轮生成带时间戳的 log/run manifest；错误分类为 API、模组、权限、版本、命令格式 |
| A-26 | P2 | 真实 Minecraft E2E 验收 | FAIL | 当前只通过构建、命令格式和离线 harness；没有本轮 fresh world E2E 证据 | 新鲜副本世界中：加载、demo、refresh、start、intervene、stop、clear 连续通过 |
| A-27 | P2 | 安全边界成立 | PASS/PARTIAL | 代码使用 `scamcity` 标签；蓝图禁止读账号、改存档和杀未标记实体 | 现场脚本不读取账号/真实数据；所有清理范围可审计；失败不覆盖用户建筑 |
| A-28 | P2 | 伦理与产品边界可回答 | PASS | README 声明 synthetic、decision-support sandbox、非预测工具 | Pitch 和 QA 卡始终包含 synthetic、seed、时间窗、非生产声明 |

### 对 A-09 的更正（2026-09-21）

上表 A-09 的「PresenterConsole 未找到渲染调用」是错的：该组件在 `components/scamcity-dashboard.tsx:963` 被渲染，入口按钮在 `:958`。更正后的现场事实：

- `DEMO MODE`（非 presenter）：1.5 秒 + 7 × 8.5 秒 ≈ 61 秒。
- `3-MIN PRESENTER`：8 个阶段 × 25.5 秒 ≈ **204 秒**，而面板标题按 `PRESENTER_DURATION_MS=180_000` 显示 `3:00`——**标签与实际时长不符，是当前未修的缺陷**。
- presenter 模式与 `LIVE API` 互斥：`:958` 的按钮在 live 模式下 disabled，`startPresenter`（`:829`）会提示 “PRESENTER MODE is local-only.”，即 presenter 只是 local 演示的计时外壳，不能用于双端 live 同步。

### 必须通过（P0）

- A-01、A-02、A-03、A-05、A-06、A-07、A-08、A-09。
- 任意 P0 失败时，现场自动降级到 Web-only 或明确 OFFLINE DEMO，不宣称双端 live。
- 只允许一个主交互：Social Guardian；其余策略可在 comparison 中展示。

### 尽量通过（P1）

- A-10、A-11、A-12、A-14、A-15、A-16、A-17、A-19、A-21、A-23。
- 如果空间时间不够，优先控制塔、色块、hub、事件墙；关系边和动态建筑可以取消。

### 可以延后（P2）

- A-24 的深度性能采样、A-25 的完整日志系统、A-26 的多世界回归、A-27 的长期安全审计。
- 这些项目必须有“未完成”记录，不能用离线 harness 结果代替真实 E2E。

## 最小发布包

六小时结束时，交付目录应能回答以下问题：

```text
evolution/
  PRODUCT_AUDIT.md          发现了什么、为何重塑
  DEMO_SCRIPT.md            180 秒怎么讲、失败怎么退
  ACCEPTANCE_MATRIX.md      什么算通过、证据在哪里

run-manifest.json           seed/runId/source/tick/策略/事件
readiness-report.json       API/JAR/日志/权限/同步状态
comparison.json             baseline 与 guardian 的可复核结果
screenshots/                clean/baseline/intervention/comparison/fallback
```

最后一道验收不是“页面能打开”，而是操作员能在 30 秒内回答：当前是哪一局、哪一个 seed、哪一个状态源、Minecraft 是否真的同步、如果失败应该怎么继续。
