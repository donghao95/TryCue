# 01 数据库 Schema 定稿文档

## 1. 目标

本文档定义 AI 用户试映会 V1 的数据库结构。

数据库需要支持：

```text
1. 单版本试映 run 的创建、启动、完成和失败。
2. audience_sampling_plans、audience_sampling_directives、audience_profiles、users、agents、platform_accounts、run_participants 的分阶段建模。
3. Agent persona、AgentJourney、AgentTurn、tool call 的完整追踪。
4. 模拟帖子状态、互动、评论的实时变化。
5. 前端用户和 Agent 行为的统一落库、统一计数和统一报告证据。
6. 中断恢复、失败重试、回放和排障。
7. SSE 实时事件流的持久化与断线重连（Last-Event-ID 回放）。
8. LLM provider 调用和 token 消耗的 run 级审计。
```

**关键设计决策：**

- **实时通信**：采用 SSE（Server-Sent Events），非 WebSocket 或轮询。通过 `live_events` 表持久化事件，支持 Last-Event-ID 断线重连。
- **统一身份模型**：所有行为主体都是 `users + platform_accounts`；Agent 通过 `agents.user_id` 绑定用户身份，run 内展示和调度使用 `run_participants` 快照。
- **统一提交层**：Agent 工具和前端 API 都调用 runtime service；工具执行器不再直接修改点赞、收藏、评论等业务事实表。
- **级联所有权**：`test_runs` 是一次试映的聚合根；run 拥有的运行事实使用数据库外键级联硬删除。`content_versions` 是内容事实边界；帖子状态、互动、评论、洞察、报告和图片引用随内容版本级联删除。
- **观众生成生命周期**：sampling plan 阶段只创建 `audience_sampling_plans + audience_sampling_directives`；用户确认后系统展开 `audience_profiles` 并自动创建正式 `user + agent + platform_account`；start 阶段只创建 `run_participants` 快照。
- **身份归属写入 Agent**：`agents.retention_policy` 决定删除来源 run 时是否清理该组 `user + agent + platform_account`；`agents.favorited_at` 决定该人设是否进入可复用收藏库。
- **统一行为主体**：运行期互动统一落到 `users / agents / platform_accounts / run_participants`。
- **迁移链**：当前 schema 以 `0001_baseline` 为基线，后续迁移包含 `0002_llm_call_traces`；不保留旧 action-level queue 兼容层。

## 2. 核心设计修正

一个 AgentTurn 是 AgentRunner 循环中的一个模型回合和证据单元，可以包含多个 tool call，也可以只有 `thought_text`。Scheduler 不再以 turn/action 为调度粒度，而是 claim `AgentJourney` 并由 Runner 持续执行到该观众 terminal、失败或达到最大步数。

新版模型：

```text
agent_journeys = 一个观众在一次 run 中的浏览旅程
agent_turns = 一个 Runner 循环中的模型回合和证据单元
agent_tool_calls = 一个 AgentTurn 内发生的所有 tool call
agent_transcript_items = append-only transcript，恢复事实源
```

一个 `agent_turn` 内可以有多个 tool call，例如：

```text
open_post
favorite_post
view_comments
write_comment
exit_browsing
```

一个 `agent_turn` 也可以没有 tool call，只有 `thought_text`。这表示观众本轮形成了可展示想法，但没有外部行为。

运行期阶段通过 `social_interaction_events` 的 `open_post` 事件派生 `hasOpenedPost`。Agent 在所有阶段接收全部工具，由系统 prompt 和当前阶段决定行为。`open_post` 是唯一的 feed→post 阶段转换点。

上下文模型采用 append-only transcript：不每轮重建、不回写历史上下文、不主动裁切历史消息。

### 2.1 统一身份与互动底座

当前行为主体模型：

```text
audience_agents       -> run_participants
audience_id 行为主体   -> actor_user_id + platform_account_id
audience_cohorts      -> audience_sampling_plans / audience_sampling_directives
确认后生成画像          -> audience_profiles
Agent 人设            -> agents
系统/平台身份          -> users + platform_accounts
工具直写业务表          -> runtime service 统一提交
```

所有点赞、收藏、分享、评论、回复和评论点赞的事实源不再是 journey 字段或工具执行器内部逻辑，而是：

```text
social_interaction_events
social_reactions
simulated_comments
simulated_post_states（聚合缓存）
```

前端用户和 Agent 行为默认都纳入报告统计，并通过 `source = agent_tool | human_ui | system_seed | replay` 保留来源。

## 3. 枚举定义

### 3.1 RunStatus

```ts
type RunStatus =
  | "draft"
  | "planning_audience"
  | "generating_audience"
  | "audience_ready"
  | "running"
  | "pausing"
  | "paused"
  | "report_generating"
  | "completed";
```

### 3.2 UserType

```ts
type UserType =
  | "human"
  | "agent"
  | "system";
```

### 3.3 Platform

```ts
type Platform =
  | "xiaohongshu"
  | "douyin"
  | "wechat";
```

V1 只模拟平台账号，不接真实平台授权。

### 3.4 InteractionSource

```ts
type InteractionSource =
  | "agent_tool"
  | "human_ui"
  | "system_seed"
  | "replay";
```

`agent_tool` 和 `human_ui` 都会写入统一互动事实表，报告层需要保留 source breakdown。

### 3.5 SocialTargetType

```ts
type SocialTargetType =
  | "post"
  | "comment";
```

### 3.6 SocialReactionType

```ts
type SocialReactionType =
  | "like"
  | "favorite";
```

### 3.7 RunParticipantStatus

```ts
type RunParticipantStatus =
  | "ready"
  | "queued"
  | "thinking"
  | "tool_running"
  | "waiting_next"
  | "finished"
  | "skipped"
  | "failed";
```

### 3.8 AudienceIdentityStatus

```ts
type AudienceIdentityStatus =
  | "profile_only"
  | "identity_queued"
  | "identity_generating"
  | "identity_ready"
  | "identity_failed";
```

### 3.9 AudienceGenerationJobStatus

```ts
type AudienceGenerationJobStatus =
  | "queued"
  | "planning"
  | "generating"
  | "completed"
  | "failed"
  | "canceled";
```

### 3.10 AudienceGenerationJobScope

```ts
type AudienceGenerationJobScope =
  | "sampling_plan"
  | "profile_expansion"
  | "identities"
  | "single_identity";
```

### 3.11 AudienceSamplingPlanStatus

```ts
type AudienceSamplingPlanStatus =
  | "draft"
  | "planning"
  | "ready_for_review"
  | "confirmed"
  | "expanding_profiles"
  | "generating_identities"
  | "ready"
  | "ready_with_failures"
  | "failed"
  | "canceled";
```

### 3.12 AudienceSamplingDirectiveExpansionStatus

