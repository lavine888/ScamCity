# ScamCity 现场运行手册

这页只描述当前可复核的启动路径。Web API 是 live 模式的唯一状态源；Minecraft 只把 API 快照投影成空间。`LOCAL DEMO` 和 Minecraft 的 `demo` 命令是明确标注的离线回退，不应称为双端同步。

## 启动顺序

在项目目录 `D:\Codex-Workspace\Baytech Hackthon`：

```powershell
D:\Nodejs\npm.cmd run serve
```

**用 `serve` 而不是 `dev`**：它会选一个可用端口启动 Next，并把实际绑定的 URL 原子写入 `<tmpdir>/scamcity-endpoint.json`，bridge 与 `doctor`/`report` 都会自动读取。`npm run dev` 不产生该文件，各端只能回落到默认端口猜测。

打开终端输出的地址（通常 `http://localhost:3000`）。**不要为了「对上默认值」把服务改回 3000**：Minecraft 的 `Open to LAN` 会把 LAN 端口分到 3000，bridge 会连上 Minecraft 自己的 LAN 服务器并报 `HTTP/1.1 header parser received no bytes`（与 HTTP/2 故障文字相同、根因不同）。端点自发现已覆盖这种情况；只在需要显式指定时才加 JVM 参数（启动器 GUI 不继承 shell 环境变量，`SCAMCITY_API` 对它无效）：

```text
-Dscamcity.api=http://127.0.0.1:3001/api/simulation
```

注意 `ApiEndpoints` 是 `final`，mod 初始化时只读一次发现文件：若 `serve` 在游戏启动**之后**才重启，需要重进世界 bridge 才会重读。

目标 Minecraft profile 是 Java 1.21.11 + Fabric Loader 0.19.3，实际 gameDir 为 `D:\Minecraft`。关闭游戏后，把 `minecraft-bridge/build/libs/scamcity-bridge-0.1.0.jar` 放入 `D:\Minecraft\mods`，再启动 profile。

## 30 秒 readiness gate

```powershell
D:\Nodejs\npm.cmd run doctor
D:\Nodejs\node.exe scripts\scamcity-report.mjs
```

必须看到 API、100 citizens、5 scammers 和 bridge JAR 为 `PASS`。Minecraft 进入世界后依次执行：

```text
/scamcity clear
/scamcity anchor
/scamcity refresh
/scamcity status
/scamcity api
```

`status` 应显示 `HTTP`、snapshotId、cursor 和队列；`api` 应显示与浏览器相同的 API 地址。若日志仍显示旧 parser error，先完全退出 Minecraft 再启动，不能在旧进程中期待新 JAR 热加载。

两个容易误判的点：

- **`/scamcity api` 在首次成功 `refresh` 前必然显示「尚未确认」**。`api` 自己不发请求，「使用中」地址只在取快照成功后才赋值。看到「尚未确认」先执行 `refresh`，不要当成故障。
- **日志里 `[ZAAT] mod 同步失败` 不是本项目**。ScamCity 的报错前缀一律是 `ScamCity`。

## 三分钟主流程

1. Web 切换到 `LIVE API`，确认顶部出现 `LIVE API`、tick 和 snapshot 元数据。
2. Minecraft 执行 `/scamcity refresh`，确认控制塔显示 `LIVE`，再执行 `/scamcity start` 开启持续同步；单次 refresh 不开启轮询。
3. Web 点击 `START` 或 Minecraft 执行 `/scamcity intervene social-guardian`。
4. 等待下一次刷新，比较网页和 Minecraft 的 tick、eventSequence、victims 与事件文本。
5. 点击比较，展示 baseline / guardian 的 modeled outcome；说明 seed、时间窗和 synthetic 边界。
6. 观众事件使用结构化 API，例：

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/simulation `
  -ContentType application/json `
  -Body '{"type":"inject-event","eventId":"audience-01","event":{"type":"deepfake-voice","duration":72,"label":"现场观众触发：深度伪造语音扩散"}}'
