# 2026-09-19 首次真机加载：HTTP/2 协商缺陷与现场阻塞

## 背景

这是新 JAR 装好之后**第一次真实启动 Minecraft**。此前所有验收都是离线的（编译、`verifyBridgeLifecycle`、命令格式、hash、harness）。一上真机就暴露了两个离线验收无法发现的问题。

## 缺陷 1（代码 bug，已修）：HttpClient 默认 HTTP/2 导致取不到快照

### 现象

游戏内 `/scamcity refresh` 与 `start` 持续回退离线演示，聊天栏报：

```
API 不可用，已切换离线演示: HTTP/1.1 header parser received no bytes
```

`status` 显示 `已暂停 | 离线演示 | snapshot=offline-demo-42-0-4-0`。同时 Next.js dev server 日志里**完全没有**对应的 GET 记录——即请求从未到达服务端。

### 误判与纠正

一开始怀疑是系统代理：机器上 `ProxyEnable=1`、`ProxyServer=127.0.0.1:7890`（clash-meta，PID 18864）。这个方向是**错的**，被探针否证。

### 根因

`BridgeController` 的 `httpClient` 原本是 `HttpClient.newBuilder().connectTimeout(...).build()`，未指定协议版本。JDK 的默认是 HTTP/2，对明文 `http://` 目标会先尝试 h2c 升级；Next.js dev server 不响应该升级而直接断开连接，于是客户端看到「连接已建立但读到 0 字节」，且请求不进入服务端日志。

### 证据

用与 mod 完全相同的构造方式写了一个一次性探针（`ProxyProbe.java`，验证后已删除），对 live dev server 连跑 5 次，结果零偏差：

| 构造 | 结果 |
| --- | --- |
| 默认（HTTP_2）= 原代码 | FAIL `IOException: HTTP/1.1 header parser received no bytes` |
| `HTTP_1_1` | OK `HTTP 200`，130191 字节 |
| `HTTP_1_1` + `NO_PROXY` | OK `HTTP 200` |
| `HTTP_2` + `NO_PROXY` | FAIL 同上 |

唯一变量是协议版本；加不加 `NO_PROXY` 不影响结果，且 `ProxySelector.getDefault().select(...)` 返回 `[DIRECT]`，故代理被排除。探针同时确认 Minecraft JVM 命令行不含任何代理参数。

### 修复

`BridgeController` 的 client 固定为 `.version(HttpClient.Version.HTTP_1_1)`，并在代码注释中写明原因与证据。

### 为什么离线验收抓不到

`verify-command-format.mjs`、`verifyBridgeLifecycle`、`bridge-harness/verify.mjs` 都不发真实 HTTP 请求；`npm run doctor` 用 Node 的 fetch 而非 Java 的 `HttpClient`。这个缺陷只在真机 Java 客户端访问 Next.js dev server 时出现。

## 缺陷 2（环境/操作，未修完）：命令权限

### 现象

`/scamcity anchor` 自身成功（`ScamCity 城市中心已锁定在当前位置`），但它随后发出的每条 `summon`/`kill`/`title` 都被拒：

```
kill @e[tag=scamcity]<--[HERE]
Unknown or incomplete command. See below for error
```

`kill @e[tag=scamcity]` 不含任何 NBT，语法合法却报「未知或不完整的命令」——说明该命令不在当前会话的命令树内，即无作弊权限，而非命令格式问题。

### 原因

存档 `Agent Education` 的 `level.dat`：`allowCommands = 0`、`GameType = 0`（生存）。bridge 是纯客户端模组（`fabric.mod.json` 中 `environment: client`），靠 `client.getNetworkHandler().sendChatCommand(...)` 以玩家身份发命令，因此必须有作弊权限。

用户已执行 Open to LAN（日志 `Started serving on 62756`），但 17:27 的 `summon` 仍被拒，说明开启时 **Allow Cheats 未打开**。

### 结论

这一项**未解决**，需用户在 GUI 内完成：`ESC` → `Open to LAN` → `Allow Cheats: ON` → `Start LAN World`。不修改用户存档文件（`allowCommands` 保持 0），该设置为会话级。

## 另一个环境陷阱

启动器有两个 profile 都指向 gameDir `D:\Minecraft`：

- `Agentcraft` → 版本 `1.21.11`（**原版，不加载 mods**）
- `fabric-loader-1.21.11` → `fabric-loader-0.19.3-1.21.11`（**必须用这个**）

依赖齐全：`fabric-api-0.141.4+1.21.11.jar` 满足模组要求的 `>=0.141.4`。

## 已确认成立的部分

- 17:16:56 日志出现 `ScamCity bridge loaded; use /scamcity refresh or /scamcity demo`，模组本体在 Fabric 1.21.11 + Loader 0.19.3 下**可正常加载**（这是首次真机确认）。
- `/scamcity api`、`anchor`、`clear`、`status`、`demo` 的命令注册与回显正常。
- 离线演示回退路径按设计工作，且明确标注 `DEMO`，未冒充 live。
- 市民稳定投影的真实输出可见：日志中出现 `citizen-059 安全`、`citizen-068 高风险`、`scammer-02 SCAMMER` 等标签，坐标按 cell 递增排列，与 `CitizenGrid` 设计一致。

## 本轮已执行

- `./gradlew clean build` 成功，`verifyBridgeLifecycle` 输出 `PASS: request lifecycle, scene queue and citizen grid regressions`
- `node verify-command-format.mjs` 通过
- 产物可复现：连续两次 `clean build` 的 SHA-256 均为 `16f0d4adc0f7d0d0585325ccabcf86cb7b98cf34e63984820ae4ae63002a7287`
- 安装前确认 Minecraft 进程已退出；新 JAR 已同步到 `minecraft-staging/mods/` 与 `D:\Minecraft\mods\`，三处 hash 一致
- 回滚备份 `D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-http1-20260919-174311.jar`（内容为上一基线 `7adfb509...`）
- readiness gate：`npm run doctor`（api PASS、bridge-jar PASS `16F0D4AD…`）、`verify-simulation-contract.mjs` OK、`npm run report` 全 PASS（`evolution/runs/2026-09-19T09-43-33-802Z/`）、`bridge-harness/verify.mjs` passed
- 一次性探针文件已删除（`ProxyProbe.java`、`probeout/`）

## 待验收

- **HTTP/1.1 修复的真机验证**：修复后的 JAR（`16f0d4ad...`）尚未在游戏内跑过。需重启 profile 后确认 `status` 显示 `HTTP` 与真实 `snapshot=42-0-2-0`，而非 `offline-demo-*`。
- **命令权限**：需在开启 Allow Cheats 的会话中确认 `summon`/`kill`/`title` 不再被拒、网格实体真实出现。
- **RUNBOOK 七项现场检查**：仍全部未执行。
- 上述两项都通过之前，不得宣称双端 live 已闭环。
