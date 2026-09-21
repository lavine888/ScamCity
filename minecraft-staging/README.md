# Minecraft 1.21.11 staging bundle

这个目录是已验证的待安装包。

> **状态（2026-09-21 就地标注）：本节已过期。** 该 JAR 早已安装到 `D:\Minecraft\mods\scamcity-bridge-0.1.0.jar`（当前 SHA-256 见 `AGENT-STATE://resources/artifacts.md`），本目录只是构建产物的 staging 副本。本节正文保留原样作为初始状态记录；安装状态请以 `npm run doctor` 和 artifacts.md 为准。

## 内容

- `mods/fabric-api-0.141.6+1.21.11.jar`：与当前 `Minecraft 1.21.11` profile 匹配的 Fabric API。
- `mods/scamcity-bridge-0.1.0.jar`：已构建的 ScamCity 展示桥接模组。
- `manifest.json` 与 `SHA256SUMS.txt`：文件版本和校验值。

当前用户实例里已有 `fabric-api-0.116.17+1.21.1.jar` 与 `voicechat-fabric-1.21.1-2.6.21.jar`。它们不是 1.21.11 的依赖，不能和这套 profile 直接混用。安装前应关闭 Minecraft，并把这两个旧版本移到一个带时间戳的备份目录，而不是删除。

## 安装原则

1. 确认 Minecraft 和 Launcher 都已退出。
2. 备份现有的两个 1.21.1 mod 文件。
3. 将本目录的两个 jar 复制到**实际 gameDir 的 `mods` 目录**。本机启动器 profile 的 gameDir 是 `D:\Minecraft`（`minecraft-bridge/README.md` 与 `AGENT-STATE://memories/pitfalls.md` 均已确认），因此目标是 `D:\Minecraft\mods`，**不是** `%APPDATA%\\.minecraft\\mods`。
4. 启动 `fabric-loader-0.19.3-1.21.11`，进入世界后先确保单人世界已允许作弊，或你在服务器拥有执行 `/summon` 等命令的权限；先执行 `/scamcity demo`，再执行 `/scamcity refresh` 或 `/scamcity start`。
5. 如果需要回滚，关闭游戏，移除这两个 1.21.11 jar，再把备份目录中的旧文件移回 `mods`。

本轮没有自动执行上述外部目录操作，也没有修改 `New World` 存档。