```

同一 `eventId` 重试不会重复创建事件。自由文本入口只作为本地演示文案，不应宣称改变模型数值。

## 失败回退

- API 失败：Web 切换 `LOCAL DEMO`；Minecraft 执行 `/scamcity demo`，画面必须标记 `DEMO`，不要称作 live。
- Minecraft 无法加载：继续 Web `LIVE API`，在 Pitch 中说明空间投影不可用，API 状态仍可复核。
- 展示实体异常：执行 `/scamcity clear` 后重新 `/scamcity anchor`、`/scamcity refresh`，需要持续同步时再执行 `/scamcity start`。clear 同时停止轮询；清理只匹配 `tag=scamcity`，不会删除普通建筑。
- 新一轮排练：先 `POST {"type":"reset","seed":42}`，再刷新两端；API store 是进程内存储，服务重启会回到默认世界。

## 交付证据

`npm run report`（或直接运行 `scripts/scamcity-report.mjs`）会在 `evolution/runs/<timestamp>/` 生成：

- `run-manifest.json`：runId、seed、tick、eventSequence、source、指标和 active events；
- `readiness-report.json`：API、schema、人口和 bridge JAR 检查；
- `comparison.json`：baseline 与各干预的可复核指标摘要。

金额、victims、安全指数均为合成仿真结果。现场用“modeled outcome”描述，不把它说成真实预测或真实部署收益。

## 现场验收清单（当前 JAR 已安装，待现场执行）

这组检查用于验证主动启动、请求取消和刷新队列；编译或离线测试通过不代表游戏内检查通过。当前 JAR SHA-256 `a3d289a62a27970fc46b3a9d3e805b445636dc55859de3f768004895434313f4`（2026-09-20 16:20，七态配色 + 骗子人形）已安装到 `D:\Minecraft\mods`，必须先完全退出并重启 profile 再执行。

执行前两个必要前提（首次真机运行已证实缺一不可）：

- **profile 必须选 `fabric-loader-1.21.11`**。启动器里 `Agentcraft` 也指向 gameDir `D:\Minecraft`，但它是原版 `1.21.11`，**不加载任何 mods**。
- **必须开作弊**：`ESC` → `Open to LAN` → `Allow Cheats: ON` → `Start LAN World`。bridge 是纯客户端模组，靠玩家身份发 `/summon`、`/kill`、`/title`；无作弊权限时这些命令不在命令树内，每条都回显 `Unknown or incomplete command`，地上不会出现任何实体。只点 `Start LAN World` 而不开 `Allow Cheats` 无效。该设置为会话级，每次重进世界要重做。

1. 新进入世界时不应自动出现展示实体；执行 `/scamcity demo` 后才显示标注 `DEMO` 的场景。
2. 使用 `/scamcity start` 开启自动同步；在 API 状态不变时观察两个轮询周期，展示不应因相同画面反复删除重建。
3. 发起 `/scamcity refresh` 后立刻 `/scamcity clear`，等待至少 10 秒：旧 HTTP 响应不能重新显示城市。需要继续自动同步时显式执行 `start`。
4. 发起 refresh 后立即执行 demo：迟到的 HTTP 结果不能覆盖离线场景。
5. 渲染中连续刷新：当前批次应完成，随后使用最新等待快照，不无限堆积历史画面。
6. 更换世界或维度后，旧世界的待发命令和迟到响应不能进入新世界；重新执行展示命令，检查锚点属于当前位置。
7. 外部清除了展示实体后，手动 `refresh` 应能重建相同快照；`status` 的队列数字仅说明本地发送进度，不能证明服务器已执行成功。

以下四项是后续几轮新增、同样未在现场看过的内容：

8. **屏幕叠层**：左上角应出现面板，显示数据源、居民/骗子/受害数、损失与 comparison verdict。重点看**文字是否超出深色背板**（面板宽度已改为 `textRenderer.getWidth` 字体实测，替代原先每字符 6px 估算；叠层文案几乎全中文，CJK 步进约 9px）。另确认：数据源为离线时必须显示 `DEMO` 而非 `LIVE`；verdict 必带 disclaimer；按 F3 或打开聊天/任何 screen 时叠层应让位。
9. **七态市民配色**：`refresh` 后应能看到中间态，而不是满屏绿色。对应关系 `安全=绿 起疑=蓝 接触=黄 信任=橙 已点击=粉 受害=红 保护=青 骗子=紫`，控制塔图例同此八项。**重点是远看可辨性**：黄/橙/粉三色是为 100 格网格特意拉开的（网页端用三档橙色，6px 圆点可行但方块网格会糊成一片），若现场仍难区分需回报。推进模拟才会出现中间态：`POST {"type":"run","days":1}`。
10. **人物样式**：`/scamcity style people` 后市民与骗子都应是小人（市民染色皮甲，骗子紫甲 + 主手书）。骗子手持物是身份区分的主要线索，甲色在远处不够。同时留意 105 个盔甲架的**帧数代价**——默认仍为色块（`/scamcity style blocks`）正是因为这个代价未测量。
11. **网页叙述面板**：切到 `LIVE API` 后，左栏「04 / CITIZEN NARRATION」应出现按钮（`LOCAL DEMO` 模式下只显示说明文案，这是有意的：该路由读服务端 store，local 模式页面跑的是浏览器内自己的世界）。点一次 `NARRATE RECENT DECISIONS`，确认市民自述与引擎判定一致、`MODEL`/`RULES` 标注正确、长文本不溢出。超时设为 45s（参考值：2 个市民 7.7s），4 个市民的真实耗时未测。