```ts
type AudienceSamplingDirectiveExpansionStatus =
  | "pending"
  | "generating"
  | "ready"
  | "failed";
```

### 3.13 JourneyStatus

```ts
type JourneyStatus =
  | "active"
  | "finished"
  | "failed";
```

### 3.13.1 JourneyRunnerStatus

```ts
type JourneyRunnerStatus =
  | "queued"
  | "idle"
  | "running";
```

说明：Runner claim journey 时从 `queued`/`idle` 切换到 `running`；释放时切回 `idle` 或 journey 标记为 terminal。

### 3.14 AgentTurnStatus

```ts
type AgentTurnStatus =
  | "created"
  | "context_recorded"
  | "model_calling"
  | "model_returned"
  | "tools_executing"
  | "completed"
  | "failed"
  | "recovered";
```

### 3.15 AgentToolCallStatus

```ts
type AgentToolCallStatus =
  | "pending"
  | "committed"
  | "ignored"
  | "failed";
```

说明：toolExecutor 调用统一 runtime service 提交业务状态，无 ToolEffect 中间态。`pending` 表示调用发起，`committed` 表示 service 已成功写入，`ignored` 表示环境事实或 session phase 校验后安全忽略，`failed` 表示执行失败。

### 3.16 AgentTranscriptItemType

```ts
type AgentTranscriptItemType =
  | "initial_observation"
  | "assistant_message"
  | "assistant_tool_calls"
  | "tool_result"
  | "system_notice";
```

说明：

- `initial_observation`：journey 起始输入（feed_observation 或 post_detail_observation）。
- `assistant_message`：agent 的文本输出（thought_text）。
- `assistant_tool_calls`：agent 的工具调用请求。即使 assistant content 为空，只要有 tool calls，也必须保存此项。
- `tool_result`：工具执行后的返回值。
- `system_notice`：系统级通知（如错误恢复等）。

### 3.17 ScreenState（已废弃）

### 3.20 JourneyExitOutcome

```ts
type JourneyExitOutcome =
  | "skipped"
  | "browsed_and_left"
  | "risk_exit"
  | "max_steps";
```

说明：

- `skipped`：观众在 `feed_card` 直接调用 `exit_browsing`，没有点开详情，统计为真正跳过。
- `browsed_and_left`：观众点开详情或评论区后正常结束浏览。
- `risk_exit`：观众带着广告感、信任证据不足等风险/质疑信号结束浏览。
- `max_steps`：系统达到最大 journey 步数后结束。

### 3.21 ToolCategory

```ts
type ToolCategory =
  | "navigation"
  | "interaction";
```

### 3.22 IdentityRetentionPolicy

```ts
type IdentityRetentionPolicy =
  | "delete_with_origin_run"
  | "retain";
```

说明：

- `delete_with_origin_run`：该身份由某个 run 生成，删除来源 run 时如无运行事实引用且未收藏，可以清理整组 `user + agent + platform_account`。
- `retain`：该身份不随某个 run 自动清理。
- 是否可复用不由本枚举表达，而由 `agents.favorited_at` 是否为空表达。

### 3.23 AssetStorage

```ts
type AssetStorage =
  | "local"
  | "external";
```

`local` 表示由本服务保存到 uploads 目录；`external` 表示外部 URL，只记录引用，不删除远端资源。

## 4. 表结构

### test_runs

记录一次试映任务。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| status | RunStatus | run 状态；新增 `planning_audience` / `generating_audience` / `audience_ready` / `pausing` / `paused` 用于观众生成和运行控制流程 |
| mode | text | V1固定为 `single` |
| content_version_count | int | V1固定为 1 |
| audience_count | int | 目标观众数：快速 12，标准 30，自定义 1-10000 |
| simulation_speed | text | `fast_replay` / `normal` |
| config_json | jsonb | run 配置快照 |
| error_message | text nullable | 失败原因 |
| clock_elapsed_ms | int | Run Clock 已累计的模拟时间毫秒 |
| clock_anchor_at | timestamp nullable | 当前 running 段开始的真实时间；paused/completed 时为空 |
| clock_scale | int | Run Clock 时间倍率，默认 10 |
| terminal_reason | text nullable | completed 来源；`all_journeys_finished` 表示自然完成，`user_ended` 表示用户在暂停后结束并生成报告 |
| created_at | timestamp | 创建时间 |
| started_at | timestamp nullable | 启动时间 |
| completed_at | timestamp nullable | 完成时间 |
| updated_at | timestamp | 更新时间 |

建议索引：

```sql
create index idx_test_runs_status on test_runs(status);
create index idx_test_runs_created_at on test_runs(created_at desc);
```

### users

系统级行为主体。Agent 和前端用户都必须有 user。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| user_type | text | human / agent / system |
| nickname | text | 系统内展示昵称 |
| avatar_url | text nullable | 系统内头像 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

### agents

可复用 Agent 设定。每个 Agent 绑定一个 user。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| user_id | uuid / text | users.id，唯一 |
| origin_run_id | uuid / text nullable | 来源 run；手动或复用身份可为空 |
| source_profile_id | uuid / text nullable | 来源 audience_profiles.id |
| retention_policy | IdentityRetentionPolicy | delete_with_origin_run / retain |
| favorited_at | timestamp nullable | 不为空表示收藏进入可复用身份库 |
| persona_json | jsonb | 通用角色卡：`profile`、`personality`、`mbtiType`、`responseStyle` 四个字段 |
| memory_summary | text nullable | 跨 run 历史摘要，后续可选 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

`profile` 是这个人的背景小传/故事：稳定的真实生活背景、人生阶段、家庭/工作上下文、消费上下文、过往生活经历、长期习惯。`personality` 是稳定性格、风险偏好、社交倾向、情绪表达、决策耐心。`responseStyle` 是浏览判断风格、互动倾向、在注入的 platformName 上的评论表达习惯。`mbtiType` 必须是 MBTI 16 型之一，只作为创作风格标签。不得保存 `responseStyle.needMotivation` 等子字段，也不得保存 `currentNeed`、`purpose`、`attention`、`firstImpression`、`likelyConcerns` 等本次内容字段。

### platform_accounts

用户在某个平台上的账号。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| user_id | uuid / text | users.id |
| platform | text | xiaohongshu / douyin / wechat |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

### content_versions

V1 固定一个 run 只能有一个内容快照，数据库通过 `content_versions.run_id` 唯一约束强制执行。`content_version_id` 是帖子状态、评论、点赞、收藏、分享等内容事实的归属边界。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| run_id | uuid / text | 关联 test_runs |
| version_name | text | V1默认 `version_a` |
| title | text | 标题 |
| cover_image_url | text nullable | 第一张图 URL，作为封面展示字段 |
| image_urls_json | jsonb | 图片 URL 数组，最多 9 张；为空时由 cover_image_url 派生 |
| body_text | text | 正文 |
| scale | text | 规模：`quick`（12 人）/ `standard`（30 人）/ `custom`（观众数来自 test_runs.audience_count） |
| created_at | timestamp | 创建时间 |

