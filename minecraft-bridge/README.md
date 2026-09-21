# ScamCity Minecraft Bridge

这个目录是 ScamCity Web Demo 到 Minecraft Java Edition 的可视化桥接模组。它把一份世界快照（`GET /api/simulation`，地址由端点自发现得出，见 `ApiEndpoints`；不再假定 3000 端口，因为 Minecraft 的 `Open to LAN` 经常占用它）变成 Minecraft 中可移动、可清理的展示空间：居民是 10×10 风险网格，骗子在上方紫色区域，最近事件显示在右侧，顶部显示总体指标，屏幕左上角另有叠层显示数据源与 comparison verdict。网格位置按 `citizen.id` 稳定投影（见 `CitizenGrid`），不再使用数组下标：同一位居民在状态变化或 API 返回顺序变化时不会换方块。当前实现以玩家进入命令时的位置作为城市中心，避免假定目标世界已经有平整地形；想对齐空间蓝图时，先站到选定的控制塔中心再执行 `/scamcity demo`。

## 已确认的版本边界

- 目标 profile：Minecraft Java `1.21.11`。
- 目标 loader：Fabric Loader `0.19.3`。
- 编译环境：Java `21`，Fabric Loom `1.16.2`，Yarn `1.21.11+build.6`。
- 构建依赖（`gradle.properties` 声明）：Fabric API `0.141.6+1.21.11`。**注意实装版本不同**：`D:\Minecraft\mods\` 里是 `fabric-api-0.141.4+1.21.11.jar`。核对 API 签名时必须针对**实装版本**；另外 fabric-api 是容器 mod，类在 `META-INF/jars/` 嵌套 JAR 内，顶层 `unzip -l` 搜不到不代表缺失。
- 本机现有的 `fabric-api-0.116.17+1.21.1.jar` 明确声明 Minecraft `>=1.21 <1.21.2`，不能作为 1.21.11 profile 的依赖。本模组没有复用它。

本目录的构建已成功完成，产物为 `build/libs/scamcity-bridge-0.1.0.jar`，SHA-256 `a3d289a62a27970fc46b3a9d3e805b445636dc55859de3f768004895434313f4`（2026-09-20 16:20，七态配色 + 骗子人形），连续两次 `clean build` hash 一致。构建过程不写入任何世界存档；当前现场副本已安装到 `D:\Minecraft\mods`，覆盖前的旧 JAR 保存在 `D:\Minecraft\.codex-backups`。历史基线与备份对应关系见 `AGENT-STATE://resources/artifacts.md`（该文件是单一权威源，本 README 不重复维护历史列表）。

## 构建

在本目录执行：

```powershell
./gradlew.bat build
```

也可以使用本机 Gradle 9.4.0：

```powershell
gradle --no-daemon build
```

`build` 会执行 Java 编译、资源处理、Fabric remap 和 jar 校验。生命周期与渲染队列回归由 `verifyBridgeLifecycle` 执行，并已挂接到 `check` / `build`；测试无需启动 Minecraft。

命令格式回归检查（不启动 Minecraft）：

```powershell
node verify-command-format.mjs
```

1.21.5 之后，`/title` 等命令和 `text_display` 的文本组件使用内联 SNBT；桥接使用 `{text:"...",color:"aqua"}`，不会再发送旧的 JSON 字符串包装格式。

## 安装与运行

1. 为 `fabric-loader-0.19.3-1.21.11` profile 准备匹配 1.21.11 的 Fabric API 0.141.x；不要把现有的 1.21.1 Fabric API jar 当成替代品。
2. 关闭 Minecraft 后，把 `build/libs/scamcity-bridge-0.1.0.jar` 放到该 profile 的 `mods` 目录。
3. 先启动 ScamCity Web Demo（默认 `http://localhost:3000`），再启动 Fabric profile 并进入世界。
4. 在单人世界打开作弊，或在服务器给当前玩家执行命令的权限；桥接通过 `/summon`、`/kill` 和 `/title` 把展示写入服务器世界。
5. 进入世界后使用下面的命令。模组只在用户显式执行展示命令时向当前世界发送带有 `scamcity` 标签的显示实体命令。

