# TryCue Code Wiki

> 本文档是 TryCue 仓库的结构化代码百科，覆盖项目整体架构、主要模块职责、关键类与函数、依赖关系以及运行方式。
> 文档事实源仍以 [docs/00_README_文档索引.md](docs/00_README_文档索引.md) 为准，本文是对代码实现的导航与摘要。

---

## 目录

1. [项目概览](#1-项目概览)
2. [整体架构](#2-整体架构)
3. [Monorepo 结构与依赖关系](#3-monorepo-结构与依赖关系)
4. [packages/shared — 共享契约层](#4-packagesshared--共享契约层)
5. [packages/db — 数据库层](#5-packagesdb--数据库层)
6. [apps/api — 后端服务](#6-appsapi--后端服务)
7. [apps/web — 前端工作台](#7-appsweb--前端工作台)
8. [关键流程](#8-关键流程)
9. [项目运行方式](#9-项目运行方式)
10. [配置与环境变量](#10-配置与环境变量)
11. [测试与验证](#11-测试与验证)
12. [核心设计要点](#12-核心设计要点)

---

## 1. 项目概览

### 1.1 项目定位

TryCue 是一个 **AI 试映工作台**，用于在内容正式发布前，模拟目标观众画像对社交内容草稿的反应。

- **V1 范围**：单版本试映流程 — 创建内容草稿 → 生成并审核观众采样计划 → 运行模拟观众行为流 → 实时观察交互证据 → 从持久化证据生成报告。
- **不做什么**：不接真实小红书或任何外部社交平台，不做真实 DOM 自动化，不预测真实平台效果，不做多版本 PK。

### 1.2 技术栈

| 层级 | 技术选型 |
|---|---|
| 包管理 | pnpm 10.4.0 + workspace |
| 语言 | TypeScript 5.9（strict + noUncheckedIndexedAccess） |
| 后端 | Fastify 5 + Prisma 6 + better-sqlite3 |
| 前端 | Vite + React 19（无 React Router，无状态管理库） |
| LLM | AI SDK（`@ai-sdk/openai-compatible`），支持 mock/real 双模式 |
| 实时通信 | SSE（Server-Sent Events），不使用 WebSocket |
| 数据库 | SQLite（本地开发）+ 可选 PostgreSQL（docker-compose） |
| 校验 | Zod 4（跨边界契约） |

### 1.3 仓库入口文件

- [README.md](README.md) — 项目说明
- [package.json](package.json) — workspace 根配置
- [pnpm-workspace.yaml](pnpm-workspace.yaml) — workspace 定义
- [docs/00_README_文档索引.md](docs/00_README_文档索引.md) — 文档入口

---

## 2. 整体架构

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│  apps/web (Vite React SPA)                                  │
│  ├─ 工作台 / 现场页 / 报告页 / 设置页 / 历史页             │
│  ├─ SSE EventSource 订阅                                    │
│  └─ fetch → /api/*                                          │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP + SSE
┌────────────────────────▼────────────────────────────────────┐
│  apps/api (Fastify)                                         │
│  ├─ 路由层 (app.ts)                                         │
│  ├─ View 层 (views.ts) — Prisma row → shared DTO            │
│  ├─ Runtime Service 层                                      │
│  │   ├─ runService.ts (run 生命周期 + 观众生成)             │
│  │   ├─ scheduler.ts (Agent 调度器)                         │
│  │   ├─ interactions.ts (统一互动服务)                      │
│  │   ├─ agentSessions.ts (transcript)                       │
│  │   ├─ comments.ts / clock.ts / queue.ts / identity.ts     │
│  │   └─ report.ts (报告生成)                                │
│  ├─ Agent Provider 层                                       │
│  │   ├─ mockAgent.ts (确定性 Mock)                          │
│  │   ├─ realAgent.ts (AI SDK + OpenAI-compatible)           │
│  │   ├─ reportAgent.ts (报告 LLM)                           │
│  │   └─ taskRunner.ts (任务追踪 + token 用量)               │
│  ├─ Tool Executor (toolExecutor.ts)                         │
│  ├─ LLM 配置 (llmConfigStore.ts + llm/)                     │
│  └─ SSE 总线 (liveEvents.ts)                                │
└────────────────────────┬────────────────────────────────────┘
                         │ Prisma Client
┌────────────────────────▼────────────────────────────────────┐
│  packages/db (Prisma + SQLite)                              │
│  └─ 24 个 model / 22 个枚举 / 3 个 migration                │
└─────────────────────────────────────────────────────────────┘
                         ▲
                         │ Zod schema + TS 类型
┌────────────────────────┴────────────────────────────────────┐
│  packages/shared (Zod 契约 + DTO + SSE 事件类型)            │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心数据流

```
用户创建内容草稿
  → RunService.createRun (status: draft)
  → RunService.createAudienceSamplingPlan (status: planning_audience)
       → AgentProvider.generateAudienceSamplingPlan (LLM/Mock)
       → 流式推送 audience.plan.* SSE 事件
  → 用户审核/编辑 directive
  → RunService.confirmAudienceSamplingPlan (status: generating_audience)
       → AgentProvider.expandAudienceProfiles (流式)
       → AgentProvider.generateAudiencePersona (批量)
       → 推送 audience.profile.* / audience.identity.* 事件
  → status: audience_ready
  → Scheduler.start (status: running)
       → queue.admitWaitingAudiences (创建 AgentJourney)
       → Scheduler.runLoop (并发=N)
            → claimRunnableJourneys (原子 UPDATE...RETURNING)
            → AgentProvider.runAudienceTurn (AI SDK streamText)
            → ToolExecutor.withToolContext (事务提交)
            → 推送 action_log.created / audience.action_happened / summary.updated
       → 全部完成 → status: report_generating
  → report.generateReportAndCompleteRun
       → reportAgent.generateReportWithLLM (pro 模型)
       → status: completed
```

---

## 3. Monorepo 结构与依赖关系

### 3.1 目录结构

```
trycue/
├── apps/
│   ├── api/                    # Fastify 后端
│   │   ├── src/
│   │   │   ├── agents/         # Agent Provider (mock/real)
│   │   │   ├── llm/            # LLM 限流 + tracing
│   │   │   ├── runtime/        # 业务运行时服务
│   │   │   ├── tests/          # 集成测试
│   │   │   ├── tools/          # 工具执行器
│   │   │   ├── app.ts          # Fastify 应用构建
│   │   │   ├── config.ts       # 配置加载
│   │   │   ├── env.ts          # 环境变量
│   │   │   ├── errors.ts       # 错误处理
│   │   │   ├── liveEvents.ts   # SSE 事件总线
│   │   │   ├── llmConfigStore.ts
│   │   │   ├── logger.ts
│   │   │   └── views.ts        # View 函数
│   │   └── uploads/            # 上传文件目录
│   └── web/                    # Vite React 前端
│       └── src/
│           ├── components/     # 通用组件
│           ├── lib/            # 工具库
│           ├── routes/         # 路由组件
│           ├── styles/         # CSS 模块
│           ├── App.tsx         # 根组件（约 4000 行）
│           ├── constants.ts
│           ├── types.ts
│           └── main.tsx
├── packages/
│   ├── db/                     # Prisma + SQLite
│   │   ├── prisma/
│   │   │   ├── migrations/
│   │   │   └── schema.prisma
│   │   └── src/
│   └── shared/                 # 共享 Zod 契约
│       └── src/index.ts
├── config/
│   └── llm.example.yaml        # LLM 配置示例
├── docs/                       # 产品规格文档
├── scripts/
│   └── run-local.ps1           # Windows 本地启动脚本
└── package.json
```

### 3.2 包依赖关系

```
@trycue/web ──→ @trycue/shared
@trycue/api ──→ @trycue/shared
@trycue/api ──→ @trycue/db
@trycue/db   ──→ @prisma/client
@trycue/shared ──→ zod
```

- `packages/shared` 是最底层，不依赖其他业务包。
- `packages/db` 重新导出 `@prisma/client` 的所有类型。
- `apps/api` 和 `apps/web` 都依赖 `packages/shared`；只有 `apps/api` 依赖 `packages/db`。
- 前端**不直接依赖 Prisma 类型**，所有跨边界 DTO 通过 `@trycue/shared` 流转。

### 3.3 workspace 配置

[pnpm-workspace.yaml](pnpm-workspace.yaml):
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

[tsconfig.base.json](tsconfig.base.json) 关键配置：
- `target: ES2022`，`module: NodeNext`，`moduleResolution: NodeNext`
- `strict: true`，`noUncheckedIndexedAccess: true`
- `forceConsistentCasingInFileNames`、`esModuleInterop`、`resolveJsonModule`、`skipLibCheck` 启用

---

## 4. packages/shared — 共享契约层

**入口**：[packages/shared/src/index.ts](packages/shared/src/index.ts)
**包名**：`@trycue/shared`
**依赖**：`zod@^4.1.13`

### 4.1 职责

- 定义所有跨 API 边界的 Zod schema 和 TS 类型（通过 `z.infer` 推导）。
- 定义 SSE 事件类型与 payload 结构。
- 定义 API 响应封装与工具函数。
- **不依赖 Prisma**，避免将 Prisma row type 暴露为 API DTO。

### 4.2 导出内容分组

#### 4.2.1 状态枚举 Schema（11 个）

| Schema | TS 类型 | 取值 |
|---|---|---|
| `RunStatusSchema` | `RunStatus` | draft, planning_audience, generating_audience, audience_ready, running, pausing, paused, report_generating, completed |
| `RunParticipantStatusSchema` | `RunParticipantStatus` | ready, queued, thinking, tool_running, waiting_next, finished, skipped, failed |
| `AudienceIdentityStatusSchema` | `AudienceIdentityStatus` | profile_only, identity_queued, identity_generating, identity_ready, identity_failed |
| `AudienceGenerationJobStatusSchema` | `AudienceGenerationJobStatus` | queued, planning, generating, completed, failed, canceled |
| `AudienceGenerationJobScopeSchema` | `AudienceGenerationJobScope` | sampling_plan, profile_expansion, identities, single_identity |
| `AudienceSamplingPlanStatusSchema` | `AudienceSamplingPlanStatus` | draft, planning, ready_for_review, confirmed, expanding_profiles, generating_identities, ready, ready_with_failures, failed, canceled |
| `AudienceSamplingDirectiveExpansionStatusSchema` | `AudienceSamplingDirectiveExpansionStatus` | pending, generating, ready, failed |
| `JourneyStatusSchema` | `JourneyStatus` | active, finished, failed |
| `AgentTurnStatusSchema` | `AgentTurnStatus` | created, context_recorded, model_calling, model_returned, tools_executing, completed, failed, recovered |
| `AgentToolCallStatusSchema` | `AgentToolCallStatus` | pending, committed, ignored, failed |
| `ToolCategorySchema` | `ToolCategory` | navigation, interaction |

#### 4.2.2 工具相关

- `ToolNameSchema` / `ToolName`：8 个工具枚举（`open_post`, `view_comments`, `like_post`, `favorite_post`, `share_post`, `write_comment`, `like_comment`, `exit_browsing`）
- `ToolCallInputSchema`：discriminatedUnion on `toolName`
- 各工具入参 schema：`ViewCommentsArgsSchema`、`PostIdArgsSchema`、`WriteCommentArgsSchema`、`LikeCommentArgsSchema`
- `MAX_COMMENT_LENGTH = 200`

#### 4.2.3 Run 创建/控制

- `CreateRunRequestSchema`：`{ title (2..80), coverImageUrl, imageUrls? (1..9), bodyText (20..8000), scale, audienceCount? }`，superRefine 校验 custom scale 与 audienceCount 互斥
- `ScaleSchema`：`quick | standard | custom`
- `StartRunRequestSchema`：`{ force?, allowPartialAudience? }`
- `RetryRunRequestSchema`：`{ participantId, strategy? }`
- `RetryStrategySchema`：`continue_retry | clean_retry`
- `RecommendationSchema`：`recommend_publish | modify_then_publish | not_recommend_current_version | recommend_retest | backup_version`

#### 4.2.4 观众采样计划

- `CreateAudienceSamplingPlanRequestSchema`、`UpdateAudienceSamplingPlanRequestSchema`
- `CreateAudienceSamplingDirectiveRequestSchema`、`UpdateAudienceSamplingDirectiveRequestSchema`
- `AudienceSamplingPlanRevisionOperationSchema`：discriminatedUnion（add/update/delete directive）
- `AudienceSamplingPlanRevisionProposalSchema`：含 operations (max 20)、summary、warnings
- `AudienceSamplingPlanRevisionMessageSchema`：含 role、visibleText、hiddenMentionContexts、proposal?
- `AudienceSamplingPlanViewSchema` / `AudienceSamplingPlanValidationSchema`

#### 4.2.5 NDJSON Frame 协议（流式生成）

**Plan Frame（8 种）**：
- `plan_markdown_delta` — plan 文本增量
- `dimension_upsert` — 维度更新
- `directive_started` / `directive_patch` / `directive_completed` — directive 流式
- `plan_completed` — plan 完成
- `parser_error` / `validation_issue` — 错误

**Profile Expansion Frame**：
- `profile_completed` — 单个 profile 完成
- `parser_error` / `validation_issue`

#### 4.2.6 观众席修订协议

`AudienceSeatRevisionOperationSchema`：6 种操作（update_identity / regenerate_identity / delete_profile / favorite_identity / retry_identity / add_profile）

#### 4.2.7 观众人设

- `AudiencePersonaJsonSchema`：`{ profile, personality, mbtiType, responseStyle }`
- `MBTI_TYPES`：16 种 MBTI 类型常量数组
- `AudienceDemographicsSchema`：`{ gender, ageRange, cityTier, lifeStage, role, spendingPower }`

#### 4.2.8 LLM 配置

- `LlmRuntimeModeSchema`：`mock | real`
- `LlmSettingsRequestSchema`（strict 模式）：`{ provider, runtimeMode, apiKey?, clearApiKey?, baseUrl?, models: { fast?, pro? } }`
- `ListModelsRequestSchema`：`{ apiKey?, baseUrl? }`

#### 4.2.9 纯 TS View 类型（非 Zod 推导）

- `RunOverview`、`RunHistoryItem`、`RunClockSnapshot`
- `PostStateView`、`CommentItem`、`CommentUpdatePatch`
- `ActionLogItem`、`RuntimeLogItem`、`InsightItem`
- `LiveSummary`、`AudienceSeatsSummary`
- `AudienceSeat`（12 种 `AudienceSeatStatus`）、`AudienceDetail`
- `AudienceProfileView`、`AudienceGenerationProgressView`、`AudienceGenerationJobView`
- `ReportView`、`LlmSettingsView`（不回显 apiKey）、`ModelListItem`

#### 4.2.10 SSE 事件类型

`LiveEventType` 联合类型（36 种事件），按领域分组：

| 领域 | 事件类型 |
|---|---|
| 帖子状态 | `post_state.updated` |
| 评论 | `comments.page_loaded`, `comment.created`, `comment.updated` |
| 日志/汇总/洞察 | `action_log.created`, `summary.updated`, `insight.created` |
| 观众运行时 | `audience.status_updated`, `audience.action_happened` |
| 观众生成 Job | `audience.generation.job.started/completed/failed/canceled` |
| 观众计划 | `audience.plan.started/reasoning.delta/progress/frame/ready/updated/confirmed/failed` |
| 画像扩展 | `audience.profile.expansion.started/ready/directive_started/directive_ready/directive_failed`、`audience.profile.created` |
| 观众身份 | `audience.identity.started/ready/failed`、`audience.updated` |
| Run 生命周期 | `run.clock.updated`, `run.started/pausing/paused/resumed/completed`, `run_log.created` |

#### 4.2.11 API 响应封装

```typescript
type ApiSuccess<T> = { success: true; data: T };
type ApiFailure = { success: false; error: { code: string; message: string; details?: unknown } };
type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

function ok<T>(data: T): ApiSuccess<T>;
function fail(code: string, message: string, details?: unknown): ApiFailure;
function categoryForTool(toolName: ToolName): ToolCategory;
```

#### 4.2.12 共享常量

- `CUSTOM_AUDIENCE_MIN = 1`、`CUSTOM_AUDIENCE_MAX = 10000`、`CUSTOM_AUDIENCE_TOKEN_WARNING_THRESHOLD = 100`
- `MAX_COMMENT_LENGTH = 200`
- `MBTI_TYPES`：16 种 MBTI 类型
- `DEFAULT_PLATFORM_NAME = "小红书"`

---

## 5. packages/db — 数据库层

**入口**：[packages/db/src/index.ts](packages/db/src/index.ts)
**包名**：`@trycue/db`
**Schema**：[packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma)

### 5.1 职责

- 定义 Prisma schema（24 个 model、22 个枚举）。
- 提供 Prisma Client 单例（防 hot-reload 重复创建）。
- 应用 migration（基于 better-sqlite3 直接执行 SQL，不依赖 Prisma migrate engine）。
- 提供 demo seed（仅生成占位图片，不写数据库）。

### 5.2 关键文件

#### 5.2.1 [src/index.ts](packages/db/src/index.ts)

- `import "./env.js"` 加载环境变量
- 使用 `globalThis` 缓存 prisma 实例
- 生产环境订阅 error/warn，开发环境额外订阅 query（慢查询 >200ms 告警）
- `setPrismaLogger(logger)` 注入 pino logger
- `export * from "@prisma/client"` 重新导出所有 Prisma 类型

#### 5.2.2 [src/env.ts](packages/db/src/env.ts)

- `findWorkspaceRoot()`：向上查找 `pnpm-workspace.yaml`
- 加载顺序：`.env.local` → `.env`（不覆盖已存在的环境变量）

#### 5.2.3 [src/applyMigrations.ts](packages/db/src/applyMigrations.ts)

- 使用 `better-sqlite3` 直接执行 SQL
- 自动创建父目录、设置 `journal_mode = WAL`、`foreign_keys = ON`
- 创建 `_prisma_migrations` 跟踪表
- **破坏性 baseline 重置**：仅在开发环境 + DATABASE_URL 含 "trycue" + 检测到 corrupt baseline 时触发
- 每个 migration 在事务中执行，checksum = SHA256 over raw bytes

#### 5.2.4 [src/seedDemo.ts](packages/db/src/seedDemo.ts)

- 仅生成 3 个 1x1 透明 PNG 占位图到 `assets/demo/`
- 不写入数据库记录

### 5.3 数据库表关系图

```
test_runs (Run 容器，聚合根)
  ├─ 1:1  content_versions (内容事实边界)
  │         ├─ 1:N  content_version_images
  │         ├─ 1:1  simulated_post_states
  │         ├─ 1:N  social_interaction_events
  │         ├─ 1:N  social_reactions
  │         ├─ 1:N  loaded_comment_pages
  │         ├─ 1:N  simulated_comments
  │         ├─ 1:N  insights
  │         └─ 1:N  reports
  ├─ 0:1  audience_sampling_plans
  │         ├─ 1:N  audience_sampling_directives
  │         └─ 1:N  audience_profiles
  ├─ 1:N  audience_profiles
  ├─ 1:N  audience_generation_jobs
  ├─ 1:N  run_participants (试映开始时创建的快照)
  │         └─ 1:N  agent_journeys
  ├─ 1:N  agent_journeys
  │         ├─ 1:N  agent_transcript_items (append-only)
  │         ├─ 1:N  agent_turns
  │         │         ├─ 0:1  agent_turn_contexts
  │         │         └─ 1:N  agent_tool_calls
  │         └─ 1:N  agent_tool_calls
  ├─ 1:N  live_events (SSE 事件持久化)
  ├─ 1:N  action_logs
  ├─ 1:N  run_logs
  ├─ 1:N  llm_call_traces
  ├─ 0:1  run_llm_usage_summaries
  └─ 0:1  reports

users (统一行为主体)
  ├─ 0:1  agents
  ├─ 1:N  platform_accounts
  └─ 1:N  run_participants

agents
  ├─ N:1  users
  ├─ N:0:1  test_runs (originRunId)
  └─ N:0:1  audience_profiles (sourceProfileId)

assets (独立资产存储)
  └─ 1:N  content_version_images
```

### 5.4 核心表说明

#### 5.4.1 Run 容器层

| 表 | 说明 |
|---|---|
| `test_runs` | 试映运行容器，含 status、clock 字段、audienceRevision |
| `content_versions` | 内容版本（V1 强制 1 run = 1 contentVersion） |
| `assets` | 资产存储（local/external） |
| `content_version_images` | 内容图片，按 sortOrder 排序 |

#### 5.4.2 统一行为主体

| 表 | 说明 |
|---|---|
| `users` | 统一用户（human/agent/system） |
| `agents` | Agent 实体，含 personaJson、retentionPolicy |
| `platform_accounts` | 平台账号（同一 user 同一 platform 唯一） |

**关键设计**：前端用户和 Agent 共用同一套 interaction service，通过 `ActorContext.source` 区分（`human_ui` vs `agent_tool`）。

#### 5.4.3 RunParticipant 快照

`run_participants` 在试映开始时创建，持有：
- `displayNameSnapshot`、`avatarUrlSnapshot`
- `profileSnapshotJson`、`agentSnapshotJson`、`platformAccountSnapshotJson`
- `runtimeStatus`（RunParticipantStatus）

与源数据解耦，保证 run 期间观众画像变更不影响进行中的试映。

#### 5.4.4 观众生成生命周期

```
AudienceSamplingPlan (1:1 with run)
  └─ 1:N AudienceSamplingDirective
        └─ 1:N AudienceProfile
              └─ 1:0:1 (User + Agent + PlatformAccount)

AudienceGenerationJob (锁机制)
  - lockedBy / lockedUntil / heartbeatAt / active
  - idx_audience_generation_jobs_recovery 索引用于崩溃恢复
```

**两阶段生成**：
1. Plan 阶段：生成 plan + directives，用户审核
2. Confirm 后：展开 AudienceProfile（profile_only → identity_ready）

#### 5.4.5 Agent 运行时

| 表 | 说明 |
|---|---|
| `agent_journeys` | 单个观众的完整旅程，含锁字段（lockedBy/lockedAt/heartbeatAt） |
| `agent_transcript_items` | append-only transcript（恢复事实源） |
| `agent_turns` | 单个 Agent 回合，含 thoughtText、rawResponseJson |
| `agent_turn_contexts` | Turn 上下文快照（messages、available_tools） |
| `agent_tool_calls` | 工具调用，含 idempotencyKey（全局唯一） |

**锁机制**：
- Journey 级锁：`runnerStatus: queued → running`，原子 UPDATE...RETURNING 抢占
- Turn 级锁：`status` 状态机推进
- 心跳：`runnerHeartbeatIntervalSeconds`（默认 5 秒）

#### 5.4.6 模拟社交层

| 表 | 说明 |
|---|---|
| `simulated_post_states` | 帖子计数（exposure/open/like/favorite/comment/share/exit） |
| `social_interaction_events` | 社交互动事件流（含唯一约束防重复） |
| `social_reactions` | 点赞/收藏（幂等 toggle，唯一约束） |
| `loaded_comment_pages` | 已加载评论分页（agent_tool 来源写） |
| `simulated_comments` | 模拟评论（含 parentCommentId/rootCommentId） |

#### 5.4.7 日志与可观测性

| 表 | 说明 |
|---|---|
| `action_logs` | 行动日志（含 thoughtText、emotion、riskTags） |
| `run_logs` | 运行日志（logType 分类） |
| `live_events` | SSE 事件持久化（BigInt 自增 sequence 主键） |
| `llm_call_traces` | LLM 调用追踪（token 用量明细） |
| `run_llm_usage_summaries` | Run 级 LLM 用量汇总（1:1 with run） |

#### 5.4.8 洞察与报告

| 表 | 说明 |
|---|---|
| `insights` | 洞察（含 level、evidence、relatedParticipantIds） |
| `reports` | 报告（1:1 with run，含 recommendation、dimensions、risks 等） |

### 5.5 Migration 历史

| Migration | 作用 |
|---|---|
| `0001_baseline` | 创建全部初始表 + 索引 + 约束 |
| `0002_llm_call_traces` | 新增 `llm_call_traces` 和 `run_llm_usage_summaries` 表 |
| `0003_drop_run_scheduler_snapshot_columns` | 从 `test_runs` 删除 `concurrency` 和 `admission_window` 列 |

`migration_lock.toml` 锁定单一 provider（sqlite）。

### 5.6 关键枚举（22 个）

完整列表见 [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma)。关键枚举：

- `RunStatus`：9 种状态
- `AgentToolCallStatus`：`pending | committed | ignored | failed`（单向状态机）
- `JourneyExitOutcome`：`skipped | browsed_and_left | risk_exit | max_steps`
- `IdentityRetentionPolicy`：`delete_with_origin_run | retain`
- `AgentTranscriptItemType`：`initial_observation | assistant_message | assistant_tool_calls | tool_result | system_notice`

---

## 6. apps/api — 后端服务

**入口**：[apps/api/src/index.ts](apps/api/src/index.ts)
**包名**：`@trycue/api`

### 6.1 启动流程

[index.ts](apps/api/src/index.ts)（10 行）：
1. `import "./env.js"` — 加载 `.env.local` / `.env`
2. `loadConfig()` — 从环境变量读取配置
3. `buildApp(config)` — 构建 Fastify 实例
4. `app.listen({ port: config.port, host: "0.0.0.0" })` — 默认端口 4000

[app.ts](apps/api/src/app.ts) `buildApp(config)` 流程：
1. 创建 Fastify 实例（pino logger）
2. `initLogger(app.log)` — 注入集中式 logger
3. `setPrismaLogger({ warn, error })` — Prisma 日志桥接
4. `LlmConfigStore` 加载 YAML 配置（real 模式 fail-fast 校验）
5. 实例化 `AiTaskRunner`（注入 `getLlmConfig` 和 onRecord 回调）
6. `getAgentProvider = () => withAiTaskRunner(createAgentProvider(getLlmConfig()), aiTaskRunner)`
7. 实例化 `Scheduler` 和 `RunService`
8. 注册插件：`@fastify/cors`、`@fastify/multipart`、`@fastify/static`
9. 注册路由
10. 启动恢复：`recoverReportGenerationRuns` + `runService.recoverAudienceGenerationJobs`
11. `app.decorate("scheduler", scheduler)`

### 6.2 配置加载

[config.ts](apps/api/src/config.ts) 导出 `AppConfig` 类型（24 个字段）和 `loadConfig()` 函数。

关键默认值：
- `port = 4000`
- `schedulerDefaultConcurrency = 2`
- `runClockScale = 10`（模拟时间倍率）
- LLM 容量由 `config/llm.local.yaml` 的 `capacity` 字段管理（RPM + 并发双限流、AIMD 自动调整，见 `docs/03_Agent运行时设计.md` 9.3 节）
- `defaultQuickAudienceCount = 12`
- `defaultStandardAudienceCount = 30`
- `maxJourneyActionsPerJourney = 10`
- `modelCallTimeoutSeconds = 120`
- `agentJourneyTimeoutSeconds = 300`
- `runnerHeartbeatIntervalSeconds = 5`
- `sseHeartbeatIntervalSeconds = 15`

### 6.3 路由层

[app.ts](apps/api/src/app.ts) 注册的全部路由：

#### 通用
- `GET /health` — 健康检查
- `POST /api/upload` — 上传图片（jpg/png/webp，5MB 上限）

#### LLM 设置
- `GET /api/settings/llm` — 读取配置（脱敏 apiKey）
- `PUT /api/settings/llm` — 保存配置
- `POST /api/settings/llm/models` — 拉取 OpenAI 兼容模型列表

#### Run 管理
- `POST /api/runs` — 创建试映
- `GET /api/runs` — 历史列表（cursor 分页）
- `GET /api/runs/:runId` — run 总览
- `DELETE /api/runs/:runId` — 删除试映
- `POST /api/runs/:runId/reset-runtime` — 重置运行时
- `POST /api/runs/:runId/retry` — 重试参与者

#### Run 控制
- `POST /api/runs/:runId/start` — 启动试映
- `POST /api/runs/:runId/pause` — 暂停
- `POST /api/runs/:runId/resume` — 恢复

#### SSE
- `GET /api/runs/:runId/events` — SSE 长连接（支持 Last-Event-ID / `?after=` 续传）

#### 帖子状态与互动（前端用户）
- `GET /api/runs/:runId/post-state`
- `POST /api/runs/:runId/post/open`
- `POST /api/runs/:runId/post/like`
- `POST /api/runs/:runId/post/favorite`
- `POST /api/runs/:runId/post/share`

#### 评论
- `GET /api/runs/:runId/comments` — 分页（sort=latest/hot/time）
- `POST /api/runs/:runId/comments` — 发表评论/回复
- `POST /api/runs/:runId/comments/:commentId/replies`
- `POST /api/runs/:runId/comments/:commentId/like`

#### 日志与洞察
- `GET /api/runs/:runId/logs` — 行动日志（旧接口）
- `GET /api/runs/:runId/run-logs` — 统一日志接口
- `GET /api/runs/:runId/insights`

#### 报告
- `GET /api/runs/:runId/report` — 获取报告
- `POST /api/runs/:runId/report` — 生成报告（仅 paused 状态）

#### 观众席与详情
- `GET /api/runs/:runId/audience-seats` — 观众席矩阵
- `GET /api/runs/:runId/participants` — 参与者列表
- `GET /api/runs/:runId/participants/:participantId` — 参与者详情

#### 观众采样计划
- `POST /api/runs/:runId/audience-sampling-plan` — 创建/重新生成
- `GET /api/runs/:runId/audience-sampling-plan` — 读取
- `PATCH /api/runs/:runId/audience-sampling-plan` — 更新
- `POST /api/runs/:runId/audience-sampling-plan/revision-suggestions` — AI 修订建议
- `POST /api/runs/:runId/audience-sampling-plan/confirm` — 确认
- `POST /api/runs/:runId/audience-sampling-plan/clear-audience` — 清空观众

#### Directive 管理
- `POST /api/runs/:runId/audience-sampling-plan/directives`
- `PATCH /api/runs/:runId/audience-sampling-plan/directives/:directiveId`
- `DELETE /api/runs/:runId/audience-sampling-plan/directives/:directiveId`
- `POST /api/runs/:runId/audience-sampling-plan/directives/:directiveId/retry-expansion`

#### 观众生成与画像
- `GET /api/runs/:runId/audience-generation` — 生成进度
- `POST /api/runs/:runId/audience-generation/retry-identities` — 批量重试
- `POST /api/runs/:runId/audience-profiles` — 手动新增
- `POST /api/runs/:runId/audience-profiles/revision-suggestions` — 席位修订建议
- `PATCH /api/runs/:runId/audience-profiles/:profileId/identity` — 编辑身份
- `POST /api/runs/:runId/audience-profiles/:profileId/identity/regenerate` — 重生身份
- `POST /api/runs/:runId/audience-profiles/:profileId/identity/favorite` — 收藏
- `DELETE /api/runs/:runId/audience-profiles/:profileId` — 删除

### 6.4 错误码

| code | HTTP | 说明 |
|---|---|---|
| `VALIDATION_ERROR` | 400 | 参数错误 |
| `RUN_NOT_FOUND` | 404 | run 不存在 |
| `INVALID_RUN_STATUS` | 409 | run 状态不允许当前操作 |
| `INVALID_RETRY_TARGET` | 409 | participantId 无效 |
| `AUDIENCE_IDENTITY_INCOMPLETE` | 409 | 画像未生成人设 |
| `AUDIENCE_GENERATION_ACTIVE` | 409 | 观众生成任务仍在执行 |
| `PAUSE_FAILED` | 409 | 暂停失败 |
| `REPORT_NOT_READY` | 409 | 报告未生成 |
| `SCHEDULER_BUSY` | 409 | 调度器正在运行 |
| `CONFIG_ERROR` | 500 | real AI 配置错误 |
| `MODEL_LIST_FAILED` | 502 | 模型列表获取失败 |
| `AGENT_RUN_FAILED` | 500 | Agent 调用失败 |
| `TOOL_COMMIT_FAILED` | 500 | 工具提交失败 |
| `INTERNAL_ERROR` | 500 | 未知错误 |

### 6.5 Runtime Service 层

#### 6.5.1 [scheduler.ts](apps/api/src/runtime/scheduler.ts) — 核心调度器

**类 `Scheduler`**：内存中管理活跃 run 和 journey runner。

**私有状态**：
- `activeRuns: Set<string>` — 正在跑 runLoop 的 runId
- `activeJourneyRunners: Map<runId, Set<journeyId>>` — 每 run 当前在跑的 journey
- `lastHeartbeatAt: Map<journeyId, number>`

**关键方法**：
- `start(runId)` — 启动 run loop（去重，crash 时自动回退 run 到 paused）
- `drain(runId)` — 同步驱动 runLoop（测试用）
- `recoverAndResume()` — 启动时恢复：先 `failInterruptedJourneyRunners`，再对所有 `running`/`pausing` 状态的 run 调 `start`
- `runLoop(runId)` — 核心循环（每 50ms 一轮）：
  1. 检查 `controlState === "pause_requested"` 或 `status === "pausing"`
  2. 检查 `paused`/非 `running`：退出
  3. `syncAdmission` — 按并发缺口调 `admitWaitingAudiences`
  4. `claimRunnableJourneys` — 原子 SQL `UPDATE...RETURNING` 抢占 journey
  5. 对每个 journey 启动 `startAgentRunner`
  6. 全部结束且无 ready 观众 → 推进到 `report_generating` + `generateReportAndCompleteRun`
- `runAgentJourney(journeyId)` — 循环：心跳 → 检查状态 → 检查步数上限 → `createOrLoadRunningTurn` → `recordOrLoadTurnContext` → `getAgentProvider().runAudienceTurn(...)` → `emitRunSummary`

**调度策略**：
- 固定并发上限 `schedulerDefaultConcurrency`（默认 2）
- SQLite `UPDATE...RETURNING` 原子抢占避免 TOCTOU
- 按 `queue_seq ASC, created_at ASC` 顺序调度

#### 6.5.2 [runService.ts](apps/api/src/runtime/runService.ts) — Run 生命周期编排（约 2100 行）

**类 `RunService`**：编排 run 创建、观众生成、run 控制、报告触发。

**关键公开方法**（按职责分组）：
- **Run 生命周期**：`createRun`、`listRuns`、`resetRuntime`、`deleteRun`、`startRun`、`pauseRun`、`resumeRun`、`retryRun`、`getRunLogs`
- **观众采样计划**：`createAudienceSamplingPlan`、`getAudienceSamplingPlan`、`updateAudienceSamplingPlan`、`suggestAudienceSamplingPlanRevision`、`confirmAudienceSamplingPlan`、`clearGeneratedAudience`
- **采样指令**：`createAudienceSamplingDirective`、`updateAudienceSamplingDirective`、`deleteAudienceSamplingDirective`、`retryAudienceDirectiveExpansion`
- **观众生成**：`getAudienceGeneration`、`retryAudienceIdentities`、`cancelAudienceGenerationJob`、`recoverAudienceGenerationJobs`
- **画像管理**：`createAudienceProfile`、`updateAudienceIdentity`、`regenerateAudienceIdentity`、`favoriteAudienceIdentity`、`deleteAudienceProfile`、`listAudiences`、`suggestAudienceSeatRevision`

**锁与恢复**：
- `AUDIENCE_JOB_LOCK_DURATION_MS = 10 * 60 * 1000`（10 分钟锁过期）
- `runAudienceGenerationJob(jobId)` 用 `updateMany` + 锁条件原子抢占
- `recoverAudienceGenerationJobs` 启动时扫描锁过期或未持锁的活跃 job

#### 6.5.3 [agentSessions.ts](apps/api/src/runtime/agentSessions.ts) — Agent 会话与 transcript

**常量**：`ALL_TOOLS: ToolName[]` — V1 允许的 8 个工具

**关键函数**：
- `appendInitialObservation` / `appendAssistantMessageItem` / `appendAssistantToolCallsItem` / `appendToolResultItem` / `appendSystemNoticeItem` — 向 transcript 追加条目（用 `lastTranscriptSeq` 原子自增保证 seq 唯一）
- `loadJourneyTranscript(tx, journeyId)` — 按 seq 升序读取
- `renderSessionMessages(items, options?)` — 把 transcript 还原成 AI SDK `ModelMessage[]`，处理多模态图片
- `buildFeedObservation(contentVersion, postState)` — 构造 feed 阶段初始 observation
- `buildPostObservation(contentVersion, postState, viewerState)` — 构造 post 详情阶段 observation

**设计要点**：图片只在初始 observation 注入一次，避免通过 tool result 传 base64。

#### 6.5.4 [interactions.ts](apps/api/src/runtime/interactions.ts) — 统一互动服务（583 行）

**类型 `ActorContext`**：
```typescript
{
  actorUserId: string;
  platformAccountId: string;
  participantId?: string;
  agentId?: string;
  source: "agent_tool" | "human_ui" | "system_seed" | "replay";
}
```

**关键函数**（全部接收 `Prisma.TransactionClient`）：
- `ensurePostState(tx, runId, contentVersionId)` — upsert SimulatedPostState
- `recordInteractionEvent(tx, params)` — 写 SocialInteractionEvent
- `openPost` — `openCount += 1` + 事件
- `viewComments` — 调 `listCommentPage`，agent_tool 来源额外写 `LoadedCommentPage`
- `setPostReaction` — upsert SocialReaction（like/favorite），按 delta 增减计数
- `sharePost` — 查重 + `shareCount += 1` + 事件
- `createComment` — 写 SimulatedComment，维护父子关系，更新计数
- `likeComment` — upsert SocialReaction（targetType=comment）
- `exitBrowsing` — `exitCount += 1`，journey → finished

**关键设计**：前端用户和 Agent 复用同一套服务，通过 `source` 区分。

#### 6.5.5 [comments.ts](apps/api/src/runtime/comments.ts) — 评论分页

- `listCommentPage(db, { contentVersionId, limit, cursor, sort })` — 游标分页（`take: limit + 1` 判断 hasMore）
- `CommentSort = "latest" | "hot" | "time"`
- 游标编码：`Buffer.from(JSON.stringify(...)).toString("base64url")`

#### 6.5.6 [clock.ts](apps/api/src/runtime/clock.ts) — 模拟时钟

- `getSimulatedElapsedMs(run, now)` — `clockElapsedMs + (now - clockAnchorAt) * clockScale`
- `getSimulatedTime(run, now)` — `Math.floor(getSimulatedElapsedMs / 1000)`
- `freezeRunClockData(run, now)` — 返回冻结数据
- `runClockSnapshot(run, now)` — 构造 `RunClockSnapshot` DTO
- `recordRunClockUpdatedEvent(tx, { runId, reason, status, run, now? })` — 写 `run.clock.updated` 事件

#### 6.5.7 [queue.ts](apps/api/src/runtime/queue.ts) — 观众入场排队

- `getNextQueueSeq(tx, runId)` — `aggregate _max queueSeq + 1`
- `admitWaitingAudiences(tx, { runId, contentVersionId, limit })` — 从 `runtimeStatus="ready"` 的 participant 中按顺序取 `limit` 个，为每个创建 `AgentJourney`

#### 6.5.8 [identity.ts](apps/api/src/runtime/identity.ts) — 身份管理

- `createAgentIdentity(tx, { displayName, avatarUrl?, personaJson?, originRunId?, sourceProfileId? })` — 创建 User + Agent + PlatformAccount
- `actorFromParticipant(participant)` — 从 RunParticipant 构造 ActorContext
- `getDefaultHumanActor(tx)` / `findDefaultHumanActor(tx)` — 获取/创建前端用户身份

#### 6.5.9 [report.ts](apps/api/src/runtime/report.ts) — 报告生成（470 行）

- `generateReportAndCompleteRun(runId, model, useReal, apiKey, baseUrl, options?)`：
  1. 状态校验（running / report_generating / paused + allowPaused）
  2. 推进到 `report_generating` + 冻结时钟
  3. 收集证据（journeys、comments、logs、toolCalls）
  4. 推导 phase（以 `open_post` 为 feed→post 转换点）
  5. `buildEvidenceIndex` — 结构化证据索引
  6. 真实模式：调 `generateReportWithLLM`；mock 模式：`buildFallbackReport`
  7. 事务里 upsert Report + 推进 run 到 completed + 推送 `run.completed`
- `recoverReportGenerationRuns(...)` — 启动时恢复
- `pauseRunForReportFailure` — CAS 式把 run 推到 paused

#### 6.5.10 [runDataLifecycle.ts](apps/api/src/runtime/runDataLifecycle.ts) — 数据生命周期

`runDataLifecyclePolicies` 分四组：
- `content_setup`：TestRun、ContentVersion、ContentVersionImage
- `audience_preparation`：Plan、Directive、Profile、Job
- `runtime_facts`：RunParticipant、Journey、Turn、ToolCall、LiveEvent、PostState、SocialEvent、Reaction、CommentPage、Comment、ActionLog、RunLog、LlmCallTrace、LlmUsageSummary、Insight、Report
- `reusable_identity_asset`：Asset、User、Agent、PlatformAccount（`deleteRun: "reference_check"`）

- `cleanupParticipantRuntimeFacts(tx, runId, participantId)` — 删除单个 participant 的运行时事实
- `cleanupRuntimeFacts(tx, runId)` — 删除整个 run 的运行时事实

#### 6.5.11 其他 runtime 文件

- [runLogs.ts](apps/api/src/runtime/runLogs.ts) — `createRunLogWithEvent` 写 RunLog + 推送事件
- [contentVersions.ts](apps/api/src/runtime/contentVersions.ts) — `requireSingleContentVersion` 强制 1:1
- [modelImages.ts](apps/api/src/runtime/modelImages.ts) — `prepareModelImageUrls` 把本地 `/uploads/` URL 读成 `data:` URL

### 6.6 Agent Provider 层

#### 6.6.1 [index.ts](apps/api/src/agents/index.ts) — 工厂

```typescript
createAgentProvider(config, options?) =>
  shouldUseRealLlm(config) ? new RealAgentProvider(config, options) : new MockAgentProvider();
```

#### 6.6.2 [types.ts](apps/api/src/agents/types.ts) — 类型定义

**接口 `AgentProvider`**（6 个方法）：
- `generateAudienceSamplingPlan(input)` — 流式生成采样计划
- `generateAudienceSamplingPlanRevision(input)`
- `generateAudienceSeatRevision(input)`
- `expandAudienceProfiles(input)` — 流式展开画像
- `generateAudiencePersona(input)`
- `runAudienceTurn(context)` — 单个 Agent 回合

**关键类型**：
- `AudiencePersona`：`{ profile, personality, mbtiType, responseStyle }`
- `ParsedToolCall`：`{ toolName, args, sdkCallId?, callIndex?, idempotencyKey?, rawToolCall? }`
- `RunParticipantContext`：传给 `runAudienceTurn` 的完整上下文
- `RunParticipantResult`：`{ thoughtText, reasoningText?, toolCalls, managedRuntime?, rawOutput, model, promptVersion, ... }`

#### 6.6.3 [mockAgent.ts](apps/api/src/agents/mockAgent.ts) — Mock Provider（约 1100 行）

**类 `MockAgentProvider`**：内置 30 个姓名 + 多个 segment 模板（核心用户/相邻用户/挑剔用户/路人用户）。

- `generateAudienceSamplingPlan` — 基于模板按 count 分配 directive
- `expandAudienceProfiles` — 按 directive.quantity 循环创建 profile
- `generateAudiencePersona` — 从模板池选 persona
- `runAudienceTurn(context)` — 调 `planMockTools` 生成工具调用，走真实状态机提交（`managedRuntime=true`）

**关键设计**：Mock 也走 AI SDK 状态机，保证与 real 行为一致。

#### 6.6.4 [realAgent.ts](apps/api/src/agents/realAgent.ts) — Real Provider（约 1130 行）

**类 `RealAgentProvider`**：
- 构造器：`validateRealLlmConfig` fail-fast，创建 `createOpenAICompatible` provider（`includeUsage: true`，共享 `getSharedRateLimitedFetch()`，底层由 `LlmCapacityManager` 提供 RPM + 并发双限流）
- `generateAudienceSamplingPlan` — `streamText` + NDJSON frame protocol，用 `NdjsonLineBuffer` + `PlanFrameAccumulator` 累积
- `runAudienceTurn(context)` — `streamText` + `createAiSdkToolSet`（AI SDK 原生 tool calling），通过 `onStepFinish` 钩子调 `persistStep`

**温度策略**：
- `TEMPERATURE_CREATIVE = 0.9`（plan）
- `TEMPERATURE_BALANCED = 0.8`
- `TEMPERATURE_PRECISE = 0.45`

**重试**：`maxRetries` 统一从 `getSharedCapacityManager().getMaxRetries()` 读取（默认 4，来自 `config/llm.local.yaml` 的 `capacity.retry.maxRetries`）

#### 6.6.5 [reportAgent.ts](apps/api/src/agents/reportAgent.ts) — 报告 LLM 调用

`generateReportWithLLM(input)`：用 `generateText` 调用 pro 模型，system prompt 强约束输出 JSON schema，`temperature=0.4`，`maxRetries` 从 `getSharedCapacityManager().getMaxRetries()` 读取（与 realAgent 共用）。

#### 6.6.6 [taskRunner.ts](apps/api/src/agents/taskRunner.ts) — AI 任务追踪

**类型 `AiTaskType`**：`"audience_plan" | "audience_plan_revision" | "audience_seat_revision" | "audience_profile_expansion" | "audience_persona" | "agent_turn" | "report"`

**`AI_TASK_MODEL_TIER`**：任务→tier 映射
- `audience_plan*` / `seat_revision` / `report` → pro
- 其他 → fast

**类 `AiTaskRunner`**：
- `run<T>({ type, runId?, contentVersionId?, call })` — 包裹 call，记录 `AiTaskRunRecord`（durationMs、ok、error、usage?）
- `withAiTaskRunner(provider, runner)` — 返回新 AgentProvider，每个方法都用 `runner.run` 包装

#### 6.6.7 [promptVersions.ts](apps/api/src/agents/promptVersions.ts) — Prompt 版本常量

```typescript
PROMPT_VERSION_AUDIENCE_PLAN          = "audience_generator_v1"
PROMPT_VERSION_SAMPLING_PLAN_REVISION = "audience_sampling_plan_revision_v1"
PROMPT_VERSION_SEAT_REVISION          = "audience_seat_revision_v1"
PROMPT_VERSION_PROFILE_EXPANSION      = "audience_profile_expansion_v1"
PROMPT_VERSION_AUDIENCE_PERSONA       = "audience_persona_v1"
PROMPT_VERSION_AGENT                  = "audience_agent_ai_sdk_v2"
PROMPT_VERSION_REPORT                 = "report_generator_v1"
```

### 6.7 工具执行器

[tools/toolExecutor.ts](apps/api/src/tools/toolExecutor.ts)（1672 行）

#### V1 全部 8 个工具

| 工具名 | 输入 | 行为 |
|---|---|---|
| `open_post` | `{}` | 点开帖子，feed→post phase 转换 |
| `view_comments` | `{ postId, cursor?, sort? }` | 翻页评论 |
| `like_post` | `{ postId }` | 点赞（已点赞 ignored） |
| `favorite_post` | `{ postId }` | 收藏（已收藏 ignored） |
| `share_post` | `{ postId }` | 分享（幂等） |
| `write_comment` | `{ postId, content, replyToCommentId? }` | 发表评论/回复 |
| `like_comment` | `{ commentId }` | 点赞评论（必须先 view_comments） |
| `exit_browsing` | `{}` | 结束浏览，journey → finished |

#### 状态机校验

- `AgentToolCallStatus`：`pending | committed | ignored | failed`
- `ALLOWED_TOOL_CALL_TRANSITIONS`：只有 `pending` 可转到 `committed`/`ignored`/`failed`，终态不可变
- `assertToolCallTransition(current, target)` — 非法转换抛错

#### 关键导出

- `createAiSdkToolRuntimeContext({ runId, participantId, actionId })` — 维护 identitiesByTurn/identitiesBySdkCallId Map
- `createAiSdkToolSet(ctx)` — 返回 AI SDK ToolSet
- `withToolContext(actionId, call, business)` — 核心事务包装器：
  1. 查 existing toolCall（按 idempotencyKey 或 agentTurnId_callIndex）
  2. 已存在且非 pending：补 tool_result 后直接返回（幂等）
  3. 创建/复用 toolCall（pending 状态）
  4. `normalizeToolArgs`（snake_case → camelCase）
  5. `validateAiSdkToolCall` — phase 校验 + requiresPostId 校验
  6. 失败 → `markToolIgnored`；成功 → 调 `business(txCtx, args)` → `markToolCommitted`
- `persistStep(agentTurnId, step, audit?)` — 把 AI SDK StepResult 持久化
- `completeAiSdkStepAndPrepareNext(agentTurnId, step, maxSteps)` — 完成当前 turn 并准备下一个

#### 校验规则

1. journey 必须 `active`
2. **Phase gate**：未 `open_post` 前，只允许 `open_post` 和 `exit_browsing`
3. `requiresPostId` 工具：必须传 `postId` 且等于 `contentVersionId`
4. `like_post`/`favorite_post`：已存在 active reaction → ignored
5. `write_comment`：content 非空、长度 ≤ 200、replyToCommentId 存在性
6. `like_comment`：必须先通过 `view_comments` 观察过
7. `view_comments`：同一 cursor+sort 已加载过 → ignored

#### 幂等性

- `idempotencyKey = "${runId}:${participantId}:${turnId}:${callIndex}"`
- `assertExistingToolCallMatches` — toolName + 规范化 args + sdkCallId 一致性校验

#### 审计脱敏

`sanitizeAuditJson`：递归把 `apiKey`/`authorization`/`token`/`secret`/`password` 替换为 `"[redacted]"`，把 `data:image/...` base64 替换为 `[redacted ${mime} data url, chars=N]`。

### 6.8 LLM 配置

#### 6.8.1 [llmConfigStore.ts](apps/api/src/llmConfigStore.ts)

**类 `LlmConfigStore`**：
- `load()` — 读 YAML → Zod 校验 → normalizeConfig；real 模式 fail-fast
- `get()` — 返回当前配置
- `view()` — 返回 `LlmSettingsView`（脱敏 `apiKeyMasked`）
- `save(input)` — normalizeConfig + validateLlmSettingsForSave + 原子写（tmp → rename）

**关键函数**：
- `validateRealLlmConfig(config)` — baseUrl/apiKey/models.fast/models.pro 缺一报错
- `shouldUseRealLlm(config)` — `runtimeMode === "real" && isRealLlmConfigured`
- `maskApiKey(key)` — `xxx...xxxx` 格式

#### 6.8.2 [llm/rateLimitedFetch.ts](apps/api/src/llm/rateLimitedFetch.ts) + [llm/llmCapacityManager.ts](apps/api/src/llm/llmCapacityManager.ts)

- `LlmCapacityManager` — RPM + 并发双限流、AIMD 自动调整、429/503 cooldown、热重载
- `initSharedCapacityManager(settings)` — 初始化或更新共享 capacity manager
- `getSharedCapacityManager()` — 获取共享 capacity manager 单例
- `updateSharedCapacityManager(settings)` — 热更新配置（PUT /api/settings/llm 后调用）
- `getSharedRateLimitedFetch()` — 兼容入口，返回 `capacityManager.getFetch()`
- `getSharedCapacityManager().getMaxRetries()` — 统一 maxRetries 来源（默认 4）

容量配置来自 `config/llm.local.yaml` 的 `capacity` 字段，支持 `auto`/`manual` 模式和 `conservative`/`standard`/`high_quota`/`custom` 预设。设计背景与决策见 `docs/03_Agent运行时设计.md` 9.3 节。

#### 6.8.3 [llm/aiSdkTracing.ts](apps/api/src/llm/aiSdkTracing.ts)

- `aiSdkTrace(input)` — 构造 AI SDK `experimental_telemetry` 配置
- `createTraceIntegration(input)` — `onStepFinish` 钩子，事务里写 `LlmCallTrace` + upsert `RunLlmUsageSummary`
- `normalizeUsage(usage)` — 兼容 OpenAI / Anthropic / 通用字段命名

### 6.9 SSE 事件总线

[liveEvents.ts](apps/api/src/liveEvents.ts)（155 行）

**机制**：
- `liveEventBus = new EventEmitter()`（maxListeners=500）— 进程内事件总线
- `onRunLiveEvent(runId, listener)` — 订阅 `run:${runId}` 事件
- `pushLiveEvent(runId, event)` — emit 事件（不落库，仅推送给在线订阅者）
- `recordLiveEvent(tx, input)` — **事务内落库**：
  1. `assertDurableLiveEvent` — 校验 eventType 在白名单内
  2. 创建 LiveEvent 行（payload 含临时 `eventId: "0"`）
  3. 用 `sequence`（BigInt 自增）回填 `payload.eventId`/`type`/`runId`/`createdAt`
  4. 返回 `{ sequence, eventType, payload }`
- `encodeSse(event)` — `id: ${sequence}\nevent: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`
- `listLiveEvents(runId, afterSequence?)` — 按 sequence 升序读历史事件

**SSE 路由**（`GET /api/runs/:runId/events`）：
- 写头 `Content-Type: text/event-stream`、`Cache-Control: no-cache`、`Connection: keep-alive`、`X-Accel-Buffering: no`
- 先 `listLiveEvents` 回放历史
- `onRunLiveEvent` 订阅增量
- 每 `sseHeartbeatIntervalSeconds` 秒发 `event: heartbeat`
- `request.raw.on("close")` 清理

**双通道设计**：
- `recordLiveEvent`（事务内落库）— 重连客户端按 `Last-Event-ID` 回放
- `pushLiveEvent`（内存广播）— 在线客户端实时收

### 6.10 View 层

[views.ts](apps/api/src/views.ts)（378 行）— 所有 view 函数把 Prisma row 转成 `@trycue/shared` DTO：

| 函数 | 返回类型 | 说明 |
|---|---|---|
| `postStateView(state, viewerState?)` | `PostStateView` | 帖子计数 + 可选 likedByMe/favoritedByMe/sharedByMe |
| `commentView(comment, audience?, options?)` | `CommentItem` | 评论 + 观众名/segment |
| `commentUpdatePatch(comment)` | `CommentUpdatePatch` | `{ likeCount, replyCount }` |
| `logView(log, audience?)` | `ActionLogItem` | 行动日志 |
| `insightView(insight)` | `InsightItem` | 洞察 |
| `reportView(report)` | `ReportView` | 完整报告 |
| `buildSummaryView(params)` | `Promise<LiveSummary>` | 实时汇总 |
| `deriveSeatStatus(journey, interactionTypes, hasDoubt)` | `AudienceSeatStatus` | 观众席状态推导（12 种状态） |
| `audienceSeatView(params)` | `AudienceSeat` | 单个观众席 |
| `buildAudienceSeatsView(params)` | `AudienceSeat[]` | 全量观众席矩阵 |
| `audienceDetailView(params)` | `AudienceDetail` | 观众详情 |
| `runOverviewView(params)` | `RunOverview` | Run 总览 |

### 6.11 错误处理与日志

#### [errors.ts](apps/api/src/errors.ts)

- 类 `ApiError extends Error`：`{ code, message, statusCode=500, details? }`
- `sendApiError(reply, error)`：
  - `ApiError` 实例：4xx warn、5xx error 日志，返回 `fail(code, message, details)`
  - 其他错误：生产环境返回 `"服务器内部错误，请稍后重试"`（不泄露堆栈）

#### [logger.ts](apps/api/src/logger.ts)

- `Logger` 接口：`info`/`warn`/`error`/`debug`/`child`
- `createFallbackLogger()` — Fastify 初始化前的 console 包装器
- `initLogger(logger)` — 注入 Fastify pino 实例
- `log: Logger` — Proxy 代理，模块内 `import { log } from "../logger.js"` 即可

---

## 7. apps/web — 前端工作台

**入口**：[apps/web/src/main.tsx](apps/web/src/main.tsx)
**包名**：`@trycue/web`

### 7.1 模块概览

- Vite + React 19 SPA，无 React Router，无状态管理库
- 路由通过 `window.history` + `popstate` 自管
- 状态全部用 `useState`/`useRef` 集中在 [App.tsx](apps/web/src/App.tsx)（约 4000 行单文件）
- SSE 通过原生 `EventSource` 订阅

**依赖关键包**：
- `@trycue/shared` — 共享 DTO/Zod 契约
- `@dnd-kit/*` — 图片拖拽排序
- `lucide-react` — 图标
- `react-markdown` + `remark-gfm` — Markdown 渲染（用于采样计划）

### 7.2 入口与路由

#### [main.tsx](apps/web/src/main.tsx)

```tsx
createRoot(...).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
```

#### [lib/routes.ts](apps/web/src/lib/routes.ts)

自实现路由解析：

```typescript
type AppRoute =
  | { kind: "settings" }
  | { kind: "history" }
  | { kind: "report"; runId: string }
  | { kind: "workbench"; runId?: string };

function parseRoute(pathname = window.location.pathname): AppRoute;
function pathForRoute(route: AppRoute): string;
```

路由映射：
- `/settings` → settings
- `/runs` → history
- `/reports/:runId` → report
- `/runs/:runId` → workbench
- 其他（含 `/`）→ workbench（无 runId 即新建试映）

#### App.tsx 路由调度

- `useState<AppRoute>(() => parseRoute())` 持有当前路由
- `useEffect` 监听 `popstate`
- `navigateTo(nextRoute, replace=false)` — 所有内部跳转的唯一入口
- 渲染分支按 `route.kind` + `uiStatus` 组合判断

### 7.3 状态管理

`App.tsx` 是单一巨型组件，约 50 个 `useState` + 20+ `useRef`。

#### 状态分类

1. **路由/内容草稿**：`route`、`title`、`bodyText`、`scale`、`imageUrls`、`isUploadingImages` 等
2. **run 生命周期**：`uiStatus`、`runId`、`connectionStatus`、`runtimeSnapshotReady`、`report`、`runClock` 等
3. **运行时数据**：`postState`、`summary`、`commentsState`、`runtimeLogsState`、`audienceSeats`、`audienceDetail` 等
4. **观众准备**：`audienceDrafts`、`audienceSampling`、`audiencePlanPreview`、`audienceEdit`、`assistantDialogStage` 等
5. **UI 临时态**：`appToast`、`confirmDialog`、`behaviorToasts`、`enteringCommentIds`、`postActionPulses` 等

#### Ref 用途

- **去重/序列**：`seenEventIds`（SSE 事件幂等，上限 2000 FIFO）、`latestLiveEventSequenceRef`、`audienceRevisionRef`
- **请求竞态**：`restoreRequestSeq`、`commentRequestSeq`、`runtimeLogRequestSeq` — 每次发请求递增，回调时校验 seq
- **最新值镜像**：`activeRunIdRef`、`uiStatusRef`、`commentSortRef` — 在 effect 依赖数组外读取最新值
- **动画定时器**：`commentEntryClearTimer`、`commentBurstMergeTimer` 等

#### `uiStatus` 状态机

`UiStatus = RunStatus | "starting" | "restoring" | "restore_failed" | "report_unavailable"`

- `starting` 只能是前端瞬时 UI 状态，不写入数据库（符合 AGENTS.md 约束）
- `uiStatus` 是单一真相源，决定渲染哪个壳

### 7.4 SSE 事件订阅

核心 effect 在 `useEffect(() => {...}, [runId, route.kind, restoredRunId])`：

- 仅在 `runId` 存在、非 report 路由、已恢复、未完成时建立连接
- 连接状态机：`idle → connecting/reconnecting → connected`
- URL：`/api/runs/:runId/events`，若有 `latestLiveEventSequenceRef` 则带 `?after=` 断点续传
- 显式 `addEventListener` 注册 38 种事件类型
- 每条事件 `JSON.parse` 失败时静默丢弃并只提示一次
- 末尾调用 `assertLiveEventTypeExhaustive(event.type)` 做编译期穷尽检查

#### handleLiveEvent 核心逻辑

- **幂等**：`eventRunId !== activeRunIdRef.current` 或 `seenEventIds` 命中则丢弃
- **序列号**：数字 eventId 更新 `latestLiveEventSequenceRef`
- **audience 版本号**：跨版本时全量 `loadAudienceState`，当前版本内走增量合并
- **数据合并**：
  - `post_state.updated` → `mergePostState`
  - `comment.created` → `mergeById` + `sortPostComments` + 标记新评论动画
  - `summary.updated` → 直接 set
  - `action_log.created` → 写入 `liveLogsByAudience` 和 `runtimeLogsState`
  - `audience.status_updated/action_happened` → 更新 `audienceSeats` + 推 `behaviorToast`
  - `run.clock.updated` → set `runClock`（带 `receivedAtMs`）

### 7.5 页面与组件

#### 7.5.1 现场页布局（venueShell）

三段式 grid：`auto minmax(0,1fr) auto`

- 顶部：`<VenueHud>` — HUD（状态、模拟进度、模拟时间、6 个指标条、暂停/继续/报告/重置按钮、连接状态）
- 中部 `venueStage`：
  - `toastRail` — 行为 toast
  - `<SimulatedPostSurface>` — 小红书风格模拟帖（图片轮播 + 标题正文 + 评论区 + composer + 行动栏）
  - `<aside className="runtimeDock">` — 右侧运行席（观众席矩阵 + 运行日志条）
- 底部 `venueDisclosure` — 模拟标识

#### 7.5.2 核心组件

| 组件 | 文件 | 职责 |
|---|---|---|
| `VenueHud` | [VenueWidgets.tsx](apps/web/src/components/VenueWidgets.tsx) | 顶部 HUD，含 `useCountDelta` hook 触发 `+N` burst 动画 |
| `AnimatedCommentList` | 同上 | 评论列表，用 FLIP 动画（useLayoutEffect 对比 DOMRect） |
| `PostAction` | 同上 | 帖子行动按钮（点赞/收藏/评论/分享） |
| `SeatCell` | 同上 | 观众席单元格 |
| `AudienceAvatar` | 同上 | 观众头像（hashSeed 生成 hue） |
| `AssistantDialog` | [AssistantDialog.tsx](apps/web/src/components/AssistantDialog.tsx) | AI 助手对话弹窗，支持 `@mention` 引用分组/观众 |
| `AudienceEditDrawer` | [AudienceEditDrawer.tsx](apps/web/src/components/AudienceEditDrawer.tsx) | 观众人设编辑抽屉 |
| `ConfirmDialog` | [ConfirmDialog.tsx](apps/web/src/components/ConfirmDialog.tsx) | 通用确认弹窗 |
| `ErrorBoundary` | [ErrorBoundary.tsx](apps/web/src/components/ErrorBoundary.tsx) | 全局错误兜底 |
| `ReportPanel` | [ReportPanel.tsx](apps/web/src/components/ReportPanel.tsx) | 试映报告渲染 |
| `RuntimeLogStrip` | [RuntimeLogStrip.tsx](apps/web/src/components/RuntimeLogStrip.tsx) | 实时运行日志条，可折叠/过滤 |
| `SortableImageTile` | [SortableImageTile.tsx](apps/web/src/components/SortableImageTile.tsx) | 可拖拽排序的图片缩略图 |

#### 7.5.3 路由组件

- [HistoryRoute.tsx](apps/web/src/routes/HistoryRoute.tsx) — 历史试映列表，分页加载、删除
- [SettingsRoute.tsx](apps/web/src/routes/SettingsRoute.tsx) — LLM 配置编辑，含 `ModelPicker` 子组件

### 7.6 lib 库

| 文件 | 关键导出 |
|---|---|
| [api.ts](apps/web/src/lib/api.ts) | `parseApiResponse<T>`、`request<T>` — 封装 fetch，统一错误处理 |
| [events.ts](apps/web/src/lib/events.ts) | `actionText(action)` — 工具动作中文映射 |
| [collections.ts](apps/web/src/lib/collections.ts) | `mergeById`、`patchCommentById`、`mergePostState`、`mergeRuntimeLogsById`、`sortPostComments`、`mergeSeatSummary` |
| [format.ts](apps/web/src/lib/format.ts) | `statusLabel`、`statusLabelForRun`、`runtimeLogCategory`、`formatClock`、`formatCompact`、`recommendationLabel`、`dimensionTitle`、`hashSeed` |
| [images.ts](apps/web/src/lib/images.ts) | `normalizeImageUrls`、`prepareImageForUpload`（canvas 压缩，5 档质量 × 8 轮）、`formatBytes` |
| [routes.ts](apps/web/src/lib/routes.ts) | `parseRoute`、`pathForRoute` |

### 7.7 constants.ts

- `DEMO_TITLE` / `DEMO_BODY` — 演示用帖子内容
- `emptyPostState` / `emptySummary` — 零值初始态
- `SEAT_FILTERS` — 观众席过滤选项
- `MAX_POST_IMAGES = 9`、`MAX_UPLOAD_IMAGE_BYTES = 5MB`、`MAX_UPLOAD_IMAGE_EDGE = 1600`
- `COMMENT_PAGE_SIZE = 20`、`RUNTIME_LOG_PAGE_SIZE = 100`、`SEEN_EVENT_IDS_MAX = 2000`

### 7.8 types.ts

纯类型定义，所有跨边界 DTO 从 `@trycue/shared` import：

- `UiStatus = RunStatus | "starting" | "restoring" | "restore_failed" | "report_unavailable"`
- `AppRoute` — 四种路由判别联合
- `LocalRunClockSnapshot` — `RunClockSnapshot` + `receivedAtMs`
- `CommentsState` / `RuntimeLogsState` / `AudienceLiveLogsState` — 分页/分桶列表状态
- `AudienceDraft` — 扩展 `AudienceProfileView`
- `AudienceDirectiveCard` — 扩展 `AudienceSamplingDirective`
- `BehaviorToast` / `AppToast` / `ConfirmDialogState` / `CountDeltaBurst` — UI 临时态

### 7.9 样式

[styles.css](apps/web/src/styles.css) 是聚合入口，`@import` 10 个分模块 CSS：

| 文件 | 用途 |
|---|---|
| `base.css` | 全局基础、CSS 变量、reset、通用按钮/输入 |
| `create.css` | 创建页双栏布局 |
| `venue-shell.css` | 现场页外壳 grid |
| `audience-generation.css` | 观众生成页（独立调色板） |
| `venue.css` | 现场页内部组件 |
| `dialogs.css` | 所有浮层 |
| `settings.css` | 设置页 |
| `history.css` | 历史页 |
| `report.css` | 报告页 |
| `responsive.css` | 响应式断点 |

**视觉风格**：浅色、克制、paper-grid 纹理、5px 偏移阴影，非深色控制台。

---

## 8. 关键流程

### 8.1 试映完整流程

```
1. 创建内容草稿
   POST /api/runs (status: draft)
   POST /api/upload (上传图片)

2. 观众采样计划
   POST /api/runs/:runId/audience-sampling-plan (status: planning_audience)
     → AgentProvider.generateAudienceSamplingPlan (streamText + NDJSON)
     → SSE: audience.plan.started/progress/frame/ready
   用户审核/编辑 directive (CRUD API)
   POST /api/runs/:runId/audience-sampling-plan/confirm (status: generating_audience)

3. 观众生成
   → AgentProvider.expandAudienceProfiles (流式)
   → SSE: audience.profile.expansion.* / audience.profile.created
   → AgentProvider.generateAudiencePersona (批量)
   → SSE: audience.identity.started/ready/failed
   status: audience_ready

4. 开始试映
   POST /api/runs/:runId/start
     → 创建 RunParticipant 快照
     → Scheduler.start (status: running)

5. Agent 运行
   Scheduler.runLoop (每 50ms):
     → admitWaitingAudiences (创建 AgentJourney)
     → claimRunnableJourneys (原子 UPDATE...RETURNING)
     → runAgentJourney:
       → createOrLoadRunningTurn
       → recordOrLoadTurnContext
       → AgentProvider.runAudienceTurn (streamText + tool calling)
       → ToolExecutor.withToolContext (事务提交)
       → SSE: action_log.created / audience.action_happened / summary.updated
     → 全部完成 → status: report_generating

6. 报告生成
   report.generateReportAndCompleteRun:
     → 收集证据 (journeys, comments, logs, toolCalls)
     → buildEvidenceIndex
     → reportAgent.generateReportWithLLM (pro 模型)
     → upsert Report + status: completed
     → SSE: run.completed
```

### 8.2 暂停/继续语义

- **暂停**：`running → pausing`，Scheduler 不再 claim 新 journey，已运行 Runner 跑到 terminal 后 `paused`
- **禁止**：强杀模型 HTTP 请求、强杀 tool handler 事务、把已开始 journey 标记 paused
- **系统异常升级为 run pause** 必须是原子 CAS

### 8.3 重试策略

- **continue_retry**（默认）：保留 transcript/turn/tool result，追加 system_notice，从失败点继续
- **clean_retry**（破坏性）：删除该 participant 运行期事实和报告，保留身份/profile，重新入场

### 8.4 启动恢复

三路恢复机制：
1. `Scheduler.recoverAndResume()` — 恢复 running/pausing 状态的 run
2. `recoverReportGenerationRuns(...)` — 恢复 report_generating 状态的 run
3. `RunService.recoverAudienceGenerationJobs()` — 恢复锁过期或未持锁的活跃 job

恢复时先 `failInterruptedJourneyRunners`（把所有 `runnerStatus=running` 或 turn 处于非终态的 journey 标记 failed）。

---

## 9. 项目运行方式

### 9.1 本地开发（Windows / PowerShell 推荐）

```powershell
pnpm dev:local
```

这会：
1. 创建 `.env.local`（如不存在）
2. 安装依赖（如无 node_modules）
3. `pnpm db:generate` — 生成 Prisma Client
4. `pnpm db:deploy` — 应用 migration
5. 可选 `pnpm db:seed-demo`（需 `-SeedDemo` 参数）
6. `pnpm dev` — 启动 API 和 Web

**访问地址**：
- Web: http://localhost:3000
- API: http://localhost:4000

### 9.2 写入 demo 种子数据

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/run-local.ps1 -SeedDemo
```

### 9.3 手动启动

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm dev
```

### 9.4 通用开发命令

```bash
pnpm dev              # 启动 API + Web
pnpm dev:local        # Windows 一键启动
pnpm build            # 构建所有包
pnpm lint             # ESLint
pnpm typecheck        # TypeScript 类型检查
pnpm test             # 单元测试
pnpm test:integration # 集成测试
pnpm verify           # 完整验证（generate + lint + typecheck + test + integration + build）
```

### 9.5 数据库命令

```bash
pnpm db:generate      # 生成 Prisma Client
pnpm db:migrate       # 本地开发 migration
pnpm db:deploy        # 应用 migration（不交互）
pnpm db:seed-demo     # 写入 demo seed
```

### 9.6 局部检查

```bash
pnpm --filter @trycue/api lint
pnpm --filter @trycue/web typecheck
pnpm --filter @trycue/shared test
```

### 9.7 集成测试

```bash
pnpm test:integration
```

使用独立测试库 `file:./data/trycue_test.db`，与开发库隔离。

---

## 10. 配置与环境变量

### 10.1 环境变量

从 `.env.local` 或 `.env` 读取。完整列表见 [.env.example](.env.example)。

#### 必需环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `APP_ENV` | local | 应用环境 |
| `APP_URL` | http://localhost:3000 | Web 地址（CORS origin） |
| `API_PORT` | 4000 | API 端口 |
| `DATABASE_URL` | file:./data/trycue.db | 数据库 URL |
| `LLM_CONFIG_PATH` | config/llm.local.yaml | LLM 配置文件路径 |
| `SCHEDULER_WORKER_ID` | local-worker-1 | Scheduler worker 标识 |
| `SCHEDULER_DEFAULT_CONCURRENCY` | 2 | 默认并发数 |
| `SCHEDULER_MAX_RETRY` | 2 | 最大重试次数 |
| `MODEL_CALL_TIMEOUT_SECONDS` | 120 | 单次模型调用超时 |
| `TOOL_CALL_TIMEOUT_SECONDS` | 30 | 单个 tool handler 超时 |
| `AGENT_JOURNEY_TIMEOUT_SECONDS` | 300 | 单 Agent 总时长 |
| `RUNNER_HEARTBEAT_INTERVAL_SECONDS` | 5 | 心跳间隔 |
| `DEFAULT_STANDARD_AUDIENCE_COUNT` | 30 | 标准试映观众数 |
| `DEFAULT_QUICK_AUDIENCE_COUNT` | 12 | 快速试映观众数 |
| `MAX_JOURNEY_ACTIONS_PER_JOURNEY` | 10 | 单 journey 最大步数 |
| `MAX_TOOL_CALLS_PER_ACTION` | 20 | 单 action 最大 tool call 数 |
| `REALTIME_MODE` | sse | 实时模式（V1 只支持 sse） |
| `SSE_HEARTBEAT_INTERVAL` | 15 | SSE 心跳间隔（秒） |
| `SSE_TIMEOUT_SECONDS` | 300 | SSE 超时（秒） |
| `MAX_COVER_IMAGE_SIZE_MB` | 5 | 封面图大小上限 |
| `LOG_LEVEL` | debug | 日志级别 |
| `ENABLE_AGENT_TRACE` | true | 启用 Agent trace |

#### 可选环境变量

| 变量 | 说明 |
|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase 配置 |
| `STORAGE_PROVIDER` | 存储提供商（local） |
| `ENABLE_REPORT_GENERATION` | 启用报告生成 |
| `ENABLE_PROMPT_REPAIR` | 启用 Prompt 修复 |
| `ENABLE_DEBUG_PAGE` | 启用调试页面 |
| `ENABLE_SCHEDULER` | 启用调度器 |

### 10.2 LLM 配置

通过 `LLM_CONFIG_PATH` 指向 YAML 文件，通常是 `config/llm.local.yaml`。

[config/llm.example.yaml](config/llm.example.yaml):
```yaml
provider: openai-compatible
runtimeMode: mock
apiKey: ""
baseUrl: ""
models:
  fast: ""
  pro: ""
```

#### 运行时模式

**runtimeMode=mock**：
- 必须使用 Mock provider
- 即使 key/baseUrl/model 字段完整也不调用真实模型
- 用确定性数据支持完整演示

**runtimeMode=real**：
- 必须同时提供 `apiKey`、`baseUrl`、`models.fast`、`models.pro`
- `models.pro` 必须支持 vision（用于采样计划、优化问答、打磨人设、报告）
- 后端不自动降级到 `models.fast`
- 缺少 `runtimeMode` 的 YAML 配置不兼容，服务启动失败

#### 模型使用范围

| 模型 | 用途 |
|---|---|
| `models.fast` | 画像展开、人设批量生成、试映中观众行为回合 |
| `models.pro` | 采样计划生成、优化观众分布问答、打磨观众人设问答、试映报告生成 |

### 10.3 API Key 安全

- 只在服务端使用
- 不通过 GET settings API 回显
- 不存入前端 localStorage
- 不放入 URL
- 不写入日志
- `LlmSettingsView` 只提供 `apiKeyMasked` 和 `hasApiKey` 布尔值

### 10.4 数据库隔离

- 开发库：`file:./data/trycue.db`
- 集成测试库：`file:./data/trycue_test.db`

### 10.5 Docker

[docker-compose.yml](docker-compose.yml) 仅包含 PostgreSQL 17-alpine 服务（端口 5432，DB=trycue，user=trycue，password=trycue）。

**当前本地默认使用 SQLite，无需 Docker**。

---

## 11. 测试与验证

### 11.1 测试策略

| 类型 | 命令 | 范围 |
|---|---|---|
| 单元测试 | `pnpm test` | 各包内部（mockAgent、realAgent、taskRunner、agentSessions、runDataLifecycle、views、shared、api、collections） |
| 集成测试 | `pnpm test:integration` | API 集成（api.integration、audience-control.integration、tools.integration） |
| 类型检查 | `pnpm typecheck` | 所有包 |
| Lint | `pnpm lint` | 所有包 |
| 构建 | `pnpm build` | 所有包 |
| 完整验证 | `pnpm verify` | generate + lint + typecheck + test + integration + build |

### 11.2 测试文件

#### apps/api 测试

- [mockAgent.test.ts](apps/api/src/agents/mockAgent.test.ts) — Mock Provider 单元测试
- [realAgent.test.ts](apps/api/src/agents/realAgent.test.ts) — Real Provider 单元测试
- [taskRunner.test.ts](apps/api/src/agents/taskRunner.test.ts) — AI 任务追踪测试
- [agentSessions.test.ts](apps/api/src/runtime/agentSessions.test.ts) — Agent 会话测试
- [runDataLifecycle.test.ts](apps/api/src/runtime/runDataLifecycle.test.ts) — 数据生命周期测试
- [views.test.ts](apps/api/src/views.test.ts) — View 函数测试
- [rateLimitedFetch.test.ts](apps/api/src/llm/rateLimitedFetch.test.ts) — 容量管理器测试（AIMD、cooldown、热重载）
- [tests/api.integration.test.ts](apps/api/src/tests/api.integration.test.ts) — API 集成测试
- [tests/audience-control.integration.test.ts](apps/api/src/tests/audience-control.integration.test.ts) — 观众控制集成测试
- [tests/tools.integration.test.ts](apps/api/src/tests/tools.integration.test.ts) — 工具集成测试

#### apps/web 测试

- [api.test.ts](apps/web/src/lib/api.test.ts) — API 客户端测试
- [collections.test.ts](apps/web/src/lib/collections.test.ts) — 集合工具测试

#### packages/shared 测试

- [index.test.ts](packages/shared/src/index.test.ts) — 共享契约测试

### 11.3 测试要求（来自 AGENTS.md）

- 窄范围改动先跑最小相关检查
- 触及共享边界或用户可见流程时再扩大验证范围
- 修改共享 DTO 时，至少跑 shared typecheck，并跑受影响的 API/Web typecheck
- 修改 API、Scheduler、持久化、状态机行为时，运行相关测试；可行时包含 `pnpm test:integration`
- 修改前端行为时，如果本地 dev server 可用，使用 Browser 插件做页面验证

---

## 12. 核心设计要点

### 12.1 统一行为主体模型

前端用户和 Agent 都走 `runtime/interactions.ts`，通过 `ActorContext.source` 区分（`human_ui` vs `agent_tool`），保证计数和事件一致。

```
User + Agent + PlatformAccount 三元组
  - User:Agent 为 1:1
  - User:PlatformAccount 为 1:N（按 platform 唯一）
```

### 12.2 事件驱动 phase

feed→post 转换以 `open_post` 的 `SocialInteractionEvent` 为准，不存独立字段，避免状态不一致。

### 12.3 原子抢占

- Scheduler 用 SQLite `UPDATE...RETURNING` 原子 claim journey
- RunService 用 `updateMany` + 锁条件 CAS 推进 job 状态
- 避免 TOCTOU（Time of Check to Time of Use）竞争

### 12.4 幂等提交

- toolCall 用 `idempotencyKey`（`runId:participantId:turnId:callIndex`）+ `agentTurnId_callIndex` 双重唯一约束
- 重复执行时直接复用已有结果
- `SocialReaction` 通过唯一约束实现幂等 toggle

### 12.5 状态机校验

- toolCall 状态 `pending→committed|ignored|failed` 单向，终态不可变
- 非法转换 fail-fast

### 12.6 SSE 双通道

- `recordLiveEvent`（事务内落库）— 重连客户端按 `Last-Event-ID` 回放
- `pushLiveEvent`（内存广播）— 在线客户端实时收

### 12.7 Prompt 版本化

所有持久化的 LLM 输出都带 `promptVersion`，便于审计和 replay。

### 12.8 审计脱敏

`sanitizeAuditJson` 递归清除 apiKey/token/secret 和 base64 图片，避免 SQLite 膨胀和敏感信息泄露。

### 12.9 容量控制共享

`LlmCapacityManager` 单例（通过 `getSharedCapacityManager()` 访问），所有真实 LLM 调用共享同一 RPM + 并发双限流 lane。支持 AIMD 自动调整、429/503 cooldown 和热重载。`getSharedRateLimitedFetch()` 作为兼容入口返回 `capacityManager.getFetch()`。

### 12.10 启动恢复

三路恢复机制处理进程中断：
1. Scheduler 恢复 running/pausing 状态的 run
2. report 恢复 report_generating 状态的 run
3. RunService 恢复锁过期的 audience generation job

### 12.11 前端状态管理

- 单文件巨型 App（约 4000 行），无状态管理库
- `useRef` 镜像 + `useMemo` 派生控制重渲染
- `seenEventIds` Set + `latestLiveEventSequenceRef` + `?after=` 参数保证断线重连不丢不重
- 请求竞态防护：`restoreRequestSeq`/`commentRequestSeq`/`runtimeLogRequestSeq` 三套 seq
- `assertLiveEventTypeExhaustive` 用 `never` 类型保证新增 SSE 事件类型必须被处理

### 12.12 视觉风格

- 浅色、克制、paper-grid 纹理、5px 偏移阴影
- 非深色控制台、非玻璃拟态、非营销 landing
- 必须保留模拟标识：`以下互动为 AI 试映模拟结果，不代表真实平台数据。`
- 展示真实模拟计数，不展示伪精确预测率、爆款概率

---

## 附录：关键文件路径速查

### 后端

| 文件 | 职责 |
|---|---|
| [apps/api/src/index.ts](apps/api/src/index.ts) | 进程入口 |
| [apps/api/src/app.ts](apps/api/src/app.ts) | Fastify 应用构建 + 路由注册 |
| [apps/api/src/config.ts](apps/api/src/config.ts) | 配置加载 |
| [apps/api/src/env.ts](apps/api/src/env.ts) | 环境变量加载 |
| [apps/api/src/errors.ts](apps/api/src/errors.ts) | 错误处理 |
| [apps/api/src/logger.ts](apps/api/src/logger.ts) | 集中式 logger |
| [apps/api/src/liveEvents.ts](apps/api/src/liveEvents.ts) | SSE 事件总线 |
| [apps/api/src/llmConfigStore.ts](apps/api/src/llmConfigStore.ts) | LLM 配置存储 |
| [apps/api/src/views.ts](apps/api/src/views.ts) | View 函数集 |
| [apps/api/src/runtime/scheduler.ts](apps/api/src/runtime/scheduler.ts) | 核心调度器 |
| [apps/api/src/runtime/runService.ts](apps/api/src/runtime/runService.ts) | Run 生命周期编排 |
| [apps/api/src/runtime/agentSessions.ts](apps/api/src/runtime/agentSessions.ts) | Agent 会话与 transcript |
| [apps/api/src/runtime/interactions.ts](apps/api/src/runtime/interactions.ts) | 统一互动服务 |
| [apps/api/src/runtime/comments.ts](apps/api/src/runtime/comments.ts) | 评论分页 |
| [apps/api/src/runtime/clock.ts](apps/api/src/runtime/clock.ts) | 模拟时钟 |
| [apps/api/src/runtime/queue.ts](apps/api/src/runtime/queue.ts) | 观众入场排队 |
| [apps/api/src/runtime/identity.ts](apps/api/src/runtime/identity.ts) | 身份管理 |
| [apps/api/src/runtime/report.ts](apps/api/src/runtime/report.ts) | 报告生成 |
| [apps/api/src/runtime/runDataLifecycle.ts](apps/api/src/runtime/runDataLifecycle.ts) | 数据生命周期 |
| [apps/api/src/runtime/runLogs.ts](apps/api/src/runtime/runLogs.ts) | 运行日志 |
| [apps/api/src/runtime/contentVersions.ts](apps/api/src/runtime/contentVersions.ts) | 内容版本 |
| [apps/api/src/runtime/modelImages.ts](apps/api/src/runtime/modelImages.ts) | 模型图片处理 |
| [apps/api/src/agents/index.ts](apps/api/src/agents/index.ts) | Agent Provider 工厂 |
| [apps/api/src/agents/mockAgent.ts](apps/api/src/agents/mockAgent.ts) | Mock Provider |
| [apps/api/src/agents/realAgent.ts](apps/api/src/agents/realAgent.ts) | Real Provider |
| [apps/api/src/agents/reportAgent.ts](apps/api/src/agents/reportAgent.ts) | 报告 LLM 调用 |
| [apps/api/src/agents/taskRunner.ts](apps/api/src/agents/taskRunner.ts) | AI 任务追踪 |
| [apps/api/src/agents/types.ts](apps/api/src/agents/types.ts) | Agent 类型定义 |
| [apps/api/src/agents/promptVersions.ts](apps/api/src/agents/promptVersions.ts) | Prompt 版本常量 |
| [apps/api/src/tools/toolExecutor.ts](apps/api/src/tools/toolExecutor.ts) | 工具执行器 |
| [apps/api/src/llm/rateLimitedFetch.ts](apps/api/src/llm/rateLimitedFetch.ts) | 容量管理器共享入口 |
| [apps/api/src/llm/llmCapacityManager.ts](apps/api/src/llm/llmCapacityManager.ts) | LLM 容量管理器（RPM+并发双限流、AIMD） |
| [apps/api/src/llm/capacityPresets.ts](apps/api/src/llm/capacityPresets.ts) | 容量预设默认值与校验 |
| [apps/api/src/llm/capacityProbe.ts](apps/api/src/llm/capacityProbe.ts) | 低成本容量校准 |
| [apps/api/src/llm/aiSdkTracing.ts](apps/api/src/llm/aiSdkTracing.ts) | AI SDK tracing |

### 前端

| 文件 | 职责 |
|---|---|
| [apps/web/src/main.tsx](apps/web/src/main.tsx) | React 入口 |
| [apps/web/src/App.tsx](apps/web/src/App.tsx) | 根组件（约 4000 行） |
| [apps/web/src/constants.ts](apps/web/src/constants.ts) | 常量定义 |
| [apps/web/src/types.ts](apps/web/src/types.ts) | 纯前端类型 |
| [apps/web/src/lib/routes.ts](apps/web/src/lib/routes.ts) | 路由解析 |
| [apps/web/src/lib/api.ts](apps/web/src/lib/api.ts) | API 客户端 |
| [apps/web/src/lib/events.ts](apps/web/src/lib/events.ts) | SSE 事件辅助 |
| [apps/web/src/lib/collections.ts](apps/web/src/lib/collections.ts) | 集合工具 |
| [apps/web/src/lib/format.ts](apps/web/src/lib/format.ts) | 格式化函数 |
| [apps/web/src/lib/images.ts](apps/web/src/lib/images.ts) | 图片处理 |
| [apps/web/src/components/VenueWidgets.tsx](apps/web/src/components/VenueWidgets.tsx) | 现场页组件集 |
| [apps/web/src/components/AssistantDialog.tsx](apps/web/src/components/AssistantDialog.tsx) | AI 助手对话弹窗 |
| [apps/web/src/components/AudienceEditDrawer.tsx](apps/web/src/components/AudienceEditDrawer.tsx) | 观众编辑抽屉 |
| [apps/web/src/components/ConfirmDialog.tsx](apps/web/src/components/ConfirmDialog.tsx) | 通用确认弹窗 |
| [apps/web/src/components/ErrorBoundary.tsx](apps/web/src/components/ErrorBoundary.tsx) | 错误兜底 |
| [apps/web/src/components/ReportPanel.tsx](apps/web/src/components/ReportPanel.tsx) | 报告渲染 |
| [apps/web/src/components/RuntimeLogStrip.tsx](apps/web/src/components/RuntimeLogStrip.tsx) | 运行日志条 |
| [apps/web/src/components/SortableImageTile.tsx](apps/web/src/components/SortableImageTile.tsx) | 可拖拽图片 tile |
| [apps/web/src/routes/HistoryRoute.tsx](apps/web/src/routes/HistoryRoute.tsx) | 历史页 |
| [apps/web/src/routes/SettingsRoute.tsx](apps/web/src/routes/SettingsRoute.tsx) | 设置页 |

### 数据库与共享

| 文件 | 职责 |
|---|---|
| [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma) | Prisma schema |
| [packages/db/src/index.ts](packages/db/src/index.ts) | Prisma Client 导出 |
| [packages/db/src/env.ts](packages/db/src/env.ts) | 环境变量加载 |
| [packages/db/src/applyMigrations.ts](packages/db/src/applyMigrations.ts) | Migration 应用 |
| [packages/db/src/seedDemo.ts](packages/db/src/seedDemo.ts) | Demo seed |
| [packages/shared/src/index.ts](packages/shared/src/index.ts) | 共享 Zod 契约 |

### 配置与文档

| 文件 | 职责 |
|---|---|
| [package.json](package.json) | workspace 根配置 |
| [pnpm-workspace.yaml](pnpm-workspace.yaml) | workspace 定义 |
| [tsconfig.base.json](tsconfig.base.json) | TypeScript 基础配置 |
| [.env.example](.env.example) | 环境变量示例 |
| [config/llm.example.yaml](config/llm.example.yaml) | LLM 配置示例 |
| [docker-compose.yml](docker-compose.yml) | Docker 配置 |
| [scripts/run-local.ps1](scripts/run-local.ps1) | 本地启动脚本 |
| [README.md](README.md) | 项目说明 |
| [docs/00_README_文档索引.md](docs/00_README_文档索引.md) | 文档入口 |