约束：

```sql
unique(run_id)
```

### assets

记录上传或外部图片资产。`assets` 本身不是 run 的子表；它通过 `content_version_images` 被内容版本引用。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| storage | AssetStorage | local / external |
| url | text | 前端可访问 URL |
| storage_key | text nullable | local 文件名或外部资源 key |
| original_name | text nullable | 上传原始文件名 |
| mime_type | text nullable | MIME 类型 |
| width | int nullable | 图片宽度 |
| height | int nullable | 图片高度 |
| size_bytes | int nullable | 文件大小 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

约束：

```sql
unique(url)
```

### content_version_images

记录内容版本引用的图片顺序。删除 content version 时该表级联删除；删除 run 后，service 再清理不被任何内容版本引用的 local asset 文件。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| content_version_id | uuid / text | 内容版本 |
| asset_id | uuid / text nullable | 对应 asset；外部 URL 可为空或指向 external asset |
| url | text | 图片 URL 快照 |
| sort_order | int | 图片顺序，0 为封面 |
| created_at | timestamp | 创建时间 |

约束：

```sql
unique(content_version_id, sort_order)
unique(content_version_id, url)
```

### audience_sampling_plans

记录一场 run 的观众采样计划。该表是一等事实源，用户审核的是整场分布、总量、维度和解释；`plan_markdown` 只是展示快照，不作为 directive 的结构化事实源。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| run_id | uuid / text | 关联 run，V1 一场 run 只有一个 active sampling plan |
| generation_job_id | uuid / text? | 创建该 plan 的后台任务 |
| total_count | int | 计划总人数，数据库约束为正整数 |
| status | AudienceSamplingPlanStatus | draft / planning / ready_for_review / confirmed / expanding_profiles / generating_identities / ready / ready_with_failures / failed / canceled |
| plan_markdown | text | 给用户阅读的计划说明快照 |
| dimensions_json | jsonb | 采样维度摘要，例如目标人群、动机、怀疑机制、互动倾向 |
| error_message | text? | 计划生成或后续扩展失败原因 |
| confirmed_at | timestamp? | 用户确认时间 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

约束：

```sql
unique(run_id)
check(total_count > 0)
```

### audience_sampling_directives

记录 plan 下的具体采样指令。Directive 是“这一类组合生成多少人”的结构化事实源；确认 plan 前允许编辑，确认后锁定，后续 `AudienceProfile` 按 directive 展开。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| plan_id | uuid / text | 所属 sampling plan |
| sort_order | int | 展示和扩展顺序 |
| name | text | 人群短名称，用于分配头和扫读 |
| description | text | 采样组合描述，不包含 name 前缀 |
| quantity | int | 该组合需要生成的人数 |
| diversity_axes_json | jsonb | 该组合内需要拉开的差异轴 |
| rationale | text | 为什么需要该组合，以及重点观察什么反应或风险 |
| expansion_status | AudienceSamplingDirectiveExpansionStatus | pending / generating / ready / failed |
| expansion_error | text? | 扩展失败原因 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

约束：

```sql
unique(plan_id, sort_order)
check(quantity > 0)
check(sort_order >= 0)
```

确认 plan 时必须校验 `sum(audience_sampling_directives.quantity) = audience_sampling_plans.total_count`。不允许把 directives 作为 JSON 存在 plan 上作为事实源。

### audience_profiles

记录确认后由系统展开出来的采样 slot。它说明该 directive 内每个采样点覆盖什么基础处境和反应角度，用于覆盖和去重；它不是完整人设、不是用户第一步审核对象，也不是运行时快照。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| run_id | uuid / text | 关联 run |
| sampling_plan_id | uuid / text? | 来源 sampling plan |
| sampling_directive_id | uuid / text? | 来源 directive |
| sample_index | int | directive 内第几个样本 |
| generation_job_id | uuid / text? | 创建或占用该 profile 的后台生成任务 |
| sort_order | int | 展示顺序 |
| sampling_label | text | 采样点展示标签，不是最终用户昵称 |
| demographics_json | jsonb | 基础处境提示：gender、ageRange、cityTier、lifeStage、role、spendingPower 六字段必填 |

| identity_status | AudienceIdentityStatus | `profile_only` / `identity_queued` / `identity_generating` / `identity_ready` / `identity_failed` |
| identity_error | text? | 人设生成失败原因 |
| identity_generated_at | timestamp? | 人设生成时间 |
| generated_user_id | uuid / text nullable | 生成出的 users.id |
| generated_agent_id | uuid / text nullable | 生成出的 agents.id |
| generated_platform_account_id | uuid / text nullable | 生成出的 platform_accounts.id |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

约束：

```sql
unique(sampling_directive_id, sample_index)
```

### run_participants

记录本次 run 的具体参与者快照。只在 start 时从 `identity_ready` 的 audience profile 物化创建；start 不调用 LLM。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| run_id | uuid / text | 关联 run |
| user_id | uuid / text | users.id |
| agent_id | uuid / text | agents.id |
| platform_account_id | uuid / text | platform_accounts.id |
| source_profile_id | uuid / text nullable | 来源 audience_profiles.id |
| sampling_directive_id | uuid / text? | 来源采样指令，供运行期按计划项聚合 |
| source | text | generated / manual / saved_agent |
| sort_order | int | 展示顺序 |
| display_name_snapshot | text | 入场时显示名快照 |
| avatar_url_snapshot | text nullable | 入场时头像快照 |
| profile_snapshot_json | jsonb | 入场时画像需求快照 |
| agent_snapshot_json | jsonb | 入场时 Agent.persona_json 快照 |
| platform_account_snapshot_json | jsonb | 入场时平台 actor 极薄快照，至少包含 platform 和 platformAccountId |
| runtime_status | RunParticipantStatus | 入场后的运行状态 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |
`agent_snapshot_json` 示例:

```json
{
  "profile": "31 岁一胎新手妈妈，住新一线城市，近期在控制预算但愿意为确定性付费。",
  "personality": "谨慎务实，风险规避倾向强，愿意听同阶段用户经验但不轻易被种草。",
  "mbtiType": "ISFJ",
  "responseStyle": "通常相信真实经历、价格明细和具体型号；有用会收藏，遇到不确定信息会看评论或追问来源，评论表达口语化且问题具体。"
}
```

`run_participants` 不保存 `run_state_json`。不要在入场快照中预设 purpose、attention、currentNeed、likelyConcerns 或 firstImpression；这些应由运行时 AgentTurn 的 thought_text、tool call 和日志自然产生。

### audience_generation_jobs

记录一次后台观众生成任务。前端不直接创建任意 job；任务由采样计划、确认扩展、身份生成和重试接口触发，具体规划、扩展、失败标记、重试恢复由后端负责。

