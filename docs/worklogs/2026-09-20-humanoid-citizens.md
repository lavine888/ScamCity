# 2026-09-20 市民人形化（小试版）与真机首次连通排查

## 范围

两件事：（1）排查用户「打开单人游戏接不上可视化」的实际原因；（2）按用户选择，把市民从色块改为染色皮革盔甲架小人，先做可切换的小试版。

产物 hash 从 `243d4dfe...` 变为 `c04894be...`（两次 `clean build` 一致）。

## 真机排查：端口被 Minecraft 自己占了

现象：`/scamcity start` 后反复回显 `API 不可用，已切换离线演示: HTTP/1.1 header parser received no bytes`。

这条错误信息和 2026-09-19 那次 HTTP/2 故障**完全相同**，但根因不同，不要混淆：

- 上次：`HttpClient` 默认 HTTP/2 对明文 `http://` 尝试 h2c 升级，已修为 `HTTP_1_1`。
- 本次：bridge 用默认地址 `http://localhost:3000/api/simulation`，而端口 3000 的监听进程是 **PID 21064 = `javaw.exe`，即 Minecraft 自己**（1.8 GB 内存）。用户点了 `Open to LAN`，Minecraft 把 LAN 端口分到了 3000。bridge 连上去的是自己的 LAN 服务器，对方按 Minecraft 协议回应，HTTP 客户端读不到 HTTP 头。

ScamCity 服务实际在 **51662**（用户提供，探测 `/api/simulation` 返回 200）。

结论：不是服务没起，是撞端口。**不要**把服务改到 3000 来「对上默认值」——3000 已被 LAN 占用，会一直撞。正解是给 profile 加 JVM 参数：

```
-Dscamcity.api=http://localhost:51662/api/simulation
```

进世界后 `/scamcity api` 核对回显。

### 附带确认：作弊权限已经通了

日志 08:20:38 的 status 行：

```
ScamCity | 运行中 | 离线演示 | 队列 0 | 增量基准 已建立 | 已发送 450 条 / 跳过 3 帧 | snapshot=offline-demo-42-0-4-0
```

- 全程**没有** `Unknown or incomplete command` → `summon` 执行成功，存档已开 `Allow Cheats`。此前 A-02/A-03 的阻塞项（`allowCommands=0`）已解除。
- `增量基准 已建立` + `跳过 3 帧` → **A-12 增量渲染在真机上首次得到证据**：重复画面被跳过，没有重画。

注意这两条都是在**离线演示**数据下观测到的，不是 live API 数据。A-12 现场证据仅覆盖「基准建立 + 跳帧」，闪烁是否消失、队列耗时仍未测量。

## 人形化实现

### 开关

新增 `/scamcity style blocks|people`，字段 `humanoidCitizens` 默认 `false`。切换时 `scenes.reset(true)` 丢弃增量基准——方块和盔甲架不能互相 diff，必须全量重画；随后用 `latestSnapshot` 立即重绘，没有快照时提示先跑 `demo`/`refresh`。

默认保持色块：100 个盔甲架比 100 个 block display 重，这个代价尚未在游戏内测量，便宜的模式要留作退路。

### 单条命令塞不下，必须拆

把装备写进 `summon` 的 NBT 里实测 **561 字符**。命令经 `sendChatCommand` 发出，聊天命令包协议上限 256（`add()` 的 250 是留余量）。超限会被 `add()` **静默丢弃并只记一行 warn** —— 后果是 100 个市民一个都画不出来，而且界面上不报错。

压缩尝试（全部实测）：

| 方案 | 长度 | 结果 |
| --- | --- | --- |
| 内联装备 + `minecraft:` 命名空间 | 561 | 超限 |
| 去命名空间、去非必要 flag | 396 | 超限 |
| 只留头盔 + 胸甲 | 255 | 仍超限 |
| 裸 summon | 98 | 可用 |
| 单件 `item replace` | 99 | 可用 |

采用拆分：一条裸 `summon armor_stand`（155 字符，含 flag）+ 四条 `item replace`（各约 116 字符）。五条命令**落在同一个槽位**，所以该市民整体仍是一次替换或一次跳过，不破坏 A-12。

### 两个必须保留的细节

