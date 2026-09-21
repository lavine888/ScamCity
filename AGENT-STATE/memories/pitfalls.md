# 已知坑

- **市民状态词表有七个值，漏一个就把「正在被骗」画成「安全」**：权威定义在 `types/index.ts` 的 `CitizenState`：`safe → suspicious → engaged → trusted → clicked → victim`，另加 `protected`。`BridgeController.status()` 曾只认 `victim`/`protected`，其余四态全落到兜底绿色——漏斗中段静默消失，而那正是产品要展示的东西。新增状态时**必须同时**改 Java switch、图例行、和 `verify-command-format.mjs`（它从 TS union 解析后逐态要求 Java 有显式分支，这条断言已做过负向测试）。市民 payload **没有** `riskScore`/`risk`/`score` 字段（实际叫 `riskAwareness`），不要再根据它们判断风险等级。市民色不得使用 `purple_concrete`（骗子专用）。
- **断言不要写成硬编码计数**：原「双标签 summon 必须正好 3 处」在新增一种实体时就撞线，把真检查变成减速带。已改为遍历所有 `summon` 模板逐个校验不变量。写此类正则时注意：Java 字符串内有 `\"` 转义，`"summon [^"]*"` 会在第一个转义引号处截断模板，必须用 `"summon (?:\\.|[^"\\])*"`。
- **`python3` 在本机是 Microsoft Store 存根，会静默退出**：用它做负向测试的探针会“通过”得到假阴结论（已造成一次误判「断言无效」）。改脚本文件用 Node 跑，并断言“探针编辑确实已应用”再看结果。
- **`npx next lint` 在本仓未配置**：会交互式提示创建 ESLint 配置并挂住，在非交互环境下返回非零。不要把它当作“lint 失败”；要纳入 gate 得先显式创建配置。
- **叙述面板只在 live 模式有效**：`/api/llm/thoughts` 读的是服务端 store，而 dashboard 在 local 模式下跑浏览器内自己的世界。两者混用会让叙述描述另一座城市，这是正确性缺陷而非观感问题，因此面板在 local 模式下不提供按钮。
- **React 重入保护用 ref 不用 state**：state 更新是异步的，两次快速点击可在首次 re-render 前都通过 `if (busy) return`；把 busy 放进 dep array 还会让回调身份在飞行中变化。本仓统一用 `*RequestRef`。

- **端口 3000 会被 Minecraft 自己抢走**：`Open to LAN` 把 LAN 端口分到 3000 时，任何硬编码该端口的组件都会连上 Minecraft 自己的 LAN 服务器，报 `HTTP/1.1 header parser received no bytes`——**与 HTTP/2 故障文字相同、根因不同**，已造成一次误判。本轮起 bridge 与 Node 工具链都改为自发现（`npm run serve` 写 `<tmpdir>/scamcity-endpoint.json`），并且**必须校验响应含 `schemaVersion=scamcity.simulation/v1`**：端口有人应答不等于 ScamCity 在应答。不要为了「对上默认值」把服务改回 3000。诊断时先看 `/scamcity api` 显示的「使用中」地址。
- **`doctor` 曾在服务健康时报 FAIL**：原因同上（硬编码 3000）。已实测复现并修复；若再看到 api FAIL，先确认它打印的候选地址列表，而不是先怀疑服务。
- **叠层不要引入贴图**：`ScamCityHud` 只用 `fill`/`drawText`，没有任何资源需要加载，因此不会在运行时失败。omo 的 HUD 走 `NativeImageBackedTexture` + 浏览器截帧，那条路依赖外部进程，本项目不需要。

