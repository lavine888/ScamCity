# 贡献指南

ScamCity 是一个**可复现、可解释的反诈干预沙盒**：规则引擎拥有事实，LLM 只负责可选解释。任何改动都必须维持下面这几条不变量，否则不会被合并。

## 项目不变量

1. **可复现优先**：seed、RNG、snapshot 与 cursor 可追踪；相同 seed + 相同干预必须得到相同结果。
2. **规则拥有事实**：谁受害、损失多少、干预是否成功、哪个 verdict 胜出，全部由确定性规则计算；LLM 不得改写模拟事实。
3. **优雅降级**：服务或 LLM 失败时仍可演示，并明确标注数据来源与降级状态；不得静默返回编造结果。
4. **有界交互**：事件、工具与预算走白名单；不引入隐式网络调用或不受限循环。
5. **先解释再优化**：指标同时展示收益、误报成本与干预成本，而不是只报“冠军”。
6. **合成数据**：不收集、不评分真实个人；不得把真实数据、密钥或案件材料写进仓库或发送给模型。

## 欢迎的贡献

- 新的合成诈骗场景包（附 seed、可复现步骤与预期 verdict）。
- 新的干预规则，或既有规则的边界/反例测试。
- 指标与 verdict 的可解释性改进。
- Minecraft bridge 与 bridge-harness 的投影、渲染验证。
- 文档、示例与 `evolution/` 运行手册的修正。

## 硬性规则

- 测试与 verify 脚本**不得**访问真实网络或调用真实 LLM provider。
- 不提交 API key、token 或 `.env*` 内容（`.env.example` 除外）。
- 不加入针对真实人群的评分、预测或执法类功能。
- 新增依赖需说明理由，并保持离线优先。

## 本地校验

CI 会用同样的命令，提交前请本地跑通：

```bash
npm ci
npm run typecheck
npm run lint

# 四个完全离线的契约检查：不需要服务、网关或 API key
node scripts/verify-counterfactual.mjs
node scripts/verify-intervention-agent.mjs
node scripts/verify-live-thought-consistency.mjs
node scripts/agent-sync-smoke.mjs

npm run build
```

最后一个检查需要实时服务（端口 3000，或让 `scripts/lib/endpoint.mjs` 的发现文件解析出真实端口）：

```bash
npm run start &
node scripts/verify-simulation-contract.mjs
```

## 提交信息

沿用仓库现有风格（Conventional Commits，描述可用中文）：

```text
feat: 增加深伪语音场景与对应干预
fix: 修正 popover 关闭后的 Finder 面板状态
ci: 在每次 push 与 PR 上校验模拟契约
docs: 补充三分钟故事线脚本
```

## Pull Request 检查清单

- [ ] `npm run typecheck` 与 `npm run lint` 通过。
- [ ] 四个离线契约检查通过。
- [ ] `npm run build` 通过；改动到 API 时 `verify-simulation-contract.mjs` 通过。
- [ ] 影响模拟结果时，附上相同 seed 的前后对比。
- [ ] 没有网络调用、密钥、真实个人数据，也没有把 LLM 变成事实来源。
- [ ] 影响输出契约时，同步更新 README 与相关文档。

## 安全与研究边界

本项目仅用于研究与教育：所有市民、行为、消息与结果均为合成数据，参数未针对真实人群校准，单次运行不证明任何策略普遍有效。贡献内容同样不代表任何官方立场。
