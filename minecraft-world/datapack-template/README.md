# Datapack template

这是一个只负责 Minecraft 本地 HUD、生命周期和安全清理的最小模板。它不会访问 Web API；HTTP 轮询、实体 upsert 和干预 POST 由 Fabric bridge 负责。

1. 将 `pack.mcmeta.template` 复制为 `pack.mcmeta`，根据实际启动的 Java 版本填写 `<PACK_FORMAT>`。
2. 将整个 `datapack-template` 复制为一个 datapack 目录，再通过游戏内 `/datapack list` 检查是否加载。
3. 首次加载后执行 `/function scamcity:load`；重置只执行 `/function scamcity:reset`。
4. `commands/` 下的文件是桥接层的替换模板，不要直接作为 datapack function 加载。桥接层应先完成 JSON 转义和占位符替换，再通过客户端命令执行。

`reset.mcfunction` 只删除带 `scamcity.*` 标签的 display/marker 实体，不会清理用户已有的生物、方块或玩家。建筑预览模板仍需在副本世界中人工审阅后运行。
