# 2026-09-20 叙述面板接线 + 七态状态配色

记录者：root。本文只记录**实际执行过的命令与实际观察到的输出**。未运行的、未在现场看过的，都在末节明确列为未验收。

## 起因

用户问「演示版少了点什么，有什么开源工具可以完善」。审计后的结论与提问方向相反：**缺的不是工具，是已有资产没接线**。

两条支撑证据：

- `package.json` 依赖里有 `recharts 2.12.7`，全仓 `grep "from \"recharts\""` 为空——装了从未 import。
- `/api/llm/thoughts` 路由存在且 LLM 真的接通了，但全仓搜索 `api/llm` 在 `.tsx`/`.ts`（排除 `app/api/` 自身与 `.next/` 产物）中**没有任何调用点**。

## 实测：LLM 是真接线的

```
$ curl -s http://localhost:3000/api/llm/status
{"enabled":true,"hasApiKey":true,"baseUrl":"https://api.openai-next.com/v1",
 "model":"deepseek-v4-flash","timeoutMs":20000,"mode":"live"}
```

第一次调用 `/api/llm/thoughts` 用了 POST，返回空——该路由只导出 `GET`。改正后：

```
$ curl -s "http://localhost:3000/api/llm/thoughts?limit=2&concurrency=2"
{"mode":"live","model":"deepseek-v4-flash","latencyMs":7687,"thoughts":[
 {"citizenId":"citizen-030","citizenName":"Jack Wong","strategy":"authority-scam",
  "tick":72,"engineDecision":"ignore","probability":0.5991,
  "thought":"I'm not sure about this message. It says it's from my bank, but it's
   asking me to confirm a transfer to avoid account suspension. That sounds urgent
   and a bit suspicious. I should check with my bank directly before doing anything.",
  "source":"live"}, ...]}
```

市民用自己的话解释了为什么没上钩，且与确定性引擎的判定（`ignore`）一致。这是项目里最有说服力的输出，而评委看不到。

## 实测：Minecraft 端把「正在被骗」画成「安全」

权威词表在 `types/index.ts`：

```ts
export type CitizenState =
  | "safe" | "suspicious" | "engaged" | "trusted" | "clicked" | "victim" | "protected";
```

`simulation/world.ts:520` 的 `stateForDecision` 确认这是一条受骗漏斗：

```
safe → suspicious(起疑并忽略) → engaged(接触) → trusted(信任) → clicked(点击) → victim(损失)
```

推进一天后的实际分布：

```
$ curl -sX POST .../api/simulation -d '{"type":"run","days":1}'   # tick 0→72
$ # 按 citizen.state 计数
safe 89 / victim 5 / suspicious 3 / trusted 2 / engaged 1
```

修前 `BridgeController.status()` 只匹配 `victim` 与 `protected`，其余四态落到兜底的绿色「安全」。即该局有 **1 个 `engaged` + 2 个 `trusted` 被画成绿色安全**——正在被骗的人在屏幕上是安全的，而「看见骗局如何展开」正是产品主张。

同时发现一段死代码：旧分支按 `riskScore`/`risk`/`score` 判橙色「高风险」，但市民 payload 里没有任何这些字段（实际字段是 `riskAwareness`），该分支永不触发。

## 改动

1. `components/scamcity-dashboard.tsx` + `app/globals.css`：新增「04 / CITIZEN NARRATION」面板与 `fetchThoughts`。**仅 live 模式提供**——路由读服务端 store，local 模式下 dashboard 跑浏览器内自己的世界，混用会让叙述描述另一座城市。面板显式标注 `MODEL`/`RULES`、模型名、延迟、逐条 `source:fallback`、「synthetic citizens, not real people」。
2. `BridgeController.java`：`status()` 改为七态精确 switch（exact match 优先，避免 `contains("risk")` 松匹配吞掉其他状态），图例扩为八项含骗子紫；删除 `riskScore` 死分支。
3. `BridgeController.java`：新增 `addScammerStand`（紫甲 + 主手 `writable_book`）。市民也人形化后单靠甲色在远处分不出身份，故加手持物件。字段改名 `humanoidCitizens` → `humanoidFigures`。
4. `verify-command-format.mjs`：新增词表绑定与长度断言（详见下节）。

中段三色故意与网页发散：dashboard 把 `engaged`/`trusted`/`clicked` 画成三档橙色，6px SVG 圆点可行，但 100 格网格远看会糊成一片，故拉开为黄/橙/粉。顺序与标签保持一致。

## 断言强化

从 `types/index.ts` 解析 `CitizenState` union，逐态要求 Java 有显式分支、块颜色互不重复、不得复用骗子的 `purple_concrete`、图例必须含全部七个标签。