本轮的刷新稳定性版本已于 2026-09-19 15:57 重新安装到 `D:\Minecraft\mods`（安装时游戏未运行），旧 JAR 已备份。首次加载新 JAR 必须完全退出并重新启动目标 Fabric profile；离线回归通过不代表游戏内已加载。

## 游戏内命令

| 命令 | 作用 |
| --- | --- |
| `/scamcity refresh` | 从本地 API 拉取最新快照并刷新展示 |
| `/scamcity intervene <strategy>` | 通过 POST 执行受限干预并用返回快照刷新展示 |
| `/scamcity anchor` | 把城市中心锁定到玩家当前位置，再刷新一次；之后移动玩家不会让城市跳动 |
| `/scamcity demo` | 不依赖 Web Demo，渲染内置的 100 人离线演示快照 |
| `/scamcity start` | 开启自动同步，每约 10 秒轮询一次 API |
| `/scamcity stop` | 停止轮询并清理本模组展示实体 |
| `/scamcity clear` | 停止自动同步，取消旧快照回写，并清理带 `scamcity` 标签的展示实体 |
| `/scamcity status` | 显示同步状态、来源和待发送命令数量 |
| `/scamcity api` | 显示 API 地址、snapshotId 和 cursor |
| `/scamcity style blocks` | 市民渲染为状态色块（默认） |
| `/scamcity style people` | 市民渲染为染色皮革盔甲架小人 |

`<strategy>` 只接受以下五个值：`baseline`、`mass-warning`、`bank-risk-agent`、`social-guardian`、`network-intervention`。例如：

```text
/scamcity intervene social-guardian
```

桥接发送的请求体是 `{"type":"intervention","strategy":"social-guardian"}`，成功后直接把 POST 响应作为新的快照渲染，不会在 Minecraft 侧伪造干预结果。

如果 API 不可用，`refresh` 会自动切换到离线演示快照，并在聊天栏说明原因。也可以通过 JVM 参数覆盖地址：

```text
-Dscamcity.api=http://127.0.0.1:3000/api/simulation
```

## API 契约

模组优先读取响应的 `world` 对象：

```json
{
  "world": {
    "citizens": [{"id": "citizen-001", "status": "safe", "riskScore": 0.18}],
    "scammers": [{"id": "scammer-01"}],
    "eventFeed": [{"type": "scam", "message": "..."}],
    "metrics": {"victims": 10, "atRisk": 20, "moneyLost": 750200}
  },
  "snapshotId": "42-504-259-1",
  "cursor": {"revision": 1, "tick": 504, "eventSequence": 259}
}
```

字段名存在轻微差异时，渲染器也会尝试 `name`、`citizenId`、`state`、`outcome`、`risk` 等备用字段。居民状态映射为：安全=绿色，风险=橙色，受害=红色，保护中=青色；骗子使用紫色节点。

### 市民样式：色块与小人

`/scamcity style people` 把市民从 `block_display` 色块改为染色皮革盔甲架（四件套装），人形轮廓更明确，状态颜色与色块模式一致。`/scamcity style blocks` 切回。

**默认是色块**：100 个盔甲架比 100 个 display 实体重，而这个帧数代价尚未在游戏内测量，因此便宜的模式留作退路。切换样式会丢弃增量基准并立即全量重绘（色块与盔甲架不能互相 diff）。

一个小人是 **一条裸 `summon armor_stand` + 四条 `item replace`**，而不是把装备写进 `summon` 的 NBT——后者实测 561 字符，而命令经 `sendChatCommand` 发出、聊天命令包协议上限是 256（代码里的 250 是留余量），超限命令会被静默丢弃：后果是 100 个市民一个也画不出且界面不报错。即使只保留头盒和胸甲仍为 255 字符，所以拆分是必选项。五条命令全部落在**同一个槽位**，因此该市民仍然是一次整体替换或一次整体跳过，不破坏增量渲染。

`item replace` 的选择器必须带 `type=armor_stand`：标签文字的 `text_display` 与盔甲架共用同一个槽位标签，裸标签选择器会给文字穿衣。盔甲架带 `NoGravity`、`Invulnerable`、`NoBasePlate`、`DisabledSlots`：布局是数据投影，市民不能漂移或掉落，装备也不应被玩家摘走。以上两点由 `verify-command-format.mjs` 断言锁定。

