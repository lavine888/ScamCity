# ScamCity ↔ Minecraft bridge harness

这个目录是 ScamCity Web Demo 与 Minecraft Java 展示层之间的一个轻量验证工具。它只读取 `GET /api/simulation` 的世界快照，或读取同样结构的离线 fixture；不会安装 mod、启动 Minecraft，也不会修改 `.minecraft` 或用户存档。

## 运行

使用 Node 18+（只依赖原生 `fetch`、`fs` 和 `assert`）：

```powershell
# 离线验证，不需要启动 ScamCity
node bridge-harness/verify.mjs

# 离线生成一份人类可读日志
node bridge-harness/cli.mjs --fixture bridge-harness/fixtures/offline-snapshot.json

# 读取当前本地 Web Demo，并写出完整 JSON
node bridge-harness/cli.mjs `
  --url http://localhost:3000/api/simulation `
  --out bridge-harness/out/latest.json

# 让城市中心位于 Minecraft 的 (100,70,-40)，展示区域 160×120 格
node bridge-harness/cli.mjs `
  --fixture bridge-harness/fixtures/offline-snapshot.json `
  --origin 100,70,-40 --size 160,120 --json
```

`--json` 将完整结果打印到 stdout；不加时打印简短日志。`--out` 会同时保存 JSON，文件包含 `snapshot`、`delta` 和 `commandPlan` 三部分。`--previous` 可以传入上一次 bridge 结果或 API 快照，用于生成增量。

## 桥接契约

输出的 `schemaVersion` 是 `scamcity.minecraft-bridge/v1`。每个 citizen 都被转换为一个稳定的展示标记：

- 模拟坐标 `x/y ∈ [0,100]` 映射到 Minecraft 的 `x/z`；地图中心是 `origin`，横向尺寸是 `width`，纵向尺寸是 `depth`，高度固定为 `groundY`。
- `riskScore` 由风险意识、压力、冲动性、数字素养和当前状态组成，用于展示层排序，不声称是现实预测。
- `low` / `medium` / `high` 对应绿色 `#40e0a0`、黄色 `#f7c948`、红色 `#fb3b50`，并同时提供 `minecraftColor` 和归一化 RGB。
- 五个 scammer 没有原生位置，工具将它们放在城市边界的五个固定点，便于在 Minecraft 中直观看到威胁来源。

`commandPlan` 是给 Fabric mod 或命令执行器消费的意图层。完整同步包含清理旧标记、105 个 marker（100 个 citizen + 5 个 scammer）、HUD 和事件广播；增量同步只包含状态/位置变化的 citizen、最新事件和 HUD。每个 marker 同时带有可审阅的 vanilla `summon minecraft:marker` 建议命令，实际执行仍由 Minecraft 适配层负责。

事件 ID 是增量边界：工具会拒绝重复 ID，`delta.newEvents` 只包含上一个快照没有见过的 ID。这样即使 Web Demo 的 `eventFeed` 是截断窗口，也不会因为重复拉取而在大屏或世界内重复广播。

## 离线 fixture

`fixtures/offline-snapshot.json` 是由 `create-fixture.mjs` 生成的 API 形状快照，固定包含 100 个 synthetic citizens、5 个 scammer 和 4 个唯一事件。需要更新 fixture 时执行：

```powershell
node bridge-harness/create-fixture.mjs
```

`verify.mjs` 会覆盖以下验收路径：数量契约、唯一事件 ID、模拟坐标到 Minecraft 整数坐标、风险颜色映射、完整同步的 105 个 marker、状态变化与新事件的增量同步，以及重复事件 ID 的拒绝。
