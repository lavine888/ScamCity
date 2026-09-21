# 2026-09-20 屏幕叠层与端口自发现（参考 omo-minecraft 取长补短）

记录者：root；时间：2026-09-20T11:55+08:00
产物：`scamcity-bridge-0.1.0.jar` SHA-256 `3938312a06f643a3e58394b333a44f57b2ad643971d5a4ebceb287f375ac20de`

## 参考对象

用户要求参考 `https://github.com/harrythentrepreneur/omo-minecraft`（AgentCraft/Omo）。已浅克隆读取，规模约 26k 行 Java + Node runtime。

架构差异（事实，非评价）：

| | omo-minecraft | ScamCity |
| --- | --- | --- |
| MC 侧 | Paper **服务端插件**（Bukkit API，自带 op 权限） | Fabric **客户端模组**，以玩家身份发命令 |
| 通道 | 常连 WebSocket，服务端推 | `HttpClient` 轮询 |
| 渲染 | Villager + ArmorStand 全息 + **BossBar** + 讲台书 + 地图墙 | `block_display` / `text_display` / 可选盔甲架 |

**未采用**的部分及原因：
- 换 Paper 插件能一次性消掉「作弊权限」与「命令 256 字符上限」两类坑，但要重写整个渲染层，且现场路径从「装 mod 进单人世界」变成「起服务端 + 连本地服」。黑客松前不换赛道；已记入长期选项。
- 该仓库 26k 行 Java 零回归测试（`find` 仅得 lockfile/package.json）。ScamCity 的 `verifyBridgeLifecycle` / `verify-command-format` / 契约脚本是资产，不为学其形态放弃。
- 其 `config.yml` 明文 `token: "change-me-shared-secret"`，且 `:8766`/`:8767`（含真 PTY 终端）绑 `0.0.0.0` 无鉴权。**不学**。
- 其 `BridgeClient` 用 `HttpClient.newHttpClient()` 未指定版本；因 WebSocket 握手本身是 HTTP/1.1 升级而侥幸绕过了 2026-09-19 踩的 HTTP/2 坑，不是可复用的经验。

**采用**的两点，都对应本项目已记录的真实阻塞。

## 一、屏幕叠层（借 BossBar/HUD 思路，关闭 A-19 游戏端缺口）

omo 用 BossBar + 主手物品 + 讲台书承载状态，这些通道**不占世界实体预算**。ScamCity 的实体预算已被 100 市民 + 标签占满，人形模式还要翻倍，而 A-19 的验收缺口正是「Minecraft 端不显示主判定」。

新增：
- `HudState.java`（无 Minecraft 依赖，进验证源集）—— 叠层内容与文案。
- `ScamCityHud.java` —— 纯 `fill` + `drawText`，无贴图、无资源，实现 `HudElement`，经 `HudElementRegistry.addLast` 注册。
- `BridgeController` 新增 `volatile HudState hud`，`applySnapshot` 末尾更新；`start`/`stop` 走 `refreshHud()`；`clear` 与换世界置 `HudState.EMPTY`。

已确认 `fabric-api 0.141.6+1.21.11`（本项目现用版本）含 `net.fabricmc.fabric.api.client.rendering.v1.hud`，`javap` 核对 `HudElement.render(DrawContext, RenderTickCounter)` 与 `HudElementRegistry.addLast` 签名一致；`DrawContext.fill(int,int,int,int,int)` 与 `drawText(TextRenderer,String,int,int,int,boolean)` 均存在于 1.21.11 yarn 映射。

设计约束（已写成断言）：
- 数据源必须诚实：`DEMO` 绝不能显示成 `LIVE`；首帧前显示「待同步」而非把过期的 0 当真实数据。
- verdict 必须带 disclaimer：单 seed 的排名不是普适结论。`disclaimer` 字段缺失时不自行编造出处。
- 让位 F3 与任何打开的 screen，否则两者都读不清。
- 长 reason 按字符预算裁剪并以 `…` 显示，因为面板宽度由文本算出。

## 二、端口自发现（消掉 3000 被占的反复踩坑）

2026-09-20 早间的真机故障：端口 3000 的监听者是 Minecraft 自己（`Open to LAN`），bridge 连上它后报 `HTTP/1.1 header parser received no bytes` —— 与 2026-09-19 的 HTTP/2 故障**文字相同、根因不同**，已造成一次误判。服务实际在 51662，而启动器 GUI 不继承 shell 环境变量，`SCAMCITY_API` 对它无效。