- **Java HttpClient 默认 HTTP/2 连不上 Next.js dev**：`HttpClient.newBuilder()` 不指定版本时 JDK 默认 HTTP/2，对明文 `http://` 会先尝试 h2c 升级；Next.js dev server 不应该升级而直接断开，表现为 `IOException: HTTP/1.1 header parser received no bytes`，且请求**不会出现在服务端日志**里。必须显式 `.version(HttpClient.Version.HTTP_1_1)`。这类缺陷所有离线验收都拓不到（它们不发真 HTTP，`doctor` 用 Node fetch 而非 Java HttpClient）。诊断时不要先怀疑代理：先用与生产相同的构造方式写一个 Java 探针对比 HTTP_2 / HTTP_1_1 / NO_PROXY，并看 `ProxySelector.getDefault().select(...)` 是否为 `[DIRECT]`。
- **启动器有两个 profile 指向同一 gameDir**：`Agentcraft` 用的是原版 `1.21.11`，**不加载任何 mods**；必须选 `fabric-loader-1.21.11`（`fabric-loader-0.19.3-1.21.11`）。两者 gameDir 都是 `D:\Minecraft`，很容易选错后误判为「模组未加载」。
- **纯客户端模组需要作弊权限**：bridge 是 `environment: client`，靠以玩家身份发 `/summon`、`/kill`、`/title` 画图。存档 `allowCommands=0` 时这些命令**不在命令树里**，回显是 `Unknown or incomplete command`（即使命令不带任何 NBT）——不要误诊为命令格式问题。解法：`ESC` → `Open to LAN` → `Allow Cheats: ON` → `Start LAN World`（会话级，不写存档；每次重进世界要重做）。只点 `Start LAN World` 而没打开 `Allow Cheats` 无效。
- **实际 Minecraft 路径**：launcher profile 使用 `D:\Minecraft`，不是 `%APPDATA%\\.minecraft`；安装和日志检查必须针对前者。
- **JAR 不热加载**：复制新 bridge 后必须完全退出 Minecraft 再启动，旧进程会继续使用旧类和旧命令格式。
- **开发缓存**：Next dev 进程和生产 build 共用 `.next` 时可能出现旧模块缓存/健康路由异常；生产构建前停止 dev，验证时使用新进程。
- **API 存储边界**：`SimulationStore` 是进程内单例，服务重启会丢失本局；使用 `scripts/scamcity-report.mjs` 保存可复核摘要。
- **离线语义**：Web `LOCAL DEMO` 与 Minecraft `/scamcity demo` 必须显示 offline/demo，不得冒充 API live 同步。
- **日志证据**：旧 `latest.log` 中的 parser errors 不能证明新 JAR 失败；先重启目标 profile，之后再运行 `npm run doctor`。
- **跨 Agent smoke**：`scripts/agent-sync-smoke.mjs` 默认写入临时隔离根，不会污染 `AGENT-STATE/coordination/`；只有显式 `--shared` 才写共享日志（会留下已完成 smoke 任务）。当前 Codex Windows 沙箱禁止 Node 子进程，可能报 `spawn EPERM`；在正常本机终端运行即可。多进程压测用 `node scripts/agent-sync-soak.mjs`（同样隔离）。
- **协调租约**：lease 到期后状态是 `needs-reconcile`；必须先判断外部副作用，再重新 claim。旧 `ownerId + leaseId + generation` 永远不能继续写。
- **`.env.local` 里有真实网关 key，而本仓不是 Git 仓库**：`.gitignore` 已排除 `.env.local`，但 `git rev-parse` 返回 `not a git repository`——**没有历史、没有回滚、没有 pre-commit 兜底**。任何打包、复制工作区、共享屏幕或录屏都可能泄露该 key。演示结束后到网关控制台轮换。另外 `scripts/set-openai-next-key.mjs` 会**同时**写 `~/.pi/agent/models.json` 和 `.env.local`，因此只删 pi 的 provider 不等于删掉 key；两处要分别处理。
- **presenter 面板标称 3:00，实际约 204 秒**：`PRESENTER_DURATION_MS=180_000` 只用于标题渲染，阶段间隔是 `:926` 的 25.5 秒 × 8 阶段 ≈ 204 秒。照标题排练会少算约 24 秒。演示脚本（`DEMO_SCRIPT.md`）按 180 秒写，若改用 presenter 模式需按 204 秒重排。
- **`DEMO MODE` 与 `3-MIN PRESENTER` 是两个不同的计时器**：前者 1.5 秒 + 7 × 8.5 秒 ≈ 61 秒，后者 ≈ 204 秒。文档里只说「三分钟模式」会混淆两者；且两者在 `LIVE API` 模式下都被 disabled（`presenter-button`/`demo-button`），presenter 是 local-only 的。
