# 当前迭代交接

更新时间：2026-09-20T16:20:00+08:00；记录者：root；状态：用户问「演示版少了点什么」，结论是**缺的不是工具而是已有资产没接线**；修掉两处真缺口（LLM 叙述面板未接前端、Minecraft 状态映射残缺），全部离线 gate 通过，新 JAR `a3d289a6...` 已安装三处；**七态配色、图例、骗子人形、叙述面板均未在现场看过**。

## 目标与范围

用户提问方向是「加什么开源工具」，但审计后给出的是相反结论：`recharts` 已装从未 import，`/api/llm/thoughts` 已接通 LLM 却无任何前端调用点。因此本轮不引入任何新依赖，只把已有资产接上并修正会误导观众的显示缺陷。

明确建议但**未做**（需用户决定）：
- **Vitest**：3190 行模拟逻辑目前零单元测试。Java 侧有 `verifyBridgeLifecycle` + 命令格式断言 + 契约脚本，TS 侧什么都没有。`calculateFraudProbability` 与 `comparison.ts` 的判定规则正是评委最会追问的地方（「是不是调参数让 guardian 赢」），却无测试保护。对现场演示无直接贡献，赛后做也行。
- **d3-force**：不建议。现用 `citizen.location` 固定坐标画 SVG 更好（可复现、不抖动），审计也要求「远看读懂」。
- **本地 LLM（Ollama 等）**：不建议。已有可用网关，换本地只在现场增加失败点。

## 本轮改动

1. **叙述面板接线**（`components/scamcity-dashboard.tsx` + `app/globals.css`）：新增「04 / CITIZEN NARRATION」面板与 `fetchThoughts`。**仅 live 模式提供**——该路由读服务端 store，而 local 模式 dashboard 跑浏览器内自己的世界，混用会让叙述描述另一座城市（本项目把这类错配当正确性缺陷）。面板显式标注 `MODEL`/`RULES`、模型名、延迟、逐条 `source:fallback`、以及「synthetic citizens, not real people」，因此模型失败降级为确定性思考时不会被误读为模型输出。
2. **七态配色 + 图例**（`BridgeController.java`）：`status()` 从「只认 victim/protected」改为按 `types/index.ts` 的 `CitizenState` 七态精确 switch（exact match 优先，避免 `contains("risk")` 这类松匹配吞掉其他状态），控制塔图例同步扩为八项（含骗子紫）。
3. **骗子人形化**（`addScammerStand`）：`style people` 原先只作用于市民。新增紫甲 + 主手 `writable_book`；手持物件是必要的，市民也人形化后单靠甲色在远处分不出身份。字段改名 `humanoidCitizens` → `humanoidFigures`。
4. **删除死代码**：旧分支按 `riskScore`/`risk`/`score` 判「高风险」橙色，但市民 payload 从无这些字段（实际是 `riskAwareness`），该分支永不触发、只可能误标。
5. **断言强化**（`verify-command-format.mjs`）：新增跨语言词表绑定（从 TS union 解析后逐态要求 Java 有显式分支、块颜色互不重复、不得复用骗子紫、图例必须含全部七标签）；把原「双标签 summon 必须正好 3 处」的硬编码计数改写为遍历所有 `summon` 模板的不变量；新增命令长度断言（按最宽取值渲染后 <250）。

## 已观察事实（本轮）