后台 worker 只能在同时满足以下条件时把 job 写入 `completed` / `failed`：`active=true`、`status in queued/planning/generating`、`locked_by` 仍为当前 worker，且 `locked_until` 未过期。若 job 已被取消、变为 inactive，或锁已过期并可能被恢复流程接管，stale worker 必须停止，不得再发 completed 事件。

`scope=single_identity` 用于结果层某一个 profile 的身份生成、重生或重试，可由新增观众、重生人设、失败重试等普通 API 触发；它不是第一步创建整批观众的入口。若目标 profile 已有完整身份引用，生成期间原身份保留为回滚句柄；新身份成功后在同一事务中清理原身份并写入新引用。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| run_id | uuid / text | 关联 run |
| scope | AudienceGenerationJobScope | sampling_plan / profile_expansion / identities / single_identity |
| status | AudienceGenerationJobStatus | queued / planning / generating / completed / failed / canceled |
| active | boolean | 同一 run 同时只允许一个 active job |
| profile_id | uuid / text? | single_identity 内部任务目标 profile |
| sampling_plan_id | uuid / text? | 目标 sampling plan |
| sampling_directive_id | uuid / text? | 目标 directive |
| target_count | int | 本任务目标观众数 |
| batch_size | int | 内部批处理 / claim 大小；对 `profile_expansion` 表示一次调度考虑的 directive 数，对 `identities` 表示一次领取的 profile 数，对 `single_identity` 固定为 1。真实 LLM HTTP 请求由 `LlmCapacityManager` 的 RPM + 并发双限流兜底（见 `03_Agent运行时设计.md` 9.3 节），不直接等同于 batch_size |
| error_message | text? | 任务级失败原因 |
| attempt_count | int | 任务领取/恢复次数 |
| locked_by | text? | 当前 worker 标识 |
| locked_until | timestamp? | worker 锁过期时间 |
| heartbeat_at | timestamp? | worker 最近心跳 |
| started_at / completed_at / canceled_at | timestamp? | 任务生命周期时间 |
| created_at / updated_at | timestamp | 创建和更新时间 |

恢复扫描规则：

```text
active=true
status in queued/planning/generating
locked_until is null or locked_until < now()
```

可恢复且未超过重试上限的 job 会重新领取执行；不可恢复、超过重试上限或状态不一致的 job 标记为 `failed`，并按上述规则释放相关 profile。另有一致性扫描会修复 `audience_profiles.identity_status in identity_queued/identity_generating` 但对应 job 不存在、inactive 或已终止的孤儿 profile。

### journeys

一个观众对一个内容版本的一次旅程。Agent 在所有阶段接收全部工具，由系统 prompt 和当前 screen 状态决定行为。

说明：`run_id` 表示这条 journey 属于哪次试映运行；`content_version_id` 表示这条 journey 面向哪个内容快照。V1 中二者经 `content_versions.run_id` 固定为一对一关系，但两个字段语义不同，不能互相替代。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| run_id | uuid / text | run |
| run_participant_id | uuid / text | run_participants.id |
| actor_user_id | uuid / text | users.id |
| platform_account_id | uuid / text | platform_accounts.id |
| content_version_id | uuid / text | 内容版本 |
| prompt_version | text nullable | 本旅程使用的 prompt 版本 |
| status | JourneyStatus | active / finished / failed |
| runner_status | JourneyRunnerStatus | queued / idle / running；Runner claim 和释放锁的状态 |
| queue_seq | bigint | Runner 内部排序和恢复辅助序号 |
| last_transcript_seq | int | 已写入的最大 transcript item 序号；用于原子递增生成 seq |
| current_step_index | int | 当前回合序号 |
| thought_summary | text nullable | 调试摘要字段；上下文连续性以 `agent_transcript_items` transcript 为事实源 |
| final_summary | text nullable | 旅程最终总结 |
| exit_outcome | JourneyExitOutcome nullable | 最终业务结局；UI、统计和报告以此为主口径 |
| exit_reason | text nullable | 终局原因说明，供观众详情和报告引用 |
| error_message | text nullable | 失败原因 |
| locked_by | text nullable | 当前持有 journey 的 Runner worker 标识 |
| locked_at | timestamp nullable | Runner 锁定时间 |
| heartbeat_at | timestamp nullable | Runner 最近心跳时间 |
| started_at | timestamp nullable | 开始时间 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |
| completed_at | timestamp nullable | 完成时间 |

说明：Agent 不写入分数。最终评分由报告层写入 `reports.dimensions_json`。点赞、收藏等幂等状态不保存在 journey 字段中，而由 `social_reactions` 判断。

建议约束：

```sql
unique(run_id, run_participant_id, content_version_id)
```

### agent_transcript_items

Agent transcript 项表。按 seq 保存 initial_observation、assistant_message、assistant_tool_calls、tool_result、system_notice 等。即使 assistant content 为空，只要有 tool calls，也必须保存 assistant_tool_calls，否则无法还原 tool result 对应关系。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| run_id | uuid / text | test_runs.id |
| journey_id | uuid / text | agent_journeys.id |
| seq | int | journey 内序号，从 1 递增；通过 `agent_journeys.last_transcript_seq` 原子递增生成 |
| item_type | text | initial_observation / assistant_message / assistant_tool_calls / tool_result / system_notice |
| content | text nullable | 文本内容（assistant message 的 thought_text 等） |
| reasoning_content | text nullable | 模型推理内容（如 MiMo 的 reasoning_content） |
| observation_json | jsonb nullable | initial_observation 的结构化 observation |
| tool_calls_json | jsonb nullable | assistant tool calls（当 item_type = assistant_tool_calls 时） |
| tool_result_json | jsonb nullable | tool 执行结果（当 item_type = tool_result 时） |
| agent_turn_id | uuid / text nullable | 关联的 agent_turn |
| agent_tool_call_id | uuid / text nullable | 关联的 agent_tool_call |
| metadata_json | jsonb | toolName / callIndex / sdkCallId / status 等恢复辅助信息 |
| created_at | timestamp | 创建时间 |

约束：

```sql
unique(journey_id, seq)
unique(agent_tool_call_id, item_type)
```

`unique(agent_tool_call_id, item_type)` 依赖数据库对 NULL 值的唯一约束语义（SQLite 和 PostgreSQL 均允许多行 NULL）；它只约束带 tool call 引用的记录，防止同一个 tool call 产生多个 `tool_result` transcript item。

说明：

```text
1. initial_observation 是 journey 的起始输入（feed_observation 或 post_detail_observation）。
2. assistant_message 是 agent 的文本输出（thought_text）。
3. assistant_tool_calls 是 agent 的工具调用请求。
4. tool_result 是工具执行后的返回值。
5. system_notice 是系统级通知（如错误恢复等）。
6. 这些 item 构成 append-only transcript，是恢复的事实源。
```