新增 `ApiEndpoints.java`（无依赖，进验证源集）+ `scripts/scamcity-serve.mjs` + `scripts/lib/endpoint.mjs`：

1. **自发现**：`npm run serve` 把实际绑定的 URL 原子写入 `<tmpdir>/scamcity-endpoint.json`（先写临时文件再 `rename`，因为读方无锁轮询），退出时删除。两个进程同机共享文件系统，端口不再靠猜。
2. **身份校验**：响应必须含 `schemaVersion=scamcity.simulation/v1` 才被接受。**端口有人应答不等于 ScamCity 在应答** —— 这正是当时的误导信号。不匹配时报「端口有服务但不是 ScamCity」并指出常见原因。
3. **失败切换**：候选按序尝试；显式配置的地址**单独返回**（操作者指定了端口，悄悄连上别的会掩盖其错误）；已确认的端口优先，失败后遗忘以便重新发现。整条链共用一个 request ticket，所以被放弃的候选的迟到响应不会解锁新请求。

安全边界：发现文件位于共享临时目录，视为**不可信输入**，只接受 loopback `http://`（字面 host 比对，拒绝 `localhost.evil.com`、authority 带凭据、非数字端口），防止恶意文件把 bridge 指向远端。

顺带修同类缺陷：`scamcity-doctor.mjs`、`scamcity-report.mjs`、`bridge-harness/cli.mjs` 都硬编码 3000。已实测 doctor 在 3000 被占时会报 FAIL 而服务其实健康 —— 与真机故障同源。三处改用共享 `scripts/lib/endpoint.mjs`。

另外把 **verdict 写入 report**（`comparison.json` 新增 `verdict` 字段，含 rule/ranking/scorecards/disclaimer）。此前归档的 run 有比较数字但没有「按约定规则选出了谁、为什么」的记录。

## 验证

离线全通过：
- `gradlew --offline check`（含 `verifyBridgeLifecycle`）PASS，新增 endpoint 与 HUD 两组回归。
- `gradlew --offline clean build` 连续两次 hash 一致：`3938312a06f643a3e58394b333a44f57b2ad643971d5a4ebceb287f375ac20de`。
- `npx tsc --noEmit` OK；`verify-command-format.mjs` PASS（新增 6 条断言锁定：禁止回到单一硬编码端点、必须校验 snapshot 身份、HTTP/1.1 必须保持钉住、verdict 从快照根读取、`hud` 必须 volatile、叠层不得引入贴图）。
- `bridge-harness/verify.mjs` passed。
- `verify-simulation-contract.mjs` OK（`verdict=bank-risk-agent`），新增跨语言常量防漂移断言：`ApiEndpoints.java` 的 `SCHEMA_VERSION` / `DEFAULT_URL` / `DISCOVERY_FILE` 必须与 JS helper、与 API 实际返回值、与 serve 脚本一致。Java 无法 import JS，三份副本靠此绑定。

**端口故障已实测复现并修复**：用一个占据 3000 的假监听器模拟 `Open to LAN`，serve 脚本自动改用 57662/51930 并发布端点；`doctor` 与 `report` 均正确找到真实服务并在输出中显示所用端口（此前会直接 FAIL）。Java 读取侧另用反射探针对**真实 serve 输出**复算，确认发现的端口排在首位。

自查修正一处自己引入的缺陷：`scamcity-serve.mjs` 最初用 `spawn("npx", ..., {shell: true})`，Node 报 DEP0190（shell 模式下参数拼接不转义，是命令注入面）。改为 `createRequire` 解析 `next/dist/bin/next` 并以 `process.execPath` 直接执行，链路中无 shell，警告消失。

安装：Minecraft 未运行（`tasklist` 确认 `javaw` 计数 0）时同步三处（`build/libs`、`minecraft-staging/mods`、`D:\Minecraft\mods`），旧 JAR 备份于 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-hud-endpoint-20260920-114734.jar`（hash `c04894be...`）。

## 未验收（不得写成已验证）

- **叠层在游戏内从未看过**。签名经 `javap` 核对、逻辑有回归，但实际绘制位置、可读性、与 F3/聊天的互让均为观感与运行时行为，未测量。
- **HUD 帧数代价未测**，与人形市民的 100 个盔甲架代价一样未测。
- 端口自发现的**真机**验证未做：已验证的是 Node 侧工具链与 Java 侧解析，尚未在 Minecraft 里跑 `/scamcity api` 看它是否读到发现文件。
- 本轮未改动 A-12 / A-13 结论，两者的现场状态与上轮相同。
