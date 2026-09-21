# 2026-09-19 市民稳定投影（A-13）

## 范围

把 Minecraft bridge 的市民布局从「数组下标」改为「按 citizen id 稳定投影」，并补离线回归。对应验收矩阵 A-13（原状态 FAIL）。

## 问题

`enqueueCitizens` 原实现用 `i % 10` / `i / 10` 由数组下标算格子。后果：API payload 一旦增删市民或改变顺序，下游所有市民都会换到不同方块；状态没变的人也会「跳位」，且会让 `SceneQueue` 认为场景变化而整体重建。

## 实现

新增 `minecraft-bridge/src/main/java/com/baytech/scamcity/bridge/CitizenGrid.java`：

- 格子由 `FNV-1a(32位)` 对 citizen id 求哈希后 `floorMod` 到 `[0,100)`；
- 先用 `TreeSet` 排序去重，再线性探测解决碰撞，所以结果只依赖 id 的**集合**，与到达顺序无关；
- 超出 100 格容量的 id 被丢弃而不是叠放，避免两个市民占同一方块；
- 逐字节折叠（低位/高位各一次），非 ASCII id 不会被截断。

`BridgeController.enqueueCitizens` 改为：先构建 id→citizen 名册，再 `CitizenGrid.place(...)`，最后**按 cell 序**发命令。按 cell 序发送是必要的：这样「顺序变了但内容没变」的快照会生成逐字节相同的命令流，`SceneQueue` 才能把它判为同画面并跳过重建。

移除了 `MAX_CITIZENS` 常量（容量改由 `CitizenGrid.CELLS` 表达）。

## 已执行

- `./gradlew clean build` 成功；`verifyBridgeLifecycle` 输出 `PASS: request lifecycle, scene queue and citizen grid regressions`
- 新增回归断言：满编 100 人全部落位、无两人同格、cell 在网格内、打乱顺序结果不变、倒序结果不变、重复 id 收敛为一格、超容量时容量被限制且不叠放、非 ASCII id 可落位且互不相同
- `node verify-command-format.mjs` 通过（该检查针对我改动过的 `BridgeController.java`）
- 产物可复现：连续两次 `clean build` 的 SHA-256 均为 `7adfb50962f51f98ed44ecf5000084ecce632712e32c1e15df27ea50aec13c41`
- 对**真实 live API** 数据复算投影：100 个 id（`citizen-001`…`citizen-100`）全部非空且唯一，映射为 100 个互不相同的 cell，即满编时是一个固定置换
- 安装前确认无 Minecraft 进程（只有 Gradle daemon）；新 JAR 已同步到 `minecraft-staging/mods/` 与 `D:\Minecraft\mods\`
- 回滚备份：`D:\Minecraft\.codex-backups\scamcity-bridge-0.1.0-pre-stable-grid-20260919-165331.jar`（内容为上一基线 `a223c206...`）
- readiness gate 复跑：doctor（api PASS、bridge-jar PASS `7ADFB509…`）、`verify-simulation-contract.mjs` OK、`npm run report` 全 PASS（`evolution/runs/2026-09-19T08-54-28-357Z/`）、`bridge-harness/verify.mjs` passed
- 验证后已关闭 dev server，端口 3000 已释放

## 边界与未完成

- **未实现 `layout.json`**：A-13 退出条件提到「位置来自 `layout.json` 公式」。本轮用代码内稳定哈希实现了「同一 ID 跨 refresh 不跳位」和「碰撞按稳定哈希解决」两项，但没有外部布局配置文件。不应宣称 A-13 已完全按原文关闭。
- **碰撞链边界**：增删 id 仍可能移动同一条探测链上的其他成员。满编 100 人占满 100 格时布局是固定置换，演示路径不会触发；非满编场景仍可能局部位移。
- **无 id 的 payload**：退化为按下标生成 `index-<i>` 作为键，这是唯一仍会因插入而位移的情况；标签文字也会显示 `index-5` 而不是旧的 `C006`。
- **仍是全量重建**：本轮没有改 A-12（增量渲染）。`applySnapshot` 依旧先 `kill @e[tag=scamcity]` 再重建。
- **真实游戏内未验收**：以上都是离线编译、回归与磁盘/HTTP 证据。方块是否真的不再跳位、闪烁与队列耗时，仍需重启 Fabric profile 后在世界里观察。