代价：单市民从 2 条命令涨到 6 条，状态变化的增量从 3 条涨到 7 条，满编全量约 500 条。`COMMANDS_PER_TICK` 未变，所以首次全量铺开比色块模式慢几个 tick。

### 增量渲染

每个展示实体带两个标签：共享的 `scamcity`（用于整体清理）和自己的槽位标签（市民为 `sc_c<cell>`，骗子 `sc_s<i>`，事件行 `sc_e<i>`，控制塔 `sc_h<i>`）。槽位标签让单个标记可以被单独 `kill`，因此刷新不再整城重建：

- **首帧、`/scamcity anchor`、`/scamcity demo`、手动 `/scamcity refresh`**：全量同步，先 `kill @e[tag=scamcity]` 再重建所有槽位。手动刷新刻意不信任已渲染状态，因为操作者请求重绘通常正是怀疑画面已经漂移。
- **自动轮询**：只发变化的槽位。满编 100 格城市里单个市民状态变化是 3 条命令（`kill @e[tag=sc_c42]` + 两条 summon + 指标行），而全量是 102 条。仅指标变化不触碰任何实体；重排但内容相同的快照零重绘。人形模式下这两个数字分别为 7 条与约 500 条。
- **删除的槽位**先被 kill，所以缩编名单不会留下孤立标记。

增量基准是**最后一次完整渲染完的帧**，绝不是渲染中途的帧：批次在飞行途中时画面处于两帧之间，因此新帧会等该批次排空。世界切换、`/scamcity clear`、`/scamcity stop` 或命令发送失败都会丢弃基准，下一帧自动退回全量同步。`/scamcity status` 会显示增量基准是否已建立，以及累计已发送命令数与跳过的帧数。

## 验收清单

- [x] 目标 1.21.11 + Loader 0.19.3 的 Fabric 项目文件。
- [x] API 轮询、7 秒超时和离线演示回退。
- [x] 100 个居民、骗子、事件、指标的空间化展示命令。
- [x] 手动刷新、启动/停止、状态、清理命令。
- [x] 受限五策略干预命令，POST 结果直接回流为新的展示快照。
- [x] `status` / `api` 显示 snapshotId、cursor 和来源。
- [x] 按槽位寻址的增量渲染：单个市民变化只发 3 条命令，仅指标变化不触碰实体（离线回归已验证；真实游戏内闪烁与队列耗时仍未观测）。
- [x] 所有展示实体使用 `scamcity` 标签，便于安全清理。
- [x] `gradlew.bat build` 已通过，产物已生成。
- [ ] 在真实 Minecraft 进程中验收：需要安装匹配的 1.21.11 Fabric API 并启动用户 profile；本轮未代替用户执行安装和启动。

## 生命周期与刷新稳定性

进入或切换世界后默认暂停；先执行 `demo` / `refresh` 展示，或执行 `start` 开启轮询。离开世界、切换维度或连接会清空本地队列、锚点与快照，并拒绝旧连接尚未返回的 HTTP 响应；返回旧世界时不会自动重启。旧世界中已经发送的实体不会跨世界清理，可返回后执行 `clear`。

`stop`、`clear`、`demo`、重新设置 `anchor` 都会使此前请求失效，旧成功或失败回调不会重新生成展示。已发出的干预 POST 仍可能在 API 服务端完成；这里只保证过期响应不写回游戏，不能撤销服务端干预。

自动刷新比较实际展示命令（包含位置与 LIVE/DEMO 来源）；完全相同的场景不再销毁重建。正在发送的场景会先完成，等待中的更新只保留最新一份，避免高频更新截断半个场景。手动 `refresh` 和干预响应强制重新绘制，便于修复玩家手动清除的展示。场景变化时仍是完整重绘，并非实体增量更新。

回归验证：

```powershell
./gradlew.bat --offline --no-daemon build
node verify-command-format.mjs
```

这些检查覆盖请求失效、旧回调不能解除新请求锁、世界切换、队列合并、自动去重、强制重绘和清理；不能替代真实 Minecraft 权限、命令执行与画面验收。