- `item replace entity @e[tag=%s,type=armor_stand,limit=1]` 的 **`type=armor_stand` 不可省**：标签文字 `text_display` 与盔甲架共用同一槽位标签，裸标签选择器会给文字穿衣服。
- 盔甲架带 `NoGravity:1b,Invulnerable:1b,NoBasePlate:1b,ShowArms:1b,DisabledSlots:4144959`：布局是数据投影，市民不能漂移、掉落，装备不该被玩家摘走。

状态颜色改为同时携带方块和皮革染色值（`Status.leather`），两种模式语义一致。

### 代价

单市民 2 条 → 6 条命令；单市民状态变化的增量从 3 条 → 7 条。满编全量从 102 条涨到约 500 条。`COMMANDS_PER_TICK = 8` 未改，所以首次全量铺开比色块模式慢几个 tick。仍远好于全量重建。

## 顺带修复：doctor 的假信号（真 bug）

`npm run doctor` 输出过自相矛盾的一行：

```
PASS  minecraft-log: profile line not found
```

原因：状态由 `loaded` 决定，消息由 `version` 决定，两者不相关。`version` 在 `tail`（最后 120,000 字符）里找，而启动横幅 `Loading Minecraft ... with Fabric Loader ...` 在**日志第 1 行**（字节偏移 24）。当时日志 136,763 字节，窗口起点约 16,763，横幅被切掉；而 `ScamCity bridge loaded`（偏移 25,782）仍在窗口内，于是 `loaded=true` → PASS，消息却说没找到。

这是会随日志变长自己冒出来的 bug，不是本次环境特有的。`tail` 截断对统计命令错误是**有意**的（避免旧 JAR 的历史错误污染新检查），但横幅只在开头出现一次，不能在截断窗口里找。

已改为在全文匹配横幅，且状态同时反映两个事实：`loaded && version ? pass : warn`，消息拼成 `Minecraft 1.21.11 · Fabric 0.19.3 · bridge loaded`。

## 已执行的验证

- `node minecraft-bridge/verify-command-format.mjs` 通过（新增断言见下）
- `./gradlew build` 成功，`verifyBridgeLifecycle` PASS
- 两次 `./gradlew clean build` hash 均为 `c04894be98605793a89b152b0a2a439991c4c8510ad78435d45422274cac3aaf`
- 确认无 `javaw.exe` 后备份旧 JAR 到 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-humanoid-20260920-083431.jar`，同步三处，hash 一致
- `node bridge-harness/verify.mjs`（105 full / 1 delta）、`npm run doctor`（`SCAMCITY_API` 指向 51662，全 PASS / READY）

### 新增格式断言

- 双标签实体计数 2 → **3**（block display、text display、盔甲架）
- `item replace entity @e[tag=%s,type=armor_stand,limit=1]` 必须存在（锁住类型过滤）
- `doesNotMatch` 内联装备形式 `summon ... armor_stand ... equipment:{`（锁住 256 字符上限这个教训，防止有人「优化」回单条命令）
- `dyed_color=%d` 必须存在

## 自我修正

- 第一版直接写了内联装备的单条 `summon`，实测 561 字符会被静默丢弃。**先量长度再写实现**，否则这个 bug 在游戏里表现为「什么都没出现」且不报错，极难定位。
- 第一版 `item replace` 选择器没带 `type=`，会命中同槽位的 `text_display`。
- 格式检查的「双标签实体必须是 2 个」是我上一轮写死的断言，本轮因新增盔甲架而失败。**代码对、断言过时**，已放宽到 3 并补充本轮约束。

## 边界与未完成

- **100 个盔甲架的帧数未测**：这正是先做小试版的原因。用户看过效果与流畅度后才决定是否铺满。
- **人形模式真机未看过**：本文档写作时用户尚未启动新 JAR（`c04894be...` 尚未在游戏内跑过）。
- **朝向统一**：`Rotation:[180f,0f]` 让所有市民朝同一方向，观感整齐但呆板。可按 cell 算确定性朝向，但会给「同 seed 同画面」判定多一个变量，未动。
- **A-15 远景可读性未关闭**：人形化改变了远景观感，但「只为选中/最近事件显示文字」仍未实现，100 行浮空文字的拥挤问题依旧。
- **live API 数据下的人形渲染未验**：真机连通还卡在 JVM 参数那一步。
- delta 仍假设世界只被 bridge 改动；玩家手动 kill 展示实体后 bridge 会以为它还在，直到下次全量同步。