### agent_turns

一个 AgentRunner 循环中的模型回合和证据单元。注意它不是全局调度任务，也不是单个工具动作。

说明：Scheduler claim `agent_journeys`，Runner 在循环内创建 `agent_turns`。`content_version_id` 是该 turn 执行工具时写入内容事实的目标版本，必须继承所属 journey 的内容版本。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| run_id | uuid / text | run |
| run_participant_id | uuid / text | run participant |
| actor_user_id | uuid / text | users.id |
| platform_account_id | uuid / text | platform account |
| journey_id | uuid / text | journey |
| content_version_id | uuid / text | 内容版本 |
| step_index | int | 回合序号 |
| queue_seq | bigint | Runner 内部排序和恢复辅助序号；不作为全局 action queue |
| status | AgentTurnStatus | created / context_recorded / model_calling / model_returned / tools_executing / completed / failed / recovered |
| thought_text | text nullable | 本轮 Agent 可展示心路历程 |
| reasoning_content | text nullable | 模型推理内容（如 MiMo 的 reasoning_content） |
| raw_agent_output_json | jsonb nullable | 原始 Agent 输出，便于回放和排障 |
| request_json | jsonb nullable | 发给模型的完整请求（或可重建请求），用于 raw audit |
| raw_response_json | jsonb nullable | 模型 provider 原始响应，用于 raw audit |
| parsed_tool_calls_json | jsonb nullable | 从原始响应解析出的 tool calls，用于 raw audit |
| model | text nullable | 本回合使用的模型名 |
| prompt_version | text nullable | 本回合使用的 prompt 版本 |
| retry_count | int | 重试次数 |
| error_message | text nullable | 错误信息 |
| locked_by | text nullable | 锁持有者，用于运行时并发控制 |
| locked_at | timestamp nullable | 锁时间 |
| started_at | timestamp nullable | 开始时间 |
| completed_at | timestamp nullable | 完成时间 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

关键索引：

```sql
create index idx_agent_turns_pending
on agent_turns(run_id, status, queue_seq, created_at);

create unique index ux_agent_turn_step
on agent_turns(journey_id, step_index);
```

### agent_turn_contexts

保存每次 Agent 调用前的上下文快照，便于回放和排障。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| agent_turn_id | uuid / text | agent_turn |
| screen_before_json | jsonb | 阶段快照（调用前的 `hasOpenedPost` 等上下文派生值） |
| post_state_before_json | jsonb | 调用前帖子状态 |
| comments_page_json | jsonb | 调试快照字段；评论事实来自 `view_comments` 的 tool result |
| thought_summary | text nullable | 调试摘要字段；不作为会话上下文事实源 |
| available_tools_json | jsonb | 调试快照字段；Agent 在所有阶段接收全部工具 |
| input_context_json | jsonb | 完整 Agent 输入 |
| model | text | 模型名 |
| prompt_version | text | prompt 版本 |
| created_at | timestamp | 创建时间 |

### agent_tool_calls

保存一个 AgentTurn 内发生的所有 tool call。toolExecutor 调用统一 runtime service 提交业务状态，无 ToolEffect 中间收集阶段。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| agent_turn_id | uuid / text | 所属 AgentTurn |
| run_id | uuid / text | run |
| journey_id | uuid / text | journey |
| run_participant_id | uuid / text | run participant |
| actor_user_id | uuid / text | users.id |
| platform_account_id | uuid / text | platform account |
| content_version_id | uuid / text | 内容版本 |
| call_index | int | tool call 顺序 |
| sdk_call_id | text nullable | SDK 返回的 call id |
| idempotency_key | text | 全局唯一幂等键，格式 `{runId}:{participantId}:{turnId}:{callIndex}` |
| raw_tool_call_json | jsonb nullable | 原始 tool call 声明，用于 raw audit |
| tool_name | text | 工具名 |
| tool_category | ToolCategory | 工具分类 |
| input | jsonb | 工具入参（原 tool_args_json） |
| output | jsonb | service 提交结果（原 tool_result_json） |
| status | AgentToolCallStatus | pending / committed / ignored / failed |
| simulated_time | int | 发生时的模拟时间 |
| error_message | text nullable | 错误信息 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

约束：

```sql
unique(agent_turn_id, call_index)
```

说明：
- `input` / `output` 为统一命名，对应 SDK 的 tool call input/output。
- 无 `tool_effect_json` —— 工具直接写入结果，无 effect-collection 阶段。
- `unique(agent_turn_id, call_index)` 作为幂等键，防止重试时重复点赞/评论。

### live_events

SSE 事件持久化表，支持 Last-Event-ID 断线重连与事件回放。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| run_id | uuid / text | 关联 test_runs |
| event_type | text | 事件类型（如 `post_state.updated`、`comments.page_loaded`、`comment.created`、`audience.status_updated`、`audience.action_happened`、`action_log.created`、`summary.updated`、`insight.created`、`run.completed`、`run.paused`） |
| payload | jsonb | 事件数据 |
| sequence | bigserial | 自增序列号，用作 SSE `id` 字段（Last-Event-ID 回放依据） |
| created_at | timestamp | 创建时间 |

说明：
- SSE 连接断开后，客户端通过 `Last-Event-ID: {sequence}` 请求重连，服务端从该 sequence 之后的事件开始回放。
- `sequence` 使用 `bigserial` 保证全局递增且不回退。
- SSE 协议中的 `id:` 使用 `String(sequence)`，payload 中的 `eventId` 也使用同一个字符串。
- `id` 是数据库 UUID 主键，不暴露为 SSE `id`。
- `payload` 结构因 `event_type` 而异，前端根据 `event_type` 分发处理。
- 建议定期清理已消费事件（如 7 天前），防止表无限增长。

建议索引：

```sql
create index idx_live_events_run_sequence on live_events(run_id, sequence);
create index idx_live_events_created_at on live_events(created_at);
```

### simulated_post_states

当前模拟帖子状态。该表是内容事实表，每个 content_version 一条，不保存 `run_id`；需要 run 归属时通过 `content_versions.run_id` 回溯。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| content_version_id | uuid / text | 内容版本 |
| exposure_count | int | 曝光 |
| open_count | int | 点开 |
| like_count | int | 点赞 |
| favorite_count | int | 收藏 |
| comment_count | int | 评论 |
| share_count | int | 分享，V1可为 0 |
| exit_count | int | 退出 |
| current_phase | text | running / completed |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

约束：

```sql
unique(content_version_id)
```

### social_interaction_events

