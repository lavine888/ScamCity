# 2026-09-19 刷新稳定性离线验收与安装

## 范围

接手 `/root/finish_bridge_iteration` 的刷新稳定性迭代，完成交接清单第 5 项：Java 行为回归、命令格式检查、Gradle 构建、产物 hash 核对，并在通过后更新 staging 与 `D:\Minecraft\mods` 安装状态。未做真实游戏内 E2E。

## 已执行（离线，可复核）

在 `minecraft-bridge/`：

- `node verify-command-format.mjs` → `Minecraft text command format check passed`
- `./gradlew check --console=plain` → `BUILD SUCCESSFUL`，`verifyBridgeLifecycle` 输出
  `PASS: request lifecycle and scene queue regressions`
- `./gradlew clean build --console=plain` → `BUILD SUCCESSFUL`（10 tasks executed）

回归覆盖交接清单第 1–4 项：

1. 队列边界：`finish active, coalesce latest` 断言 A 发完后 B 待处理时提交 C，最终只播放 `draw A, kill C, draw C`，不重放旧 B。
2. 自动去重不吞手动：`auto does not cancel manual redraw` 断言同画面的手动强制刷新保留。
3. 迟到响应 fencing：`invalidated response rejected` / `old response cannot unlock new request` / `world change rejected before tick` / `disconnected response rejected`。
4. 发送失败重试：`failed send can retry full scene`。

## 产物

- 新构建产物：`minecraft-bridge/build/libs/scamcity-bridge-0.1.0.jar`
- SHA-256：`a223c206caebbb9c5d2c6a6fa58a7dd49d1f711e10b825c03681ed40dc99b7e8`
- 可复现性：`clean build` 前后 hash 一致（先构建后备份比对），remapJar 输出字节稳定。
- 旧基线（本轮改造前）：`bcf2fe7f43473bbf384c5f37822bbbbf13a1d908a4669b43e976ad6c124708df`

## 安装（已执行，可回滚）

- `minecraft-staging/mods/scamcity-bridge-0.1.0.jar` 已更新为新 hash。
- `D:\Minecraft\mods\scamcity-bridge-0.1.0.jar` 已更新为新 hash。
- 覆盖前旧 JAR 备份：`D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-refresh-stability-20260919-155735.jar`（hash 为旧基线 `bcf2fe7f...`）。
- 安装时 Minecraft 未运行（`latest.log` 停在 02:27），因此不存在旧进程继续持有旧类的问题。

## 未完成 / 边界

- 真实 Minecraft E2E 仍未验收：需要完全重启 Fabric 1.21.11 / Loader 0.19.3 profile，进入世界后按 `evolution/RUNBOOK.md` 的七项检查执行。
- 未测：真实 `/summon`、`/kill`、`/title` 权限；真实队列耗时与闪烁；跨世界/换维度行为。
- 本 worklog 只证明离线编译、回归和文件 hash；不得据此宣称游戏内已加载新 JAR。
