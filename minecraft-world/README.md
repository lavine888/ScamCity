# ScamCity / Minecraft 空间蓝图

这个目录是 ScamCity Web Demo 的 Minecraft Java Edition 展示层设计与安全模板。它定义一个观众站在场内就能读懂的“AI 社会实验场”：100 个合成市民在城市中移动，5 个诈骗 Agent 从边界进入，风险状态以颜色变化，事件流投到中央控制塔和东侧事件墙，干预策略在西侧实验室触发。

这里只包含工作区内的蓝图、数据契约和待替换的命令模板。它没有读取、复制、修改或覆盖用户的 `.minecraft/saves` 存档，也不会自动把模板安装进存档。

## 已确认的接入面

当前 Web Demo 已提供：

- `GET /api/simulation`：返回一个完整的 `SimulationSnapshot`，其中 `world.citizens` 固定为 100 个合成市民，`world.scammers` 固定为 5 个诈骗 Agent。
- `POST /api/simulation`：支持 `reset`、`tick`、`run`、`intervention`、`pause`、`resume`、`compare`。
- `world.eventSequence`：单调递增的事件高水位；事件列表会截断到最近 120 条，所以桥接层应按 `eventSequence` 去重，不能用数组长度做游标。
- 市民位置范围：`location.x` 为 5–95 附近，`location.y` 为 8–92 附近；移动后仍会被限制在 4–96、6–94。
- 市民状态：`safe`、`suspicious`、`engaged`、`trusted`、`clicked`、`victim`、`protected`。

以上来自工作区内的 `types/index.ts`、`app/api/simulation/route.ts` 和 `simulation/world.ts`。Minecraft 端不应读取任何私有账号、真实个人数据或用户存档文件。

## 场地总览

默认把 Minecraft 世界中的一个平面层作为城市，地面高度为 `Y=64`，中央控制塔的中心为 `(X=0, Y=64, Z=0)`。完整坐标、锚点、状态色和投影公式见 [`layout.json`](./layout.json)。当前 Fabric bridge 为了适配已有世界，会以玩家执行 `/scamcity demo` 或 `/scamcity refresh` 时的位置作为临时中心；站到计划中的控制塔位置即可与这套坐标蓝图对齐。

```text
                         北 / -Z

        NORTH RESIDENTIAL          CAMPUS
        市民生活区                  研究与学校区
              ┌────────────────────────────┐
              │       ┌──────────┐         │
              │       │ CONTROL  │         │
     西 -X    │       │  TOWER   │         │    东 +X
              │       │ 0,64,0   │         │    EVENT WALL
              │       └──────────┘         │    +62,64,0
              │ COMMERCIAL        TRANSIT │
              │ 商业区            交通区   │
              │                  WATERFRONT│
              └────────────────────────────┘
        INTERVENTION LAB                       SCAMMER GATE
        -62,64,0                                0,64,-53

                         南 / +Z
```

这里的五个矩形是观众认知用的空间分区。`Citizen.location.zone` 是模拟数据标签，默认位置仍使用原始 `x/y` 连续投影，以保持 Web 地图和 Minecraft 的相对位置一致；不要为了把所有 `residential` 市民强行塞进某个几何区而改写模拟数据。

### 关键区域与观众动线

1. **Audience Spawn → Control Tower**：观众从南侧出生点进入，先看到顶部 HUD、100 个彩色市民点和 5 个边界 Agent。
2. **Control Tower**：中央高塔显示 `Day / tick / victims / HK$ loss / safety index`。塔顶 beacon 或彩色玻璃柱是全场视觉锚点。
3. **City Layer**：市民显示为 100 个 1×1 色块或 `block_display` 实体；颜色变化就是状态变化。高连接市民（`isHub=true`）使用双层环或粒子环突出。
4. **Event Wall**：东侧只显示最近 8–12 条事件，按 `world.eventSequence` 更新；红色事件在市民位置与事件墙之间显示一条短暂粒子线。
5. **Intervention Lab**：西侧放四个干预台：Mass Warning、Bank Risk Agent、Social Guardian、Network Intervention。桥接层把按钮/交互转成 API POST 命令。
6. **Scammer Gate**：北侧放 5 个诈骗 Agent 标牌，Agent 被激活时亮起；事件里的 `scammerId` 决定哪一枚标牌闪烁。
7. **Waterfront / Safety Console**：南东侧用于干预后的复盘，显示受保护人数、覆盖率和当前策略名称，避免所有信息挤在中央塔。

## 市民显示规则

优先使用 `minecraft:block_display`，每个实体携带：

- `scamcity.citizen`：全局清理和批量查询标签；
- `scamcity.citizen.<citizen-id>`：稳定身份标签，例如 `scamcity.citizen.citizen-042`；
- 可选的 `scamcity.hub`：高中心性市民使用更大方块、环形粒子或悬浮名牌。

如果 Fabric 桥接层尚未启用 display entity，使用安全的降级方案：把每个位置更新为一格彩色混凝土；选中市民时才生成一个 `text_display`，避免 100 个悬浮文字遮住城市。

