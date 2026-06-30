# TryCue 文档索引

本文是 TryCue 文档入口，负责说明事实源、阅读路径和维护规则；它不替代各领域规格。

仓库入口和本地启动说明见 [../README.md](../README.md)。本文只负责 `docs` 目录下的规格导航。

## 1. 文档分层

当前文档分为两层：

| 层级 | 作用 | 文件 |
|---|---|---|
| 入口与状态 | 事实源入口和实现进度 | `00_README_文档索引.md` |
| 核心规格 | 数据库、API、运行期、观众生成、前端、报告、测试、Demo、部署 | `01` 至 `09` |

HTML 辅助文档仅供可视化参考，不作为事实源：

- `report-generation-flow.html`：报告生成流程

功能方案文档用于记录尚未落地或正在讨论的改动设计；实现完成后必须同步更新对应核心规格。llm 容量控制、venue 两列布局、i18n 迁移均已合并到核心规格。报告模型拆分与 Token 用量追踪作为未落地路线，暂不公开。

## 2. 冲突处理规则

遇到文档冲突时，按以下顺序判断：

1. 当前实现范围和已做/未做，以 `00_README_文档索引.md` 和各核心规格为准。
2. 数据库表、枚举、索引、生命周期事实，以 `01_Database_Schema_Spec.md` 为准。
3. HTTP API、SSE payload、DTO 字段和共享契约，以 `02_API契约与共享DTO.md` 为准。
4. Agent 运行时设计（Scheduler、Runner、工具定义、Prompt、Session、暂停/重试），以 `03_Agent运行时设计.md` 为准。
5. 观众采样计划、directive、profile expansion、identity generation 和结果层身份操作，以 `04_观众生成领域规格.md` 为准。
6. 前端页面、状态映射、视觉行为、导航和路由，以 `05_前端规格.md` 为准。
7. 报告生成，以 `06_报告生成规格.md` 为准。
8. 测试验收与 Prompt 评测，以 `07_测试与验收.md` 为准。
9. 部署、环境变量、模型配置、可观测性和排障，以 `09_部署与运维.md` 为准。

如果实现与文档不一致：

```text
已明确决定的实现变更 -> 同步更新对应文档。
发现实现偏离规格且没有决策记录 -> 先定位根因，再决定改实现还是改文档。
外部说明与当前规格冲突 -> 当前规格生效。
```

## 3. 当前 V1 边界

V1 是单版本 AI 试映工作台，不做多版本 PK，不接真实小红书或外部社交平台，不做真实 DOM 自动化。

核心流程：

```text
创建内容和图片
  -> 生成 AudienceSamplingPlan / AudienceSamplingDirective
  -> 用户审核和确认观众分布
  -> 系统展开 AudienceProfile
  -> 系统生成 User / Agent / PlatformAccount
  -> 用户在结果层编辑、收藏、删除、重生或补充最终身份
  -> 开始试映，创建 RunParticipant 快照
  -> Scheduler 驱动 AgentJourney / AgentTurn 和 tool call
  -> SSE 推送现场事实
  -> 暂停 / 继续 / 结束并生成报告
  -> 报告基于持久化证据生成
```

固定运行边界：

```text
1 run = 1 contentVersion
starting 只允许是前端瞬时 UI 状态，不写入数据库
run.status 只使用 draft / planning_audience / generating_audience / audience_ready / running / pausing / paused / report_generating / completed
SSE id 和 payload.eventId 都使用 live_events.sequence 字符串
Tool call 状态统一为 pending / committed / ignored / failed
```

## 4. 当前允许工具

V1 观众运行期只允许以下工具：

```text
open_post
view_comments
like_post
favorite_post
share_post
write_comment
like_comment
exit_browsing
```

以下历史工具不应重新引入：

```text
record_reaction
record_memory
update_score
inspect_feed_card
scroll_down
wait
finish_turn
skip_post
finish_journey
exit_post
```

工具表示用户外部行为；心路历程由 assistant content 持久化为 `thought_text`；分数、洞察和发布建议由报告层基于证据生成。

## 5. 文档清单

| 文件 | 事实范围 |
|---|---|
| `01_Database_Schema_Spec.md` | Prisma schema、SQLite baseline、表关系、枚举、索引、幂等和一致性 |
| `02_API契约与共享DTO.md` | API request/response、SSE 事件、错误码、共享 DTO 契约、Zod schema 清单 |
| `03_Agent运行时设计.md` | Agent 旅程模型、工具定义、Scheduler/Runner、AI SDK 集成、Session/Transcript、Prompt 规则、暂停/重试、运行时数据生命周期 |
| `04_观众生成领域规格.md` | 统一身份架构、采样计划、directive、profile expansion、identity generation、结果层、Provider/Prompt |
| `05_前端规格.md` | 工作台、观众生成、现场页、观众席、详情层、报告入口、UI 状态、导航与路由 |
| `06_报告生成规格.md` | 报告输入、输出结构、证据链、发布建议和质量边界 |
| `07_测试与验收.md` | 单元、集成、前端验收、异常场景、Prompt 评测（自动规则检查、人工抽检、坏例库、准入标准） |
| `08_Demo数据规格.md` | Demo 内容、评论样本、调试数据和预期反馈 |
| `09_部署与运维.md` | 部署、环境变量、模型配置、日志、trace、排障与问题定位 |

## 6. 推荐阅读路径

按任务选择最短路径：

| 任务 | 先读 | 再读 |
|---|---|---|
| 修改观众生成或结果层 | `04` | `01`、`02`、`03`、`05`、`07` |
| 修改数据库或 migration | `01`、`08` | `04`、`07` |
| 修改 API 或共享 DTO | `02` | `01`、`04`、`05`、`07` |
| 修改 Scheduler / Runner / Agent | `03` | `02`、`04`、`07` |
| 修改前端工作台或现场页 | `05` | `02`、`04`、`07` |
| 修改报告 | `06` | `03`、`02`、`07`、`08` |
| 调试本地环境或线上问题 | `09` | 相关领域规格 |

## 7. 文档维护规则

1. 新增或修改跨 API 边界字段时，先更新 `packages/shared`，再更新 `02` 和受影响的前端/后端文档。
2. 修改数据库生命周期时，同步更新 `01`、`08`、`04` 中对应事实；不要只改一处。
3. 修改 Agent 工具或 Prompt 时，同步更新 `03` 和 `07`。
4. 修改前端路径或页面状态时，更新 `05`。
5. 完成实现后同步更新 `07` 的测试与验收清单。