- `/api/llm/thoughts` 实测 `mode:live, model:deepseek-v4-flash, latencyMs 7687`，2 个市民；`citizen-030` engine=`ignore`, p=0.599，叙述与引擎判定一致。
- 该局 100 市民状态分布实测：`safe 89 / victim 5 / suspicious 3 / trusted 2 / engaged 1`。修前有 1 个 `engaged` + 2 个 `trusted` 被画成绿色「安全」。
- 骗子实际只有 5 个（渲染上限 12），故盔甲架总数 100 → 105，非之前估的 112。
- 骗子盔甲架命令实测最长 154 字符（`sc_s11` + 8 位染色值），远低于 256 协议上限。
- `bridge-harness/verify.mjs` 报 `full marker commands: 105`，确认骗子人形路径进入 diff 流。
- 全部离线 gate 通过：`tsc --noEmit` OK、`gradlew --offline check` PASS、`verify-command-format.mjs` PASS、`bridge-harness/verify.mjs` passed、契约脚本对 live server OK。
- `clean build` 连续两次 hash 一致 `a3d289a62a27970fc46b3a9d3e805b445636dc55859de3f768004895434313f4`；三处已同步，旧 JAR（`d4bbcb2e...`）备份在 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-statecolors-20260920-162030.jar`。安装时 `tasklist` 确认 `javaw` 计数 0。
- 已 curl 确认页面真的渲染出面板（`CITIZEN NARRATION` / `thoughts-panel`），且 local 模式正确显示说明文案而非按钮。

## 自查与修正

1. **自己引入的 React 缺陷（已修）**：初版 `fetchThoughts` 用 `thoughtsBusy` state 做重入保护并把它放进 dep array。state 更新是异步的，两次快速点击可在首次 re-render 前都通过检查；放进 dep array 还让回调身份在飞行中变化。已改为 `thoughtsRequestRef` ref 守卫（与同文件其他 live 回调一致）并移出 dep array。
2. **工具误判已更正**：首次负向测试报「missing state passed」，实为 `python3` 是 Microsoft Store 存根、脚本从未执行。改用 Node 写探针后确认两条新断言真实生效（去掉 slot tag / 删掉 `trusted` 分支都被抓住，恢复后通过）。此前结论是假阴性，不是断言漏洞。
3. **`clicked` 配色返工**：初选 `magenta_concrete`，与骗子 `purple_concrete` 远看同色，已改 `pink_concrete`；同时补回图例里被我漏掉的骗子项。
4. **`npx next lint` 未纳入 gate**：本仓未配置 ESLint，该命令会交互式索要创建配置并挂住。未代为创建（会新增 dev 依赖与配置文件）。要纳入 gate 需先显式配置。

## 审查发现与待办

1. **七态配色现场未验**（本轮最大缺口）：`engaged`/`trusted`/`clicked` 三色故意与网页的三档橙色发散（6px SVG 圆点可行，但 100 格网格远看会糊成一片），拉开为黄/橙/粉。**远看可辨性属观感，未测量**。
2. **骗子人形现场未看过**，105 个盔甲架帧数未测。默认仍为色块。
3. **叙述面板未在浏览器里真正点过**：排版、长文本溢出、`source:fallback` 橙色标注的实际观感均未看过；45s 超时是拍的（参考值：2 市民 7.7s），4 市民真实耗时未测。
4. **叠层仍未在游戏内看过**（上轮遗留）：本轮修了面板宽度（改用 `textRenderer.getWidth` 字体实测，替代每字符 6px 估算——叠层文案几乎全中文，CJK 约 9px，估算会让文字溢出背板）。仍未现场验证。
5. **`PRODUCT_AUDIT.md` 的 P0「观众动作没有闭环」已过期**：dashboard 第 574 行已 POST `/api/simulation`，Minecraft 也有 `intervene` 子命令，这条其实已闭环。已向用户提出是否更正该文档，**用户未答复，文档未改**。
6. A-12 / A-13 / A-19 结论本轮未变动，见 `acceptance-pending.md`。

## 接手顺序

先核对产物 hash。离线验收已完成，重点是**现场验证**。两个前提照旧：profile 选 `fabric-loader-1.21.11`（**不是 `Agentcraft`**）；进世界后 `ESC` → `Open to LAN` → `Allow Cheats: ON` → `Start LAN World`（会话级，每次重进都要做）。启动服务用 `npm run serve`（不是 `npm run dev`，后者不发布端点文件）。

现场观察顺序：`/scamcity refresh`（**注意 `start` 只开 10 秒轮询，不推进模拟；推进要 POST `{"type":"run","days":1}`**）→ 看叠层文字是否超出背板 → `/scamcity style people` 看市民与骗子是否都是小人、骗子是否持书 → 观察七色是否远看可辨 → 浏览器切 LIVE API 后点一次 NARRATE。

验收范围见 AGENT-STATE://memories/acceptance-pending.md；产物基线见 AGENT-STATE://resources/artifacts.md；本轮证据见 `docs/worklogs/2026-09-20-narration-and-state-colors.md`。
