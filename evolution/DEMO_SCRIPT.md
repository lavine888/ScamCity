# ScamCity 三分钟现场脚本

目标：让评委在 180 秒内理解“先观察一个合成社会，再用干预改变同一批人”，并同时看见 Web 控制台和 Minecraft 空间。

主叙事名称：**ScamCity / AI Society Control Room**

主句：

> We do not ask whether an intervention sounds good. We let the same synthetic society experience it first.

中文说法：

> 我们不先争论一个干预听起来好不好，而是先让同一个合成社会经历它，再看损失、误报和保护范围如何变化。

## 开场前置条件

### 目标运行方式（六小时重塑后的路径）

```text
Next API / live world
        ├── Web control room
        └── Minecraft bridge
```

三者必须显示相同的 `runId / seed / tick / eventSequence`。Minecraft 的控制塔和 Web 顶部状态栏都显示 `LIVE` 或 `OFFLINE DEMO`。

### 当前版本可以验证的路径

Web 的 `LIVE API` 模式和 Minecraft bridge 现在读取同一份 API 快照；`LOCAL DEMO` 与 `/scamcity demo` 仍是明确标注的离线回退。现场先完成 readiness gate，再决定使用哪条路径：

- Live：Web 切换 `LIVE API`，Minecraft 执行 `/scamcity clear`、`/scamcity anchor`、`/scamcity refresh`；网页按钮或 `/scamcity intervene social-guardian` 都会回写 API。
- Offline：Web 使用 `LOCAL DEMO`，Minecraft 使用 `/scamcity demo`；两者都能讲故事，但不能称作双端同步。
- 证明同步：以网页与 Minecraft 的 `snapshotId`、tick、eventSequence 和事件 ID 为证据；只看“API ONLINE”不够。

### 操作员 preflight

1. API：`GET /api/simulation` 返回 200、100 citizens、5 scammers。
2. Bridge：`npm run doctor`；若日志含旧 parser errors，不把它当作已验收，重启目标 Fabric profile 后重新检查。
3. Minecraft：进入允许执行 `/summon`、`/kill`、`/title` 的本地世界或服务器；输入 `/scamcity status`。
4. 清理：`/scamcity clear`，确认现场只清掉带 ScamCity 标签的实体。
5. 录制：准备网页-only fallback、固定截图和一句离线声明。

## 180 秒逐秒脚本

| 时间 | 操作 | 观众看到 | 主播说 | 证据点 |
| --- | --- | --- | --- | --- |
| 00:00–00:15 | Web 与 Minecraft 同时展示干净城市；镜头停在控制塔 | 100 个彩色市民、5 个边界 Agent、`LIVE · SEED 42` | “这不是一张统计图，而是一个可以被干预的合成社会。这里有 100 位市民、5 个不同策略的诈骗 Agent。” | citizen count、scammer count、seed |
| 00:15–00:35 | 指向一个 hub 和一条社会关系；打开 Web 居民详情 | 一个 hub 被高亮；详情中显示数字素养、压力、信任和当前想法 | “每个人有自己的风险因素和关系网络。我们不把人压成一个分数，而是让信任渠道影响诈骗故事是否成立。” | citizen ID、hub、risk factors |
| 00:35–00:58 | 启动模拟；推进到第一条 scam 事件 | Web 事件流出现 scam；Minecraft 对应颜色/事件墙更新；tick 同步 | “现在骗子不随机撒网，而是选择最容易被这类话术说服的人。” | event ID、tick、scammer strategy |
| 00:58–01:18 | 暂停在 baseline；指向 victims、loss、funnel | 红色节点和损失曲线出现；控制塔显示 baseline 指标 | “这是没有保护层的 baseline。金额、受害人数和漏斗只是这一次 seed 的 modeled outcome，不是真实世界预测。” | victims、moneyLost、fraudAttempts |
| 01:18–01:35 | 让观众选择一个干预；默认使用 Social Guardian | Web/Minecraft 操作台标明策略；产生一条 intervention 事件 | “如果我们不想把所有人都打扰一遍，可以只在一个人真的要行动时通知可信的家人。” | chosen strategy、intervention event |
| 01:35–02:00 | 触发同一个 API intervention；推进到下一次危险动作 | 某位市民从高风险/点击变为 protected；绿色事件出现；两个画面 tick 一致 | “这次改变的是同一位市民、同一张图、同一个随机种子；唯一新增的是 guardian layer。” | before/after citizen ID、eventSequence |
| 02:00–02:25 | 打开七日 replay / comparison | baseline 与 Social Guardian 并列；同时显示 loss、victims、warnings、false positives、cost | “我们不只看谁损失最少，也看保护代价、误报和警告覆盖。成本是抽象比较单位，不是现实采购报价。” | comparison table |
| 02:25–02:45 | 可选：注入一个白名单外部事件，如 `deepfake-voice` | 事件墙出现结构化事件；受影响策略标签变化 | “观众也可以改变环境。这里的文本只是显示，真正影响模拟的是带类型和持续时间的结构化事件。” | event type、source、tick |
| 02:45–03:00 | 镜头回到控制塔，停在 before/after | Web 与 Minecraft 同时显示 final state；保留 seed/runId | “ScamCity 的价值不是替人做决定，而是让我们在真实部署前，先看见一个干预会保护谁、打扰谁、花费什么。” | final run manifest、disclaimer |