同轮把一条既有断言从硬编码计数改写为不变量：原「双标签 `summon` 必须正好 3 处」在我加第四种实体时撞线。计数每加一种实体就要改一次，等于把真检查变成减速带，已改为遍历所有 `summon` 模板逐个校验双标签。

新增命令长度断言（按最宽取值渲染后 <250）。骗子盔甲架实测最长 154 字符：

```
154  summon armor_stand -11 64 -7 {Tags:["scamcity","sc_s11"],NoGravity:1b,...
115  item replace entity @e[tag=sc_s11,type=armor_stand,limit=1] armor.chest...
104  item replace entity @e[tag=sc_s11,type=armor_stand,limit=1] weapon.mainhand...
worst = 154  (under 250 guard and 256 cap)
```

**两条新断言均做过负向测试**：去掉 slot tag、删掉 `trusted` 分支，都被抓住并给出预期消息，恢复后通过。

## 自查与修正

1. **自己引入的 React 缺陷（已修）**：初版 `fetchThoughts` 用 `thoughtsBusy` state 做重入保护并把它放进 dep array。state 更新是异步的，两次快速点击可在首次 re-render 前都通过检查；放进 dep array 还让回调身份在飞行中变化。已改为 `thoughtsRequestRef` ref 守卫（与同文件其他 live 回调一致）并移出 dep array。
2. **工具误判已更正**：首次负向测试报 `NEGATIVE TEST FAILED: broken tags passed`。根因是 `python3` 在本机解析到 `WindowsApps` 的 Microsoft Store 存根，会静默退出，探针编辑从未应用，verify 因此合法通过。改用 Node 写探针文件（并断言「探针编辑确实已应用」）后确认断言真实生效。**此前结论是假阴性，不是断言漏洞。**
3. **`clicked` 配色返工**：初选 `magenta_concrete`，与骗子 `purple_concrete` 远看同色；已改 `pink_concrete`，并补回图例中被我漏掉的骗子项。
4. **`edit` 工具两次把 `edits` 数组序列化成字符串**被参数校验拒绝，重发后成功；无文件被写坏。

## Gate 结果

```
npx tsc --noEmit                          exit 0
gradlew --offline check                   PASS: request lifecycle, scene diffing,
                                          scene queue, citizen grid, endpoint
                                          resolution and HUD regressions
node minecraft-bridge/verify-command-format.mjs   passed
node bridge-harness/verify.mjs            passed (full marker commands: 105)
verify-simulation-contract.mjs (live)     OK, verdict=bank-risk-agent
gradlew --offline clean build ×2          hash 一致
```

`bridge-harness` 报 105 条 full marker commands（100 市民 + 5 骗子），确认骗子人形路径进入 diff 流。骗子实际只有 5 个（渲染上限 12），故盔甲架总数 100 → 105，非先前估的 112。

**`npx next lint` 未纳入 gate**：本仓未配置 ESLint，该命令交互式索要创建配置并在非交互环境返回非零。未代为创建（会新增 dev 依赖与配置文件）。这不是 lint 失败。

## 产物

- SHA-256 `a3d289a62a27970fc46b3a9d3e805b445636dc55859de3f768004895434313f4`（两次 `clean build` 一致）
- 已同步 `build/libs`、`minecraft-staging/mods`、`D:\Minecraft\mods` 三处，`distinct=1`
- 旧 JAR `d4bbcb2e...` 备份为 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-statecolors-20260920-162030.jar`
- 安装时 `tasklist` 确认 `javaw` 计数 0

已 curl 确认页面真的渲染出面板（命中 `CITIZEN NARRATION`、`Why they decided`、`thoughts-panel`），且 local 模式正确显示说明文案而非按钮（默认 `dataSource` 为 `local`）。

## 未验收

- **七态配色与图例在游戏内从未看过。** 中段三色的远看可辨性属观感，未测量。
- **骗子人形在游戏内从未看过**，105 个盔甲架帧数未测。默认仍为色块。
- **叙述面板未在浏览器里真正点过**：排版、长文本溢出、`source:fallback` 橙色标注的实际观感均未看过。45s 超时是拍的（参考值：2 市民 7.7s），4 市民真实耗时未测。
- **叠层仍未在游戏内看过**（上轮遗留）。本轮修了面板宽度（改 `textRenderer.getWidth` 字体实测，替代每字符 6px 估算；叠层文案几乎全中文，CJK 约 9px，估算会让文字溢出背板），但仍未现场验证。
- RUNBOOK 七项现场 E2E 未走完。
- `evolution/PRODUCT_AUDIT.md` 的 P0「观众动作没有闭环」已过期（dashboard 第 574 行已 POST `/api/simulation`，Minecraft 也有 `intervene` 子命令）。已向用户提出是否更正，**未答复，文档未改**。
