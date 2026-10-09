# ExpertMesh：近一个月 Agent 技术调研与下一阶段设计

检索日期：2026-10-09（北京时间）。时间窗口：2026-09-09 至 2026-10-09，按来源明确标注的发布日期或论文提交日期纳入，不把网页抓取日期当作发布日。

本轮是调研与设计，不修改应用功能。资料来自官方发布、作者论文和作者仓库；已打开来源核对日期与内容。Grounding Agent Memory、JAM 阅读了正文中的机制与实验设置；其他论文主要核对摘要和版本记录，未复现实验。工程示例与作者公布的效果不等于 ExpertMesh 已验证的效果。

## 1. 对项目的判断

本轮资料支持我们继续发展“有长期身份、可恢复、可积累经验的助手团队”。下一步应把助手身份、任务执行、记忆来源、工具授权分开建模，并通过实际任务证明协作收益。

这是项目设计判断，不是这些资料共同证明的通用最优架构。优先顺序建议：先补可测量的执行记录和任务契约，再补有来源的记忆，随后扩大执行工具。

## 2. 时间窗口内的资料

| 日期 | 一手来源 | 本轮确认的进展 | 证据与边界 |
| --- | --- | --- | --- |
| 09-10 | [Grounding Agent Memory](https://arxiv.org/abs/2609.11060) | 异步记忆整理助手用只读环境工具核验候选记忆 | arXiv v1；无需重训练；论文特定环境实验 |
| 09-14 | [OpenAI：Optimizing Customer Support Agents for Cost and Quality](https://developers.openai.com/cookbook/examples/agent_optimization/optimizing_agents_for_cost_and_quality) | 在固定评测集上比较工具控制、模型路由、缓存、后台工作 | 官方 Cookbook；默认是合成票据和确定性模拟，不是线上客服实测 |
| 09-15 | [Google：Runtime governance](https://developers.googleblog.com/build-zero-trust-ai-agents-that-judge-intent-not-just-syntax/) | 调用工具前检查意图与业务规则，结合多轮行为检测 | 官方架构和开源演示；云服务与本地演示须区分 |
| 09-16 | [Google：Agent Anomaly Detection](https://developers.googleblog.com/agent-anomaly-detection-now-in-private-preview-on-the-gemini-enterprise-agent-platform/) | 用日志和 OTel 轨迹异步分析行为异常 | Private Preview；异步分析不能保证阻止已经发生的行动 |
| 09-22 | [GitHub：OpenTelemetry in Copilot](https://github.blog/changelog/2026-09-22-opentelemetry-in-the-github-copilot-app/) | 导出模型请求与工具执行轨迹，默认不捕获提示词和回复正文 | 官方产品发布；企业管理配置 |
| 09-24 | [GitHub Security Lab Taskflow Agent](https://github.blog/security/application-security/ai-powered-fuzzing-with-the-github-security-lab-taskflow-agent/) | 决策与 MCP 执行工具分层，阶段状态通过 SQLite 交接 | 官方开源工程案例；该示例宿主机执行并无内置容器隔离 |
| 09-25 | [AgentWorld](https://arxiv.org/abs/2609.31590) | 评测长流程非对称角色协作，提出贡献因果关系指标 CCE | arXiv v1，页面标注 COLM 2026 接收；游戏环境，不直接代表办公任务 |
| 09-25 | [GitHub：Autofix uses Copilot Memory](https://github.blog/changelog/2026-09-25-agentic-autofix-now-uses-copilot-memory/) | 修复经验成为仓库相关记忆，并供其他 Copilot 功能使用 | 官方发布；Autofix 与 Memory 都是 public preview |
| 09-26 | [MemAgent](https://arxiv.org/abs/2609.32521) | 内容感知的多记忆提供者路由，选择检索、短期注入和存储目标 | arXiv v1；包含路由训练，不是仅增加几个提示词 |
| 09-28 | [JAM：Just-In-Time Agent Memory](https://arxiv.org/abs/2609.34385) | 保留原始历史，当前请求到来时逐步检索并构造上下文 | arXiv v1；Researcher 采用 SFT 和 Hint-guided GRPO |
| 09-29 | [PANDA](https://arxiv.org/abs/2609.38482) | 将基础设施与 star/chain/mesh 编排方式解耦，失败后重规划 | arXiv v1；HotPotQA 上的规模及容错实验不可外推到任意系统 |
| 09-29 | [OpenAI：AWS Lambda MicroVM sandboxes](https://developers.openai.com/cookbook/examples/agents_api/sandboxes/aws/readme) | 托管执行循环与自托管环境分离，示例检查暂停恢复后文件存续 | 官方 Cookbook；需要相应 AWS 权限与服务访问 |
| 09-30 | [SkillSeek](https://arxiv.org/abs/2609.38822) | 用常规检索与小型重排器选择技能，比较 LLM 检索循环 | arXiv v1，页面标注 AACL-IJCNLP 2026 接收；结论限于其 SkillsBench/OpenHands 设置 |
| 09-30 | [MeshMesh：Native subagents](https://docs.meshmesh.io/releases/2026-09-30) | 产品用实时助手树呈现分工、进度与结果，子助手不堆进主侧栏 | 官方产品发布；交互参考，不是协作效果实验 |
| 10-01 | [GitHub：Computer use](https://github.blog/changelog/2026-10-01-github-copilot-can-now-interact-with-desktop-apps/) | CLI/app 可操作桌面应用，按应用管理授权 | macOS/Windows public preview；并非无条件后台控制 |
| 10-07 | [GitHub：Local sandboxing GA](https://github.blog/changelog/2026-10-07-local-sandboxing-for-github-copilot-now-generally-available/) | 统一策略映射到 Windows/macOS/Linux 的原生隔离控制 | 官方发布；工具隔离与所选模型分离 |
| 10-07 | [Anthropic：Claude Haiku 5.5](https://www.anthropic.com/claude-haiku-5-5) | 小模型定位于摘要、压缩、查询和范围明确的子任务，支持 effort 调节 | 官方模型发布；速度与成本主张不能替代我们自己的任务评测 |

边界记录：[Subagents vs Agent Skills](https://arxiv.org/abs/2609.09233) 与项目很相关，但首次提交为 09-07，已超出本轮窗口，故不计入“近一个月新增”。旧有 Agent Skills、MCP、A2A 规范也不因今天访问而变成新发布。

## 3. 值得吸收的技术变化

### 3.1 记忆读取：为当前请求寻找证据

JAM 保留原始会话文件，摘要用于导航，Researcher 再围绕当前请求寻找和整合证据。它的效果包含专门训练的贡献，不能声称普通模型加相同提示词就能复现。[论文正文](https://arxiv.org/html/2609.34385v1)

项目建议：保留原始消息和产物；新增带来源位置的历史片段索引，先按权限筛选，再检索候选。只在需要历史时调用检索，读取选中的原文，返回证据引用。首次实现可用关键词检索和有限迭代，不预设向量库或微调是必要条件。

MemAgent 将多个记忆表示的选择视为路由问题，而非规定所有任务都用同一种记忆。[论文](https://arxiv.org/abs/2609.32521) 项目先区分用户偏好、项目事实、任务经验和技能四类，采用可解释规则路由；训练路由器放到有实际数据以后。

### 3.2 记忆写入：任务结束后独立核验

Grounding Agent Memory 的执行助手只读记忆；任务结束后整理助手获得轨迹与只读环境工具，对候选内容提出、核验、修订，再决定写入。论文用发生 schema 变化的数据库任务检查陈旧知识问题。[正文](https://arxiv.org/html/2609.11060v1)

项目建议：执行助手仅提交候选，独立整理流程检查证据、适用项目和有效时间。用户明确保存的偏好直接保留为用户声明；自动推断的规则需核验。没有可核验来源时标为待确认，不自动提升成共享事实。

GitHub 本月把 Autofix 接入跨功能记忆，说明项目经验复用已进入产品实践。[官方发布](https://github.blog/changelog/2026-09-25-agentic-autofix-now-uses-copilot-memory/) 对 ExpertMesh，共享的是经过筛选的项目知识；助手私有记录和原始上下文仍按权限隔离。

### 3.3 协作：明确依赖与贡献

AgentWorld 专门观察长流程中角色、交流和共享计划失效；PANDA 探索根据任务切换 star/chain/mesh 编排并重规划。[AgentWorld](https://arxiv.org/abs/2609.31590)、[PANDA](https://arxiv.org/abs/2609.38482)

项目建议：先支持直接完成、顺序协作、独立并行三种方式。每个子任务必须有输入范围、产物格式、验收条件和依赖项。记录主助手实际采用了哪些产物；重复搜索、未采用的产物和无效协调都算成本。暂不追求大规模自主网状通信。

MeshMesh 用可展开的实时助手树呈现协作，而且避免子助手挤占主导航。[发布说明](https://docs.meshmesh.io/releases/2026-09-30) 我们的聊天页可以只呈现“谁在做什么、产物在哪里、是否需要用户输入”，展开后再查看执行详情。

### 3.4 执行：长期任务依赖可恢复环境

OpenAI 的 MicroVM 示例将执行循环与工作区分离，并提供暂停恢复检查；GitHub 的本地隔离把模型选择与工具权限分开。[MicroVM 示例](https://developers.openai.com/cookbook/examples/agents_api/sandboxes/aws/readme)、[本地隔离发布](https://github.blog/changelog/2026-10-07-local-sandboxing-for-github-copilot-now-generally-available/)

项目建议：以 WorkspaceProvider 抽象本地或云端沙箱，独立保存工作区版本、输入产物和恢复配方。不能把当前“数据库任务恢复”宣传成“外部环境和所有操作都可无损恢复”。外部写操作需操作记录、幂等键和恢复时对账。

GitHub Security Lab 的阶段化 SQLite 交接说明单进程原型可以先完善持久化契约，不必立即换数据库；其宿主机执行方式不作为我们的隔离方案。[工程案例](https://github.blog/security/application-security/ai-powered-fuzzing-with-the-github-security-lab-taskflow-agent/)

### 3.5 模型与技能：在质量约束下控制成本

Haiku 5.5 发布明确强调范围较窄的子任务；OpenAI 的优化示例用固定评测集比较模型路由、缓存和后台处理。[Haiku 发布](https://www.anthropic.com/claude-haiku-5-5)、[OpenAI Cookbook](https://developers.openai.com/cookbook/examples/agent_optimization/optimizing_agents_for_cost_and_quality)

项目建议：建立能力与成本配置，把简单提取交给低成本模型，规划和整合使用通过对应评测的模型。路由规则、每次升级原因、实际 token 使用都要记录；不可根据一次厂商 benchmark 自动更换用户配置。

SkillSeek 的实验支持先把普通检索作为技能选择的对照方案，而非默认每次启动复杂的 LLM 搜索循环。[论文](https://arxiv.org/abs/2609.38822) 技能首版提供固定版本、依赖与权限声明，按需加载；没有独立评测之前不自动发布“学会”的技能。

### 3.6 行为治理：策略与观测位于执行循环外

Google 本月提出工具前意图检查与多轮异步行为观测；GitHub 发布 OTel 集成。[运行时治理](https://developers.googleblog.com/build-zero-trust-ai-agents-that-judge-intent-not-just-syntax/)、[异常检测](https://developers.googleblog.com/agent-anomaly-detection-now-in-private-preview-on-the-gemini-enterprise-agent-platform/)、[OTel](https://github.blog/changelog/2026-09-22-opentelemetry-in-the-github-copilot-app/)

项目建议：确定性权限、路径和网络范围检查先执行；模型判断只作补充。结构化记录任务、模型、工具、时延、失败与来源，正文采集默认关闭。异步检测可停止后续行动，不能撤回已发生的效果。桌面控制本月有产品进展，但我们先完成工具和工作区隔离，再评估它。[Computer use 发布](https://github.blog/changelog/2026-10-01-github-copilot-can-now-interact-with-desktop-apps/)

## 4. 与当前原型的差距

以本地代码中的 shared/types.ts、server/runtime.ts、server/providers.ts 为准，以下为实现核对与设计建议。

| 能力 | 已有 | 下一阶段缺口 |
| --- | --- | --- |
| 助手身份 | 独立 assistantId、指令、默认模型、用户偏好 | 指令版本、能力契约、权限配置、生命周期 |
| 执行恢复 | 任务快照、完整轮次检查点、工具结果缓存、重启后暂停 | 独立的执行实例、跨任务延续上下文策略、外部效果对账 |
| 子任务 | 一层委派、最多三个、独立上下文 | 契约式输入输出、依赖图、独立并行调度、结果验收 |
| 记忆 | 按助手与项目保存用户填写的偏好 | 按需检索、候选记忆、核验、版本与撤销传播 |
| 工具 | 资料工具、产物、联网搜索与读取 | 细粒度工具授权、MCP、隔离执行环境 |
| 模型 | 多供应商适配、助手可选不同模型 | 规范化 usage、质量与成本评测、预算驱动路由 |
| 观测 | 文本事件与任务状态 | 结构化 trace/span、成本、失败归因与贡献记录 |

现有“独立助手”不等于一个永远常驻的进程。身份持久化与进程存活是不同需求，任务可以在新的执行实例中恢复。

## 5. 建议的数据与权限划分

以下是候选设计，尚未实现。

| 对象 | 负责什么 | 关键约束 |
| --- | --- | --- |
| AssistantProfile | 长期身份、指令版本、能力与默认模型 | 替换模型不改变身份；名称不作为授权依据 |
| AgentRun | 一次任务的执行实例、模型快照和检查点 | 多次执行共用身份，但不默认继承所有历史 |
| TaskContract | 目标、输入、依赖、产物与验收版本 | 委派前冻结；目标改变产生新版本 |
| MemoryEntry | 偏好或经核验知识，来源与有效范围 | private/project/user 范围显式；删除需影响索引与摘要 |
| Workspace | 文件状态、沙箱策略和恢复配方 | 项目知识访问权不等于宿主机执行权 |
| ToolGrant | 可调用工具、资源范围、期限与授权来源 | 子任务不自动继承父任务全部权限 |

主助手共享给子助手的最小材料包应包含契约、相关来源和获准文件。项目共享知识是明确发布的记录，不通过复制整段私人记忆实现。

## 6. 候选路线与验收

### 第一个增量：协作契约与可观测执行

补 TaskContract、产物结构、依赖和结构化执行事件，收集各供应商 usage；用同一组真实任务比较直接完成、顺序分工和并行分工。

验收：每个委派结果可追溯到输入与来源；主助手使用或拒绝子结果有记录；汇总根任务和子任务的总时延、调用次数、token、已知费用。没有 usage 的服务标为未知，不估算成零。

### 第二个增量：有来源、能纠错的记忆

新增权限过滤后的历史检索，保留原文与导航摘要；引入“候选 → 核验 → 发布 → 撤销”的整理流程。先人工确认自动记忆，再用评测决定可自动发布的类型。

验收：跨会话找回明确事实；资料更新后不继续使用陈旧版本；撤销后检索和摘要均不返回旧记录；另一个助手不能读取私有记录；能展示“为什么记住”和“来源在哪里”。

### 第三个增量：MCP 与隔离工作区

先接只读 MCP，再让产物生成、运行检查进入可恢复沙箱。审批针对具体外部写操作，恢复前检查已经发生的效果。桌面操作另作小规模实验。

验收：中断后产物保持；重复事件不产生重复外部写入；工具越权被程序拒绝；断连显示需要用户处理，连接恢复后继续原任务。

## 7. 必须建立的实验

| 实验 | 固定条件 | 主要指标 |
| --- | --- | --- |
| 单助手 vs 2/3 助手 | 同模型、输入、总预算、验收标准 | 完成质量、协调成本、时延、重复工作 |
| 同构 vs 异构团队 | 同任务和预算；明确模型版本 | 成本、验收通过率、整合错误 |
| 无记忆 vs 摘要 vs 按需读取原文 | 原始历史一致、历史访问权限一致 | 正确率、来源命中、上下文大小、读取成本 |
| 轨迹整理 vs 只读核验整理 | 相同轨迹和整理预算 | 错误记忆率、陈旧记忆修复、核验成本 |
| 重启与外部超时 | 相同任务，指定故障注入点 | 恢复成功、重复效果、产物丢失 |
| 权限与污染负例 | 受控项目与私有资料 | 越权率、撤销完整性、正常知识保留 |

先采用人工验收与确定性检查；模型评分只作辅助。本月论文的分数、厂商价格优势、产品预览状态不能替代这组实验。

## 8. 产品呈现

保留简洁聊天入口。任务中增加可展开的“协作进度”和“成果”；助手详情提供“工作要求”“记住的内容”“可用工具”。普通用户看到状态、结果和可修改的内容；依赖图、记忆索引、沙箱协议和追踪细节留在开发文档或高级设置。

下一次设计讨论的核心应是三个具体场景：连续几周的资料研究、多人角色参与的项目文档、可恢复的代码分析与验证。用这些场景决定功能优先级，再进入开发。