状态映射保持与 Web UI 语义一致，Minecraft 颜色是可识别的近似：

| ScamCity 状态 | Web 色值 | Minecraft 显示 | 观众读法 |
| --- | --- | --- | --- |
| `safe` | `#4c91ff` | `blue_concrete` | 正常生活 |
| `suspicious` | `#facc15` | `yellow_concrete` | 有疑虑 |
| `engaged` | `#f59e0b` | `orange_concrete` | 已打开/互动 |
| `trusted` | `#ff8c42` | `red_concrete` 的橙色替代材质 | 已相信发送者 |
| `clicked` | `#fb923c` | `orange_concrete` + 火花粒子 | 已点击 |
| `victim` | `#fb3b50` | `red_concrete` | 发生损失风险 |
| `protected` | `#40e0a0` | `emerald_block` 或 `lime_concrete` | 被干预保护 |

为了让 `trusted` 与 `victim` 在远处仍然有区别，建议 `trusted` 使用红色混凝土上方的橙色玻璃环，而 `victim` 使用红色混凝土和短暂的红石火花。颜色只是第一信号，粒子和形状是第二信号。

## 坐标投影与去重

桥接层必须使用 [`layout.json`](./layout.json) 中的公式：

```text
mcX = round((citizen.location.x - 50) * 1.10)
mcZ = round((citizen.location.y - 50) * 0.90)
mcY = 65
```

然后把结果限制在 `X=-55..55`、`Z=-45..45`。中央控制塔占据 `X=-6..6, Z=-6..6`；落入塔 footprint 的市民沿其原始向量向外推到最近边界。多个市民投影到同一格时，按 `citizen.id` 的稳定哈希进行螺旋搜索，最多搜索半径 4，不要按每次 poll 的顺序随机移动，否则观众会看到市民跳动。

位置更新以 `citizen.id` 为主键，不能使用数组下标。市民、诈骗 Agent 和事件都需要在客户端维护自己的高水位与实体索引。

## 桥接层轮询协议

空间协议建议 Fabric 客户端每 750–1000ms 请求一次 `GET http://localhost:3000/api/simulation`；当前桥接模组为避免一次刷新发送过多实体命令，默认约每 10 秒轮询一次：

1. 如果 `world.seed`、`world.tick` 或 `world.citizens.length` 不符合预期，显示桥接异常牌，不清空城市。
2. 对 100 个市民按 `citizen.id` 做 upsert，更新位置、状态、hub 标记和选中的名字。
3. 比较 `world.eventSequence` 与本地 `lastEventSequence`。只处理更大的事件；事件数组截断时仍然可以正常继续。
4. 使用 `world.metrics` 更新控制塔 scoreboard；金额通过分数或悬浮文本显示，避免把带逗号的金额直接塞进 scoreboard。
5. 将新的 `kind/severity` 映射到事件墙、粒子和短暂 title。`danger` 触发红色脉冲，`success` 触发绿色粒子，`warning` 触发黄色脉冲。
6. 干预台的动作只允许发送已知的 `InterventionStrategy`，例如：

   ```json
   { "type": "intervention", "strategy": "social-guardian" }
   ```

   网页 API 是进程内存储，桥接层重启后应先 GET 全量快照，再从当前 `eventSequence` 继续，不能假定有持久化事件日志。

## 模板内容

`datapack-template/` 提供不绑定具体游戏版本的最小命令骨架：

- `pack.mcmeta.template`：`<PACK_FORMAT>` 需要按启动的 Java 版本填写；不要盲目把 1.21.1 的数字复制到别的补丁版本。
- `data/scamcity/function/load.mcfunction`：建立 scoreboard 并初始化 HUD 状态。
- `data/scamcity/function/tick.mcfunction`：仅维护本地演示 tick，不主动推进 Web 模拟。
- `data/scamcity/function/reset.mcfunction`：只清理带 `scamcity.*` 标签的实体并清零计分板。
- `data/minecraft/tags/function/load.json` 与 `tick.json`：把函数接入世界生命周期。
- `commands/*.mcfunction.template`：由桥接层填入市民坐标、状态色和事件文字后再执行。

模板故意不包含大范围 `/fill` 或直接操作用户存档的脚本。`control-tower-preview.mcfunction.template` 里的建筑命令也只作为人工审阅后的示例；正式演示应先在副本世界运行。

## 验收清单

- `layout.json` 可以被 `ConvertFrom-Json` 解析，所有锚点和状态映射完整。
- datapack 目录使用现代 Java 版的 `data/<namespace>/function/` 路径，并且 load/tick 标签存在。
- `reset.mcfunction` 的清理范围只匹配 `scamcity.*` 标签，不会杀死玩家、村民或用户已有实体。
- 任何市民更新都以 `citizen.id` 为稳定键；任何事件更新都以 `eventSequence` 为高水位。
- 本目录不包含 `.minecraft` 路径、真实用户数据或写入存档的自动化脚本。