记录显性互动和页面行为。该表是 append-only 互动主体事实源。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| content_version_id | uuid / text | 内容版本 |
| actor_user_id | uuid / text | 行为用户 |
| platform_account_id | uuid / text | 行为平台账号 |
| run_participant_id | uuid nullable | run participant；前端普通用户可为空 |
| agent_id | uuid nullable | Agent 来源；真人用户为空 |
| source | text | agent_tool / human_ui / system_seed / replay |
| interaction_type | text | open_post / view_comments / like_post / favorite_post / share_post / write_comment / like_comment / exit_browsing |
| target_type | text | post / comment |
| target_id | uuid / text | 目标 id |
| journey_id | uuid nullable | Agent journey |
| journey_action_id | uuid nullable | 历史列名；语义为 AgentTurn |
| tool_call_id | uuid nullable | 历史列名；语义为 AgentToolCall |
| metadata_json | jsonb | cursor、sort、screen、exitOutcome 等 |
| simulated_time | int | 模拟时间 |
| created_at | timestamp | 创建时间 |

说明：

```text
1. 每次行为都写入本表，作为回放、报告、排障和审计事实源。
2. 幂等型 reaction 另写 social_reactions。
3. tool_call_id 只在 source=agent_tool 时存在。
4. 该表不保存 run_id；run 归属通过 content_versions 回溯，避免内容事实出现两个 owner。
```

### social_reactions

记录"一人对一目标最多一次"的幂等 reaction。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| content_version_id | uuid / text | 内容版本 |
| actor_user_id | uuid / text | 行为用户 |
| platform_account_id | uuid / text | 平台账号 |
| target_type | text | post / comment |
| target_id | uuid / text | 目标 id |
| reaction_type | text | like / favorite |
| source | text | agent_tool / human_ui / system_seed / replay |
| created_at | timestamp | 创建时间 |

幂等约束：

```sql
unique(content_version_id, actor_user_id, platform_account_id, target_type, target_id, reaction_type)
```

说明：post 点赞、post 收藏、comment 点赞均走本表；share 是可重复事件，不走本表。

### loaded_comment_pages

记录某个 journey 已加载的评论分页，支持 Agent 后续回复已见评论，也支持回放。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| content_version_id | uuid / text | 内容版本 |
| run_participant_id | uuid / text | run participant |
| actor_user_id | uuid / text | 行为用户 |
| platform_account_id | uuid / text | 平台账号 |
| source | text | agent_tool / human_ui / system_seed / replay |
| journey_id | uuid / text | journey |
| journey_action_id | uuid / text | 历史列名；语义为 AgentTurn |
| tool_call_id | uuid / text | 历史列名；语义为 view_comments 的 AgentToolCall |
| cursor | text | 本页请求 cursor；API/tool 的 `null` 在持久化时映射为空字符串，避免 nullable unique 允许重复首页 |
| next_cursor | text nullable | 下一页 cursor |
| comment_ids_json | jsonb | 本页返回的 10 条评论 id |
| has_more | boolean | 是否还有下一页 |
| simulated_time | int | 模拟时间 |
| created_at | timestamp | 创建时间 |

幂等约束：

```sql
unique(content_version_id, actor_user_id, platform_account_id, cursor, sort)
```

### simulated_comments

记录 Agent 或前端用户生成的评论。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| content_version_id | uuid / text | 内容版本 |
| actor_user_id | uuid / text | 评论用户 |
| platform_account_id | uuid / text | 平台账号 |
| run_participant_id | uuid nullable | run participant |
| agent_id | uuid nullable | agent |
| source | text | agent_tool / human_ui / system_seed / replay |
| journey_id | uuid nullable | Agent journey |
| journey_action_id | uuid nullable | 历史列名；语义为 AgentTurn |
| tool_call_id | uuid nullable | 历史列名；语义为 write_comment 的 AgentToolCall |
| parent_comment_id | uuid nullable | 回复对象；为空表示回复主帖 |
| root_comment_id | uuid nullable | 所属一级评论；回复链路中用于聚合线程 |
| comment_text | text | 评论内容，对应 write_comment.content |
| mentioned_user_ids_json | jsonb nullable | @ 到的 user id，V1可为空 |
| mentioned_comment_ids_json | jsonb nullable | @ 或引用到的评论 id，V1可为空 |
| like_count | int | 评论被点赞数；用于最热排序，默认 0 |
| reply_count | int | 直接回复该评论的数量；write_comment 回复评论时递增 |
| simulated_time | int | 模拟时间 |
| created_at | timestamp | 创建时间 |

说明：
- `parent_comment_id` 为空表示一级评论；有值表示回复某条评论。
- `root_comment_id` 预留给多层评论线程，一级评论等于自身 id，回复评论指向所属一级评论。
- `like_count` 和 `reply_count` 是评论热度排序字段；`like_comment` 和 `replyComment` service 负责维护。
- `mentioned_user_ids_json` / `mentioned_comment_ids_json` 预留给后续 `@`、引用、相互回复等真实评论区行为；V1可以写空数组。
- `comment_type`、`sentiment`、`risk_tag`、`topic_tags` 等分类不由 Audience Agent 写入。报告层可基于评论文本和上下文派生。

### action_logs

前端行动日志。主要来源是 `agent_turns.thought_text` 和已提交工具，不记录隐藏推理链。

说明：该表是 journey/action 的执行证据，不是纯内容事实表。`run_id` 用于 run 级时间线与观众详情查询；`content_version_id` 用于报告和证据链按内容快照过滤，二者语义不同。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| run_id | uuid / text | run |
| content_version_id | uuid / text | 内容版本 |
| run_participant_id | uuid / text nullable | run participant |
| actor_user_id | uuid / text nullable | users.id |
| platform_account_id | uuid / text nullable | platform account |
| journey_id | uuid / text | journey |
| journey_action_id | uuid / text | 历史列名；语义为 AgentTurn |
| tool_call_id | uuid / text nullable | 历史列名；语义为来源 AgentToolCall |
| simulated_time | int | 模拟时间 |
| log_text | text | 前端展示文本 |
| action | text nullable | 关联动作，如 thought / open_post / write_comment |
| thought_text | text nullable | 本轮可展示心路历程 |
| emotion | text nullable | 情绪 |
| topic_tags_json | jsonb | 标签 |
| risk_tags_json | jsonb | 风险标签 |
| created_at | timestamp | 创建时间 |

注意：`thought_text` 是角色扮演出的用户反应，不是模型隐藏推理链。

### run_logs

右侧 Runtime Dock 的 run 级运行日志。它记录生成、调度、控制、等待、异常等系统运行过程，不替代观众行动日志。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| run_id | uuid / text | run |
| log_type | text | generation / dispatch / result / waiting / control / exception |
| message | text | 展示文本 |
| run_participant_id | uuid / text nullable | 关联 run participant，可为空 |
| actor_user_id | uuid / text nullable | 关联 user，可为空 |
| metadata_json | jsonb | 附加信息 |
| simulated_time | int | 日志实际落库时的 Run Clock 秒数 |
| created_at | timestamp | 真实落库时间 |