## 主播台词完整版

“诈骗防护经常在上线之后才被评价。问题是，到了那个时候，误报、警告疲劳和被忽略的家庭关系已经发生了。ScamCity 先造出一个完全合成的社会：100 位市民、5 个诈骗 Agent，以及一张关系图。

每位市民都有压力、数字素养、冲动性、家庭信任和过往警告。骗子会根据话术和这些因素选择目标，所以我们可以打开一个人的资料，解释他为什么更容易相信某种故事。

现在让城市运行。右边是事件，颜色是风险状态，控制塔是这一次实验的观测结果。这里的 HK$ 和 safety index 是可重复的模拟量，不代表真实人群，也不代表真实成本。

接下来加上 Social Guardian。它不向所有人广播，而是在一个人即将做危险动作时，通知可信的家人。我们用同一个 seed 重放同一个社会，观察干预以后损失、受害、覆盖、误报和成本怎么变化。

所以我们交付的不是一个会聊天的 AI 小镇，而是一间可以先做决策、再进入现实的 AI Society Control Room。”

## 观众交互的安全版本

只有以下三个事件进入正式演示；输入框可以显示自然语言，但后台必须转成结构化事件：

| 观众输入 | 结构化类型 | 模拟影响 | 视觉效果 |
| --- | --- | --- | --- |
| “有人用 AI 伪造了家人的声音” | `deepfake-voice` | 当前版本记录 incident，不改变 fraud probability | 事件墙显示结构化事件；可在后续版本接入策略权重 |
| “银行系统暂时宕机” | `bank-outage` | 当前版本记录 incident，不改变 fraud probability | 事件墙显示 outage 条；主实验数据保持可复核 |
| “市场出现恐慌，大家急着找高收益” | `market-panic` | 当前版本记录 incident，不改变 fraud probability | 事件墙显示 panic 条；损失曲线不因自由文本被伪造 |

自由文本不能直接改变数值。无法识别的输入只作为 `audience-note` 显示，不影响结果，并明确标注“display only”。

## 失败分支与现场话术

| 失败 | 现场处理 | 话术 |
| --- | --- | --- |
| Web API 不可用 | 切换 Web 本地 DEMO；Minecraft 执行 `/scamcity demo` | “我们切到 deterministic offline replay；它仍然是同一个可复现的合成场景，但现在不是 live API。” |
| Fabric bridge 未加载 | 不继续输入大量 `/scamcity` 命令；直接展示 Web 控制台和固定 Minecraft 截图 | “Minecraft 是空间化输出层，核心实验仍可在 Web control room 完成。” |
| 权限不足，无法 `/summon` | 退出到已允许作弊的本地世界；不修改用户已有建筑 | “展示层需要执行实体命令的权限，模拟本身不依赖这个权限。” |
| 两端 tick 不一致 | 暂停演示，不解释成同步；以 API 快照和 run manifest 为准 | “我们先锁住这次 run，避免把两个不同状态混在一起。” |
| 旧 parser errors | 重启 Minecraft 和 profile；若仍失败，使用网页-only fallback | “当前实例还没有通过版本验收，先不把这块画面当作证据。” |
| 事件注入失败 | 使用预设 `deepfake-voice` 按钮；不让自由文本进入引擎 | “观众输入是可选增强，不影响主实验闭环。” |

## 评委 QA 卡

### 这是 AI 还是规则模拟？

“当前核心路径是 deterministic agent simulation：骗子 Agent 进行目标选择，风险模型给出可解释因素，LLM 适配器是可选且有回退的。我们优先保证可复现和可解释，没有把不可复现的生成结果冒充因果证据。”

### 你们的数据是真的吗？

“不是。100 位市民、行为、金额和事件全部是 synthetic。项目用来比较干预 trade-off，不预测具体的人，也没有读取真实个人数据。”

### 为什么要用 Minecraft？

“网页适合分析，Minecraft 适合让观众从远处看见一个社会：风险在空间里扩散、干预让节点变色、控制塔显示结果。它是可视化 surface，不是模型本身。”

### 为什么固定 seed？

“没有固定 seed，before/after 可能只是换了一批人。固定 seed 让我们能把变化归因到干预条件；之后可以用多个 seed 做稳健性检查。”

### Guardian 一定最优吗？

“不一定。我们展示的是当前 seed 和七日时间窗下的 modeled outcome，同时报告损失、受害、覆盖、误报和抽象成本。最佳策略取决于目标函数和场景。”

### 这能直接用于银行或运营商吗？

“现在不能直接上线。下一步需要真实基准数据、隐私与安全评估、校准、离线回放和人工审批。当前产品的价值是把候选干预放进一个可重复的 sandbox。”

## 必须留下的证据

- 一张干净城市截图：100、5、seed、LIVE/OFFLINE 状态可见。
- 一张 baseline 截图：事件 ID、tick、victims、moneyLost 可见。
- 一张 intervention 截图：同一个 citizen ID 从风险到 protected，且 eventSequence 增长。
- 一张 comparison 截图：五种策略及 impact/friction/cost 三栏。
- 一份 run manifest：seed、runId、事件、策略、初始和最终 eventSequence、时间窗口。
- 一段 10 秒回退录屏：API 关闭后画面明确显示 offline demo，而不是假装 live。
