# ExpertMesh 第二轮资料与设计补充

检索日期：2026-10-09。补充范围：自适应协作、远程专家互操作、长任务交接、技能积累、记忆修复与协作评测。官方规范和工程文章已打开正文核对；论文结论主要依据摘要与版本记录，未复现实验。下文模块、字段与流程为项目设计建议。

## 1. 新增资料

| 资料 | 日期或版本 | 重点 | 证据性质 |
| --- | --- | --- | --- |
| [Towards a Science of Scaling Agent Systems](https://arxiv.org/abs/2512.08296) | 2025-12-09；v3 为 2026-04-08 | 控制预算下比较协作架构，分析任务结构与协调开销 | arXiv 研究，按 v3 摘要核对 |
| [Silo-Bench](https://arxiv.org/abs/2603.01045) | 2026-03-01；v2 为 2026-04-13 | 分布式信息整合能力，区分交换信息与完成推理 | arXiv 页面标注 ACL 2026 主会接收 |
| [A2A Specification](https://a2a-protocol.org/latest/specification/) | 当前规范页，2026-10-09 核对 | Agent Card、任务、消息、产物、订阅和认证 | 官方协议规范，实施时固定版本 |
| [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) | 2026-03-24 | planner、generator、evaluator；明确契约与实际测试 | 官方工程案例 |
| [Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents) | 2026-04-08 | session、harness、sandbox 解耦 | 官方工程架构 |
| [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 2025-11-26 | 初始化环境、增量完成与明确交接产物 | 官方工程经验 |
| [Agent Skills Specification](https://agentskills.io/specification) | 当前规范页，2026-10-09 核对 | 技能目录格式与按需加载 | 官方格式规范 |
| [WikiSkill](https://arxiv.org/abs/2608.27454) | 2026-08-27 | 原始经验、累计知识和技能分层积累 | arXiv 预印本 |
| [Memento-Skills](https://arxiv.org/abs/2603.18743) | 首次提交 2026-03-19 | 外部技能、有状态提示词与读写学习 | arXiv 研究，未复现路由训练 |
| [MemSecBench](https://arxiv.org/abs/2607.27080) | 2026-07-29 | 记忆污染的写入、后续行动和选择性修复 | arXiv 预印本 |

较早的工程资料用于补齐实现机制，不称为本轮最新论文。工程案例的效果限于其任务与配置，不能外推为通用最优架构。

## 2. 调度前增加协作方式选择

Scaling Agent Systems 在其测试条件下发现协作收益与任务可分解性有关；Silo-Bench 指出，专家获得足够信息后仍可能整合失败。因此，任务分解与结果整合需要分别验证。[架构研究](https://arxiv.org/abs/2512.08296)、[协作评测](https://arxiv.org/abs/2603.01045)

增加 ExecutionPolicy，支持 direct、serial_specialist、parallel_specialists 三种模式。主智能体提出拆分方案，程序检查依赖与预算，记录选择依据。

| 任务特征 | 初始模式 | 例子 |
| --- | --- | --- |
| 范围小，无明确独立子任务 | direct | 查询一个接口、修改一个配置 |
| 状态强耦合，下一步依赖前一步结论 | serial_specialist | 数据库迁移与依赖它的代码修改 |
| 输入和产物可独立，有明确整合标准 | parallel_specialists | 多种技术方案查证、独立模块检查 |

子智能体的产品价值是专家可复用、可积累经验、可恢复执行；每个请求仍按实际需要决定协作方式。

失败归因至少分为信息缺失、专家产物错误、整合错误、验证错误。增加累计委派数和协调 token 上限，超限时重规划或以已知结果结束，避免无限拆分。

## 3. 远程专家采用 A2A 适配层

A2A 规范提供 Agent Card、Task、Message、Artifact 和流式任务事件。contextId 组织相关任务和消息，taskId 标识具体工作；任务生命周期独立于单条订阅流。[A2A 规范](https://a2a-protocol.org/latest/specification/)

增加 RemoteAgentAdapter，内部使用 ExpertMesh 任务契约，对外转换为固定版本协议。Agent Card 用于发现能力与接口，不等同于本项目的 agent_id，也不能自动授权读取私有记忆。

记录 endpoint、provider_identity、protocol_version、local_task_id、remote_task_id、remote_context_id、capability_snapshot 和 last_observed_status。远端负责生成新 taskId，不将本地 task_id 直接当作远端新任务 ID。

明确映射工作中、等待输入、完成、失败、取消和拒绝等状态。断流先重连或查询远端任务，避免直接重新委派。订阅机制不保证业务事件可按本地游标重放；缺失事件无法确认时重新读取状态和产物并对账。

MVP 使用本地 worker；阶段四接一个远程专家，测试断流、取消、认证失败和重复消息。请求去重依赖对端能力，A2A 不能替代操作幂等与记忆隔离。

## 4. 三个独立恢复域与交接包

Anthropic 的 Managed Agents 工程文章将会话记录、执行循环和沙箱解耦，以减少故障耦合。[官方说明](https://www.anthropic.com/engineering/managed-agents)

本项目明确三个接口：SessionStore 保存事件与产物引用；AgentRunner 负责可替换的执行循环；WorkspaceProvider 提供工作区、沙箱与重建配方。

新增 workspace_manifest，记录 base_commit、依赖锁文件哈希、镜像摘要、输入产物和已发布补丁。工作区损坏时能够重建；未发布文件不能仅因事件存在就被认为已持久化。

长任务交接包保存 goal、acceptance_version、base_commit、last_verified_commit、completed_criteria、open_issues、next_action、artifact_refs 和 workspace_manifest_ref。恢复时核对当前仓库与外部状态后再继续。

初始化任务准备环境与验收列表，后续每次执行完成一个有界增量并登记结果。用户目标变化产生新验收版本；实现者不能用“已有代码”证明完成，验证者依据契约检查。[长任务工程经验](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)、[2026 年契约驱动案例](https://www.anthropic.com/engineering/harness-design-long-running-apps)

## 5. 经验到知识再到技能

WikiSkill 分离执行经验、累计知识与技能；Memento-Skills 探索通过外部技能读取和更新持续适应。项目采用分层整理思想，不声称复现训练算法。[WikiSkill](https://arxiv.org/abs/2608.27454)、[Memento-Skills](https://arxiv.org/abs/2603.18743)

设计流程为 Experience → Knowledge → SkillCandidate → Evaluation → ReleasedSkill：

1. Experience 保存原始证据和任务结果。
2. Knowledge 保存经验证的适用条件、步骤、失败边界与来源。
3. SkillCandidate 从知识生成可复用技能包。
4. 独立保留测试集检查成功率、成本和负例，生成用案例不作为独立验证。
5. 满足预先规定的门槛后发布版本，可以回滚和撤销。

技能采用 SKILL.md、references 与 scripts 组织。启动加载获准技能的名称和描述，任务命中后读取正文，资源按需读取。规范中的 allowed-tools 为实验性字段，支持程度因客户端而异，运行时独立强制权限。[Agent Skills 格式](https://agentskills.io/specification)

增加 skills、skill_evaluations 表，记录来源任务、内容哈希、版本、状态、依赖、模型适用范围和评测结果。首版用人工定义技能，自动整理放阶段三；运行期间固定技能版本。

## 6. 记忆污染扩展到选择性修复

MemSecBench 关注 Write—Execute—Forget 链路，评测持续追踪污染写入、后续行动和选择性修复。论文测试结果不能直接当作本项目的风险概率。[MemSecBench](https://arxiv.org/abs/2607.27080)

MemoryEntry 增加 trust_level、derived_from、quarantine_reason、revoked_at。记录记忆到摘要、共享记录和技能的来源关系。发现污染时隔离源条目及受影响派生项，检查检索缓存和运行中任务已加载的内容。

每次工具执行前检查任务 knowledge_epoch；知识撤销影响当前任务时停止后续操作，在干净上下文中恢复或重新核验。已发生的外部效果单独对账，删除记忆不能撤回行动。

新增三段测试：恶意输入能否进入长期记忆；后续任务是否触发受控的违规行为；撤销后恶意影响是否消失、正常相邻记忆是否保留。语义污染可能漏检，来源图和隔离提高可检查性，不宣称完全防御。

## 7. 评测增加协作与框架消融

Silo-Bench 提供分布式信息整合的评测视角；2026 年 Harness 工程文章讨论逐项去除组件以观察增量收益。[Silo-Bench](https://arxiv.org/abs/2603.01045)、[Harness 设计](https://www.anthropic.com/engineering/harness-design-long-running-apps)

| 新实验 | 测量内容 |
| --- | --- |
| 相同总预算下比较 1、2、3 位执行专家 | 成功率、协调成本、时延与整合错误 |
| 去掉长期记忆、技能、独立验证等组件 | 增量收益及额外成本 |
| 相同与异构模型团队比较 | 错误相关性和验证效果 |
| 将关键证据分散在不同专家输入中 | 收集齐证据后的整合正确率 |
| 分别注入 runner 崩溃与 workspace 损坏 | 恢复结果与未发布文件损失 |
| 跨任务记忆污染与选择性撤销 | 下游行为、修复效果及正常知识保留 |

基准用于组件评测，产品任务仍需专用验收。报告重复运行分布与不确定性，不用单次演示证明统计显著收益。

## 8. 优先级与待验证问题

P0：协作方式选择、验收与交接包、恢复域接口、记忆来源关系、分阶段失败归因。

P1：技能版本与评测、工作区重建、选择性记忆撤销、组件消融。

P2：A2A 远程专家、模型记忆路由、自动技能晋升、跨框架迁移。

下一轮实验需要回答：什么任务委派真正优于 direct；专家记忆能否改善新任务；同模型验证者能否发现相关错误；技能换模型后是否需要重新晋升；远程任务连续性如何与本地租约和操作幂等协同。

上述问题尚未实验验证。本轮完成的是资料核对和架构补充。