建议索引：

```sql
create index idx_run_logs_run_type_time
on run_logs(run_id, log_type, simulated_time, created_at);

create index idx_run_logs_run_time
on run_logs(run_id, simulated_time, created_at);
```

### llm_call_traces

每次真实 LLM provider call 的 token 使用明细。该表由 AI SDK telemetry 写入，用于成本审计、排障和后续实时展示。它不是完整 prompt/request 存储；完整 turn 请求和响应仍在 `agent_turns.request_json / raw_response_json`。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| run_id | uuid / text | 所属 run |
| task_type | text | audience_plan / audience_profile_expansion / audience_persona / agent_turn / report 等 |
| provider | text nullable | AI SDK model provider |
| model | text | 实际模型名 |
| prompt_version | text nullable | prompt 版本 |
| agent_turn_id | uuid / text nullable | 运行期 AgentTurn；非运行期任务为空 |
| run_participant_id | uuid / text nullable | 运行期观众 |
| job_id | uuid / text nullable | audience generation job |
| profile_id | uuid / text nullable | audience profile |
| step_number | int | AI SDK step number；multi-step tool loop 会写多行 |
| finish_reason | text nullable | provider / AI SDK finish reason |
| input_tokens | int nullable | 输入 tokens |
| output_tokens | int nullable | 输出 tokens |
| total_tokens | int nullable | 总 tokens；缺失时可由 input + output 回退 |
| reasoning_tokens | int nullable | reasoning tokens，provider 支持时记录 |
| cache_read_tokens | int nullable | prompt cache read tokens，provider 支持时记录 |
| cache_write_tokens | int nullable | prompt cache write tokens，provider 支持时记录 |
| no_cache_input_tokens | int nullable | 未命中缓存的输入 tokens，provider 支持时记录 |
| raw_usage_json | json nullable | provider 原始 usage 子结构，不含 prompt / output 文本 |
| metadata_json | json | functionId、toolCallCount、telemetry metadata 等非敏感元数据 |
| created_at | timestamp | 落库时间 |

建议索引：

```sql
create index idx_llm_call_traces_run_task_time
on llm_call_traces(run_id, task_type, created_at);

create index idx_llm_call_traces_run_time
on llm_call_traces(run_id, created_at);

create index idx_llm_call_traces_agent_turn_id
on llm_call_traces(agent_turn_id);
```

### run_llm_usage_summaries

run 级 LLM token 累计表。它由 `llm_call_traces` 写入路径同步增量维护，方便后续实时显示和成本审计快速读取。

| 字段 | 类型 | 说明 |
|---|---|---|
| run_id | uuid / text | 主键，所属 run |
| call_count | int | 已记录 provider call 数 |
| input_tokens | int | 累计输入 tokens |
| output_tokens | int | 累计输出 tokens |
| total_tokens | int | 累计总 tokens |
| reasoning_tokens | int | 累计 reasoning tokens |
| cache_read_tokens | int | 累计 cache read tokens |
| cache_write_tokens | int | 累计 cache write tokens |
| no_cache_input_tokens | int | 累计未命中缓存输入 tokens |
| updated_at | timestamp | 最近更新时间 |

注意：AI SDK `generateText` 的 multi-step tool loop 会产生多次 provider call。每个 step 都会重新发送必要上下文并被 provider 计费，所以 `llm_call_traces` 必须逐 step 记录，`run_llm_usage_summaries` 也必须逐 step 累加。

### insights

过程洞察。该表是内容级派生事实，不保存 `run_id`；按 `content_version_id` 查询，需要 run 归属时通过 `content_versions` 回溯。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| content_version_id | uuid / text | 内容版本 |
| level | text | normal / important / risk |
| title | text | 洞察标题 |
| evidence | text | 证据摘要 |
| related_participant_ids_json | jsonb | 相关 run participants |
| related_user_ids_json | jsonb | 相关 users |
| related_tool_call_ids_json | jsonb | 相关 tool call |
| related_comment_ids_json | jsonb | 相关评论 |
| simulated_time | int | 模拟时间 |
| created_at | timestamp | 创建时间 |

### 观众席前端派生模型

AI 观众席是前端现场页的核心 UI，但 V1 不要求新增核心事实表。`AudienceSeat` 和 `AudienceDetail` 可以从现有表派生：

```text
run_participants
users
platform_accounts
journeys
social_interaction_events
social_reactions
simulated_comments
action_logs
insights
```

#### AudienceSeat 派生口径

| 字段 | 来源 |
|---|---|
| participantId | run_participants.id |
| actorUserId | run_participants.user_id |
| agentId | run_participants.agent_id |
| platformAccountId | platform_accounts.id |
| name | run_participants.display_name_snapshot |
| avatarUrl | run_participants.avatar_url_snapshot |
| segment | run_participants.sampling_directive_id 对应 directive name / description，或 profile_snapshot_json 中的兼容字段 |
| personaSummary | run_participants.agent_snapshot_json 的短摘要 |
| status | 优先由 journeys.exit_outcome 派生；active journey 再通过 interaction/action_log 派生 |
| exitOutcome | journeys.exit_outcome |
| exitReason | journeys.exit_reason |
| currentAction | 最近 social_interaction_events.interaction_type 或 action_logs.action |
| hasOpened | social_interaction_events 是否存在 open_post |
| hasLiked | social_reactions 是否存在 post like |
| hasFavorited | social_reactions 是否存在 post favorite |
| hasCommented | simulated_comments 是否存在该 actor_user_id / run_participant_id |
| hasSkipped | journeys.exit_outcome = skipped |
| hasDoubt | action_logs.risk_tags_json / simulated_comments 文本和报告层分类派生 |
| lastObservableLog | 最近 action_logs.log_text |
| lastUpdatedSimulatedTime | 最近 action_logs 或 social_interaction_events 的 simulated_time |

推荐 `status` 派生规则：

```text
无 journey：not_started
journey active 且 !hasOpened：entered
journey active 且 hasOpened 且 !hasViewedComments：watching
journey active 且 hasOpened 且 hasViewedComments：viewing_comments
最近 action_logs 表示犹豫：hesitating
已点赞：liked
已收藏：favorited
已评论：commented
exit_outcome = skipped：skipped
exit_outcome = risk_exit：risk_exit
exit_outcome = browsed_and_left 或 max_steps：finished
journey finished 但缺少 exit_outcome：finished
journey failed：failed
```

说明：

```text
1. `AudienceSeat` 是展示模型，不是事实模型。
2. 状态优先级应由实现固定，避免同一观众同时显示多个主状态。
3. 收藏、评论、质疑等可以作为角标叠加，不必都覆盖主状态。
4. 观众席最多 20 人活跃时仍使用矩阵结构，不按活跃人数扩展为大卡片。
```

#### AudienceDetail 派生口径

观众详情抽屉从以下信息组合：

```text
persona：run_participants.agent_snapshot_json
journey：journeys
timeline：action_logs + social_interaction_events 按 simulated_time 合并
interactions：social_interaction_events + social_reactions
comments：simulated_comments
相关洞察：insights.related_participant_ids_json / related_user_ids_json
```

行动日志仍是证据链，但不再是现场页主区域。

### reports

最终报告。

标识口径：

```text
1. 对外路由和 API 使用 run_id 获取报告，例如 /reports/:runId 和 GET /api/runs/:runId/report。
2. reports.id 是报告产物的内部主键，用于证据索引、调试追踪和后续报告重生成 / 版本化扩展。
3. V1 一个 run 最多生成一份最终报告，因此 reports.run_id 需要唯一约束。
4. 前端主流程不需要保存 reportId；run.completed 中的 reportId 只作为追踪字段。
```

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid / text | 主键 |
| run_id | uuid / text | run |
| content_version_id | uuid / text | 内容版本 |
| recommendation | text | 发布建议 |
| report_output_json | jsonb | ReportOutput 完整结构（verdict/funnel/mainBlocker/audienceGroupAnalysis/segments/diagnostics/keepAndChange/revisionPlan/retestPlan/evidenceRefs/keyFindings/rewriteSuggestions/summaryMarkdown）。0004 migration 替换了旧的 summary/dimensions/risk 等 JSON 列。注意：当前版本不包含 runMetadata、audienceModel、reportModel 字段，模型拆分和 token 用量追踪作为未来路线，暂未公开 |
| evidence_pack_json | jsonb | EvidencePack 完整结构（meta/content/funnel/exitAnalysis/commentAnalysis/thoughtAnalysis/segments/blockers/audienceGroups/journeySamples/evidenceIndex） |
| model | text | 报告生成模型 |
| prompt_version | text | 报告 prompt 版本 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

约束：

```sql
unique(run_id)
```

### 运行控制事件存储口径

V1 不单独创建 `run_control_events` 表。用户控制行为和系统控制状态变化通过两类现有表表达：

```text
live_events：前端可见 SSE 事件，如 run.pausing / run.paused / run.resumed / run.completed / run_log.created
run_logs：运行日志栏数据，如 generation / control / dispatch / result / waiting / exception
```

如果后续需要独立审计流，可再新增 `run_control_events`，但当前数据库 schema 和迁移以 `live_events` + `run_logs` 为准。

## 5. 核心关系

```text
test_runs 1 -- n content_versions
test_runs 1 -- 0/1 audience_sampling_plans
test_runs 1 -- n audience_profiles
test_runs 1 -- n run_participants
test_runs 1 -- n live_events
test_runs 1 -- n run_logs
users 1 -- 0/1 agents
users 1 -- n platform_accounts
audience_sampling_plans 1 -- n audience_sampling_directives
audience_sampling_plans 1 -- n audience_profiles
audience_sampling_directives 1 -- n audience_profiles
audience_profiles 0/1 -- 1 agents
audience_profiles 0/1 -- 1 platform_accounts
audience_profiles 0/n -- n run_participants
assets 1 -- n content_version_images
content_versions 1 -- n content_version_images
run_participants 1 -- n agent_journeys
agent_journeys 1 -- n agent_transcript_items
agent_journeys 1 -- n agent_turns
agent_turns 1 -- n agent_tool_calls
agent_tool_calls 1 -- 0/n social_interaction_events
agent_tool_calls 1 -- 0/1 simulated_comments
agent_tool_calls 1 -- 0/1 loaded_comment_pages
agent_turns 1 -- 0/n action_logs
social_reactions n -- 1 users
simulated_comments n -- 1 users
content_versions 1 -- 1 simulated_post_states
test_runs 1 -- 0/1 reports
content_versions 1 -- 0/1 reports
```

说明：

```text
1. live_events 关联 test_runs，用于 SSE 实时事件流持久化与断线重连。
2. agent_transcript_items 是 append-only transcript，直接关联 journey，是恢复的事实源。
3. agent_turns 直接关联 journey，标识该 turn 属于哪个旅程。
4. agent_journeys.last_transcript_seq 用于原子生成 transcript 序号。
```

## 6. 幂等与一致性要求

### 6.1 AgentJourney 锁定

调度器领取 AgentJourney 时必须原子更新。AgentTurn 不作为全局调度任务：

```sql
update agent_journeys
set runner_status = 'claimed',
    locked_by = $workerId,
    locked_at = now(),
    heartbeat_at = now(),
    updated_at = now()
where id = $journeyId
  and status = 'active'
  and runner_status = 'queued'
returning *;
```

没有返回记录则表示已被其他 worker 领取或 journey 已 terminal。

### 6.2 Tool call 提交（Service Commit）

toolExecutor 调用统一 runtime service 提交业务状态，无 ToolEffect 中间收集阶段。

同一 `agent_turn_id + call_index` 只能提交一次（幂等键）。

如果重试时发现已提交：

```text
1. 读取已有 output（service 写入的结果）。
2. 不重复改变 post_state。
3. 不重复创建 comment。
4. 不重复写入 live_events，或推送时带 dedupe key。
```

### 6.3 状态更新事务

状态变更类工具必须在事务中提交：

```text
1. 写 agent_tool_calls。
2. 写 social_interaction_events / social_reactions / simulated_comments / loaded_comment_pages / action_logs。
3. 更新 simulated_post_states。
4. 更新 journeys。
5. 必要时标记 agent_journey finished。
6. 标记当前 agent_turn completed。
```

## 7. V1不建的表

V1不需要：

```text
real_platform_posts
real_platform_metrics
ab_test_groups
recommendation_graph
comment_threads_deep
external_queue_jobs
audience_memories
```

`audience_memories` V1不建；单个 journey 内连续性由 `agent_transcript_items` append-only transcript 提供。跨 run 记忆后续再通过 Agent 层 memory 设计承载。

可选物化 conversation cache/checkpoint 不作为独立表；如需性能优化，可在 agent_journeys 上增加 cache_json / last_transcript_seq 等字段，但这些只是加速缓存，不是事实源。版本或 lastSeq 不匹配时从 transcript 重建。

## 8. Roadmap / Future Extensions

以下字段不纳入 V1 正式 schema。后续版本如有需要可作为扩展添加：

- **cover_description**：封面文字描述，可作为无图场景下的降级输入，供 AI 理解封面内容。
- **account_context**：账号背景信息，帮助 AI 更好理解内容发布者的身份和定位。
- **target_audience**：目标人群描述，用于辅助观众匹配和筛选。
- **focus_questions**：用户想重点观察的问题，可引导洞察和报告生成聚焦于特定维度。
- **cover_image_asset_id**：封面图资产 ID，用于关联外部资源管理系统。
