# 02 API 契约与共享 DTO

本文定义 AI 用户试映会 V1 的前后端 API 契约、跨边界 DTO 归属规则和共享 schema 清单。

---

## 1. 设计原则

观众生成 API 已采用 plan-first 流程：用户先审核 `AudienceSamplingPlan / AudienceSamplingDirective`，确认后系统展开 `AudienceProfile` 并生成 `User / Agent / PlatformAccount`，开始试映时再冻结 `RunParticipant` 快照。该领域完整流程见 `04_观众生成领域规格.md`。

```text
1. 前端只通过 API 创建 run、启动 run、读取现场、发起用户互动和查看报告。
2. Agent、Scheduler、数据库状态不暴露给前端直接修改；前端用户互动必须调用统一 runtime service。
3. 实时现场通过 SSE 推送，支持 Last-Event-ID 重连。
4. Agent 工具和前端 API 都调用同一套 runtime service，不能分别实现点赞、收藏、评论等业务逻辑。
5. 开发阶段可使用默认 human user，但数据库和接口按 `user + platformAccount + source` 行为主体设计。
6. 所有返回字段使用 camelCase。
7. 所有错误返回统一结构。
8. 新增或修改 API 时，跨前后端边界的 request / response DTO 优先定义在 `packages/shared`；后端 view 显式返回共享 DTO，前端从 `@trycue/shared` import，避免重复本地类型。
```

## 1.1 DTO 共享契约

### 归属规则

以下内容必须放入 `packages/shared`：

```text
HTTP request body (Zod schema)
HTTP response DTO / view model
SSE payload 类型
共享枚举
跨前后端复用的派生展示模型
```

以下内容**不**进入 shared：

```text
纯前端 UI state（如 AudienceEditState、ToastState）
后端内部 service 参数
Prisma row type
provider 内部 prompt 原始输出
临时组件状态
```

### 当前 Shared 范围

**枚举与常量：**

```text
RunStatus
RunParticipantStatus
AudienceIdentityStatus
AudienceGenerationJobStatus
AudienceGenerationJobScope
AudienceSamplingPlanStatus
AudienceSamplingDirectiveExpansionStatus
JourneyStatus
AgentTurnStatus
AgentToolCallStatus
ToolName
ToolCategory
Scale
Recommendation
CUSTOM_AUDIENCE_MIN / MAX / TOKEN_WARNING_THRESHOLD
```

**Request Schema（Zod）：**

```text
CreateRunRequestSchema
StartRunRequestSchema
RetryRunRequestSchema
CreateAudienceSamplingPlanRequestSchema
UpdateAudienceSamplingPlanRequestSchema
CreateAudienceSamplingDirectiveRequestSchema
UpdateAudienceSamplingDirectiveRequestSchema
CreateAudienceSamplingPlanRevisionSuggestionRequestSchema
RetryAudienceIdentitiesRequestSchema
UpdateAudienceIdentityRequestSchema
FavoriteAudienceIdentityRequestSchema
CreateAudienceProfileRequestSchema
CreateAudienceSeatRevisionSuggestionRequestSchema
LlmSettingsRequestSchema
ListModelsRequestSchema
ToolCallInputSchema
```

后端不得直接信任 `request.body as SomeType`；必须先用 shared schema 校验，再进入 service。

**工具 input schema 事实源（阶段12 决策）：**

- `packages/shared/src/tool.ts` 中的 Zod schema（`WriteCommentArgsSchema`、`ReadPostArgsSchema` 等）是工具参数契约的**唯一事实源**。
- `toolInputJsonSchema(name: ToolName)` 从 Zod schema 派生 AI SDK `jsonSchema()`，toolExecutor 不再手写内联 JSON Schema。
- 运行时参数校验仍由 toolExecutor 的 `*Arg` helper 负责（保留 snake_case 兼容），不依赖 Zod safeParse。
- 模型看到的 schema 比 v1 之前更严格：包含 `minLength`、`maxLength`、`enum`、nullable 字段的 `anyOf` 声明。
- `$schema` 元数据字段在派生时被移除（部分 OpenAI 兼容 API 会拒绝）。

**Response DTO / View Model：**

```text
ApiResponse<T>
RunOverview
RunHistoryItem
ReportView
RunClockSnapshot
PostStateView
LiveSummary
LiveEventType
CommentItem
CommentUpdatedPayload
ActionLogItem
RuntimeLogItem
InsightItem
AudienceSamplingPlanView
AudienceSamplingDirective
AudienceSamplingPlanValidation
AudiencePlanProgressStage
AudiencePlanProgressEvent
AudienceGenerationJobView
AudienceGenerationProgressView
AudienceGenerationDirectiveProgress
AudienceProfileView
AudiencePersonaJson
AudienceSeat
AudienceDetail
AudienceSeatsSummary
AudienceStatusUpdatedPayload
AudienceActionHappenedPayload
LiveEventPayload
LlmSettingsView
ModelListItem
```

**Revision Proposal 契约（AI 辅助修改建议，不直接写库）：**

```text
AudienceSamplingPlanRevisionOperation
AudienceSamplingPlanRevisionProposal
AudienceSamplingPlanRevisionMessage
AudienceSeatRevisionOperation
AudienceSeatRevisionProposal
AudienceSeatRevisionMessage
```

前端应用建议时，按 proposal operations 顺序调用现有 CRUD API，并把每条 operation 的成功或失败状态渲染回建议卡片。

### View 边界

后端 view 函数负责把数据库模型转换为 API DTO：

```text
samplingPlanView(row): AudienceSamplingPlanView
audienceGenerationProgressView(...): AudienceGenerationProgressView
profileView(row): AudienceProfileView
participantView(row): AudienceSeat / AudienceDetail
runOverviewView(row): RunOverview
commentView(row): CommentItem
```

Prisma row type 不直接暴露到 API。JSON 字段必须在 view 层归一化为 object / array，避免前端处理 `Prisma.JsonValue`。

### 采样 slot 与 personaJson 约束

观众生成领域已将 `AudienceProfile` 收敛为采样 slot，shared DTO 使用以下目标字段：

```text
AudienceProfileView.demographics
AudienceProfileView.samplingLabel
AudiencePersonaJson.profile
AudiencePersonaJson.personality
AudiencePersonaJson.mbtiType
AudiencePersonaJson.responseStyle
```

目标约束：

```text
samplingLabel: 4-12 个中文字符，最多 20 个中文字符，用于采样点展示，不是最终人物名字
demographics: gender / ageRange / cityTier / lifeStage / role / spendingPower，六字段必填；不确定或不影响反应时填"不限定"
mbtiType: 必填，限定 MBTI 16 型之一
profile / personality / responseStyle: 完整自然语言字符串
```

相关边界已同步到：

```text
CreateAudienceProfileRequestSchema
UpdateAudienceIdentityRequestSchema
AudienceSeatRevisionOperationSchema
AudienceProfileView
AudiencePersonaJson
API view 层 profileView / participantView
前端 AudienceEditState 和观众席展示
```

### 前端类型边界

`apps/web/src/types.ts` 只保留 UI 派生类型，例如：

```text
AudienceSamplingState
AudienceDirectiveCard
AudienceDraft
AudienceEditState
WorkspaceStatus
ToastState
RouteState
```

这些类型可以组合 shared DTO，但不得重新定义 API response 字段。

### 非公开契约

V1 不提供以下契约类别和公开入口：

```text
通用观众生成 job 创建请求
第一步 profile proposal / confirm 请求
第一步 profile 需求新增或编辑请求
非 plan-first 观众生成响应
plan snapshot 响应
分组响应
```

如果未来确实需要新增用户可编辑结构，应围绕 `AudienceSamplingPlan / AudienceSamplingDirective` 重新定义。

### 验证要求

修改 shared DTO、API 字段或 SSE payload 时至少运行：

```text
pnpm --filter @trycue/shared typecheck
pnpm --filter @trycue/api typecheck
pnpm --filter @trycue/web typecheck
```

触及观众生成、运行控制、持久化或状态机时，还应运行相关 API 测试；可行时包含 `pnpm test:integration`。

采样 slot / personaJson prompt 迁移还必须补充 real prompt 测试脚本，至少统计：

```text
samplingLabel 长度和非空校验
demographics 字段稀疏性和可解析性
personaJson 字段完整性
mbtiType 合法性
平台名是否仍被硬编码
JSON 可解析性和数量匹配
```

## 1.2 Actor 与 Source

所有会改变互动状态的 API 都需要解析 actor：

```ts
type ActorContext = {
  userId: string;
  platformAccountId: string;
  runParticipantId?: string | null;
  agentId?: string | null;
  source: "human_ui" | "agent_tool" | "system_seed" | "replay";
};
```

前端用户 API 默认 `source = "human_ui"`；Agent 工具默认 `source = "agent_tool"`。两者都进入报告统计，但报告需要保留 source breakdown。

## 2. 通用返回格式

### 2.1 成功

```json
{
  "success": true,
  "data": {}
}
```

### 2.2 失败

```json
{
  "success": false,
  "error": {
    "code": "RUN_NOT_FOUND",
    "message": "试映任务不存在",
    "details": {}
  }
}
```

## 3. 上传图片

### GET /health

健康检查接口，用于本地脚本、部署平台和监控探活。

#### Response

```json
{
  "success": true,
  "data": {
    "status": "ok"
  }
}
```

### POST /api/upload

上传单张图片，返回图片 URL 和 asset ID。创建 run 时可多次调用该接口，并把返回 URL 组成图片数组。

服务端把上传文件保存到本地 uploads 目录，创建 `assets` 记录并通过 `/uploads/*` 静态路径提供访问。删除 run 时，只会清理已不再被任何 content version 引用的本地 asset 和对应文件；外部 URL 不会被删除。

#### Request

`Content-Type: multipart/form-data`

| 字段 | 类型 | 说明 |
|---|---|---|
| file | File | 图片文件（jpg/png/webp，最大 5MB，最长边不超过 4096px） |

#### Response

```json
{
  "success": true,
  "data": {
    "url": "https://cdn.example.com/assets/abc123.png",
    "assetId": "asset_001",
    "width": 1080,
    "height": 1440,
    "mimeType": "image/png"
  }
}
```

#### 错误

| code | HTTP | 说明 |
|---|---|---|
| VALIDATION_ERROR | 400 | 文件缺失、格式不支持、文件超过 5MB 或尺寸过大 |

---

## 4. 创建试映

### POST /api/runs

创建一个试映 run（status: draft），不立即启动。图片为必填，通过上传接口获取 URL 后传入；第一张图片同时作为封面图。

#### Request

```ts
{
  "title": "string",        // required, 2-80 字
  "coverImageUrl": "string", // required, 第一张图片 URL
  "imageUrls": ["string"],    // optional, 1-9 张图片 URL；未传时使用 coverImageUrl
  "bodyText": "string",      // required, 20-8000 字
  "scale": "quick" | "standard" | "custom", // required, 试映规模
  "audienceCount": 60 // custom 时 required，1-10000
}
```

#### 字段规则

| 字段 | 必填 | 规则 |
|---|---|---|
| title | 是 | 2-80 字 |
| coverImageUrl | 是 | 第一张图片 URL，用于封面展示；只允许 `http(s)://` URL 或以单个 `/` 开头的同源绝对路径 |
| imageUrls | 否 | 1-9 张图片 URL；只允许 `http(s)://` URL 或以单个 `/` 开头的同源绝对路径；创建时会去重并以第一张作为封面 |
| bodyText | 是 | 20-8000 字 |
| scale | 是 | `quick` / `standard` / `custom` |
| audienceCount | scale=custom 时是 | 自定义观众数，整数 1-10000；`quick`/`standard` 不允许传 |

> **说明**：Agent 使用多模态 AI 视觉能力直接分析图片列表，无需额外描述字段。`coverImageUrl` 始终等于第一张图。
> **成本提示**：自定义观众数超过 100 时，前端必须提示模型调用和等待时间会显著增加；API 仍以 10000 为硬上限。

#### Response

```json
{
  "success": true,
  "data": {
    "runId": "run_001",
    "status": "draft",
    "createdAt": "2026-05-29T10:00:00+08:00"
  }
}
```

### GET /api/runs

读取历史试映列表，供 `/runs` 历史页展示。结果按创建时间倒序返回。

#### Query

| 字段 | 说明 |
|---|---|
| limit | 默认 20，最大 100 |
| cursor | 下一页游标；当前实现为 offset cursor，前端不得自行推断语义 |

#### Response

```json
{
  "success": true,
  "data": {
    "runs": [
      {
        "runId": "run_001",
        "status": "audience_ready",
        "title": "这 8 个宝宝用品千万别乱买",
        "coverImageUrl": "/uploads/abc.png",
        "imageUrls": ["/uploads/abc.png"],
        "bodyPreview": "正文前 120 字...",
        "audienceTotal": 30,
        "participantCount": 30,
        "identityReadyCount": 24,
        "journeyCount": 0,
        "hasReport": false,
        "createdAt": "2026-05-29T10:00:00.000Z",
        "startedAt": null,
        "completedAt": null
      }
    ],
    "hasMore": true,
    "nextCursor": 20
  }
}
```

## 5. 启动试映

### POST /api/runs/:runId/start

用户确认观众后把 run 从 `audience_ready` 切换到 `running`，为已确认观众创建 `AgentJourney`（首个 AgentTurn 在 Scheduler admit 时创建），并启动 Agent 级 Scheduler。

#### 工作流说明

1. `POST /api/runs` 创建 run，返回 `runId`，status 为 `draft`。
2. `POST /api/runs/:id/audience-sampling-plan` 创建采样计划后台任务；前端进入同一 workbench，通过 `GET /audience-sampling-plan`、`GET /audience-generation` 和 SSE 观察进度。
3. 后端生成 `AudienceSamplingPlan` 与 `AudienceSamplingDirective`。此时不创建 `AudienceProfile`，用户只审核整场分布、数量和理由。
4. 用户可在 plan 未确认前通过"优化观众分布"对话让 agent 生成结构化修改建议，也可用单组编辑 / 删除按钮精准修改 directive；directive 数量合计会同步为当前 `plan.totalCount`，初始目标人数只作为编辑过程中的参考。
5. `POST /api/runs/:id/audience-sampling-plan/confirm` 确认后锁定 plan，后端自动按 directive 展开 `AudienceProfile`，随后自动生成 `User / Agent / PlatformAccount` 身份。
6. 生成完成后 run 进入 `audience_ready`；用户只在结果层编辑/收藏/删除已生成身份，或重试失败 directive / identity。
7. `POST /api/runs/:id/start` 启动试映，status 变为 `running`；只让 `identity_ready` profile 物化成 `RunParticipant` 入场，start 不再调用 LLM。
8. **无需页面跳转** — 创建、采样计划审核、生成、启动、实时监控全部在同一个 workbench 页面完成。

#### Request

```json
{
  "force": false,
  "allowPartialAudience": true
}
```

#### Response

```json
{
  "success": true,
  "data": {
    "runId": "run_001",
    "status": "running",
    "audienceCount": 24,
    "excludedProfileCount": 6,
    "initialPendingActions": 2,
    "startedAt": "2026-05-29T10:00:05+08:00"
  }
}
```

#### 错误

| code | 说明 |
|---|---|
| RUN_NOT_FOUND | run 不存在 |
| INVALID_RUN_STATUS | run 状态不能启动 |
| NO_READY_AUDIENCES | 没有已生成人设的观众 |
| AUDIENCE_IDENTITY_INCOMPLETE | 还有画像未生成人设，且请求未带 `allowPartialAudience=true` |
| AUDIENCE_GENERATION_ACTIVE | 观众生成任务仍在执行，不能开始试映 |
| CONTENT_INVALID | 内容字段不完整 |
| CONFIG_ERROR | real agent 模型不支持所需能力或调用配置错误 |
| AUDIENCE_GENERATION_FAILED | 观众生成失败 |

## 6. 观众采样计划与生成进度

观众生成使用 plan-first 主流程。前端不能直接创建任意 generation job，也不能通过 profile proposal 接口新增或编辑中间画像。用户先审阅 `AudienceSamplingPlan` 和 `AudienceSamplingDirective`；确认后后端自动执行 profile expansion 与 identity generation。

### POST /api/runs/:runId/audience-sampling-plan

创建或重新生成当前 run 的采样计划。接口立即返回后台 job；真实 provider 通过 `audience.plan.frame` 事件流式推送可展示 preview，计划完整校验并写入正式表后通过 `audience.plan.ready` 事件和 `GET /audience-sampling-plan` 读取 canonical snapshot。

Request：

```json
{
  "replaceActive": true
}
```

Response：

```json
{
  "success": true,
  "data": {
    "runId": "run_001",
    "job": {
      "id": "job_001",
      "scope": "sampling_plan",
      "status": "queued",
      "active": true,
      "targetCount": 30,
      "batchSize": 1
    }
  }
}
```

规则：

- `replaceActive=true` 只允许在未入场阶段使用。
- 若已有 `RunParticipant` 或运行期事实引用，返回 `409 REPLAN_BLOCKED`。
- 替换计划会清理被替换的 plan、directive、AudienceProfile，以及未被运行期引用且未收藏的 run-local identity。
- 不创建 `AudienceProfile`；confirm 前没有具体观众画像。
- `audience.plan.frame` 产生的是生成期 preview，不是正式 `AudienceSamplingPlan`。前端不得基于 preview 调用 confirm、directive CRUD 或 profile 生成接口；只有 `audience.plan.ready` 后才进入可编辑审核态。
- `audience.plan.ready` 必须包含完整正式 `plan` snapshot。前端用 snapshot 覆盖/升级 preview，最终状态以后端 snapshot 为准。

### GET /api/runs/:runId/audience-sampling-plan

读取当前采样计划。

```json
{
  "success": true,
  "data": {
    "runId": "run_001",
    "plan": {
      "planId": "plan_001",
      "runId": "run_001",
      "totalCount": 30,
      "status": "ready_for_review",
      "planMarkdown": "这份采样计划把内容理解为……\n\n观众会按……拉开差异；确认后，人设和试映证据会围绕……展开。",
      "dimensions": ["需求强度", "信任阈值"],
      "confirmedAt": null,
      "directives": [
        {
          "id": "directive_001",
          "sortOrder": 0,
          "name": "核心用户",
          "description": "正在认真评估内容建议是否可信",
          "quantity": 12,
          "diversityAxes": ["预算压力", "家庭分工"],
          "rationale": "核心高需求人群决定收藏、追问和真实转化信号，重点观察是否收藏、追问型号价格、补充真实经验。",
          "expansionStatus": "pending",
          "expansionError": null
        }
      ],
      "validation": {
        "quantityTotal": 30,
        "expectedTotal": 30,
        "isQuantityValid": true,
        "issues": []
      }
    }
  }
}
```

### PATCH /api/runs/:runId/audience-sampling-plan

confirm 前编辑计划展示文本或维度。`planMarkdown` 是采样计划的试映采样设计 brief，负责让用户快速了解系统如何理解内容、为什么这样设计观众、确认后会围绕哪些证据运行试映；它应引用标题、正文、图片或平台上下文里的具体信息点，但不要复述 directive 的名称、人数、描述或差异轴，不用于评价被测内容好坏。结构化事实源是 directive 表；确认计划不得静默改写已有 `planMarkdown`。

### POST /api/runs/:runId/audience-sampling-plan/directives

新增一条采样 directive。

### PATCH /api/runs/:runId/audience-sampling-plan/directives/:directiveId

修改一条采样 directive。

### DELETE /api/runs/:runId/audience-sampling-plan/directives/:directiveId

删除一条采样 directive。

Directive request 字段：

```json
{
  "name": "预算敏感",
  "description": "预算敏感新手爸妈，强需求但谨慎",
  "quantity": 5,
  "diversityAxes": ["预算压力", "信任机制"],
  "rationale": "验证省钱诉求是否成立，重点观察是否追问价格、收藏或质疑证据。",
  "sortOrder": 1
}
```

规则：

- 仅 `ready_for_review` 前可编辑。
- confirm 后返回 `409 PLAN_CONFIRMED`。
- directive 新增、修改或删除后，后端以当前 `sum(directive.quantity)` 同步 `AudienceSamplingPlan.totalCount` 和 `TestRun.audienceCount`；前端可在草稿编辑中显示"当前合计 / 目标人数 / 差额"，但保存后当前合计会成为新的计划总人数。
- Directive 是事实源；不要把 directives 存成 JSON 后再解析。

### POST /api/runs/:runId/audience-sampling-plan/revision-suggestions

为"优化观众分布"弹窗生成可预览的结构化修改建议。该接口只调用 agent 生成 proposal，不修改数据库。

Request：

```json
{
  "messages": [
    {
      "role": "user",
      "visibleText": "把 @核心用户 里的预算敏感人群拆出来",
      "hiddenMentionContexts": [
        {
          "directiveId": "directive_001",
          "label": "核心用户",
          "context": {
            "id": "directive_001",
            "name": "核心用户",
            "description": "强需求、会认真收藏清单的新手爸妈",
            "quantity": 5,
            "diversityAxes": ["预算压力", "家庭决策"],
            "rationale": "验证基本盘收藏和追问意愿。",
            "sortOrder": 0
          }
        }
      ]
    }
  ],
  "latestMessage": {
    "visibleText": "把 @核心用户 里的预算敏感人群拆出来",
    "hiddenMentionContexts": []
  }
}
```

规则：

- 对话历史只用于生成建议，不作为数据库事实源；前端可以仅缓存于弹窗内。
- 前端显示 `@核心用户`，但请求中可以在该消息末尾附带被 @ 分组的完整结构化上下文，供 agent 理解上下文。
- 后端不得信任 `hiddenMentionContexts.context` 作为应用事实；生成建议前应按 `directiveId` 读取当前 plan 下最新 directive，用最新事实覆盖或校验前端上下文。
- 如果 mention 的 `directiveId` 不属于当前未确认 plan，返回 `400 VALIDATION_ERROR`。
- 接口只允许 plan 未 confirmed 且无 active audience generation job 时调用。

Response：

```json
{
  "proposal": {
    "proposalId": "client_or_server_generated_id",
    "summary": "建议将预算敏感用户从核心用户中拆出，新增 2 人分组，并把核心用户从 5 人下调到 3 人。",
    "operations": [
      {
        "operationId": "op_1",
        "op": "add_directive",
        "directive": {
          "name": "预算敏感用户",
          "description": "强需求但价格敏感、会质疑清单是否过度消费的新手爸妈",
          "quantity": 2,
          "diversityAxes": ["预算极紧", "二胎复盘", "家庭共同决策"],
          "rationale": "单独观察是否追问价格、替代品和真实必要性。"
        },
        "reason": "用户希望拆出预算敏感人群单独观察。"
      },
      {
        "operationId": "op_2",
        "op": "update_directive",
        "directiveId": "directive_001",
        "patch": {
          "quantity": 3
        },
        "before": {
          "quantity": 5
        },
        "reason": "新增预算敏感组后，原核心用户保留非极端预算压力的高需求用户。"
      }
    ],
    "totalCountChange": { "before": 12, "after": 12 },
    "warnings": []
  }
}
```

`operations` 是建议卡片的业务事实，不是纯展示文本。前端可用 AI SDK message part / tool result 渲染为卡片；若不接 AI SDK，也必须保留同等结构化数据。

### 应用 revision proposal

应用最新建议卡片中的 operations 时，不允许走 agent 专用写入后门。应用行为必须等价于前端用户调用同一组 directive API：

```text
POST   /api/runs/:runId/audience-sampling-plan/directives
PATCH  /api/runs/:runId/audience-sampling-plan/directives/:directiveId
DELETE /api/runs/:runId/audience-sampling-plan/directives/:directiveId
```

前端建议卡片按 operation 顺序调用上述 API，并把每条调用的成功 / 失败结果渲染回卡片。暂不新增 apply 或 batch API。如果后续实现需要避免重复校验逻辑，应在后端抽公共 domain service 给现有 CRUD 复用，而不是新增一条 agent-only 公开写接口。

每条应用操作都必须满足对应 API 的原有规则：

- 只允许未确认 plan，且当前无 active audience generation job。
- `directiveId` 必须属于当前 plan。
- `add_directive` 和 `update_directive` 后，`name` / `description` / `rationale` 不能为空，`quantity` 必须为正整数，`diversityAxes` 非空。
- `delete_directive` 后至少保留一条 directive。
- 应用成功后同步 `AudienceSamplingPlan.totalCount` 和 `TestRun.audienceCount`，推送 `audience.plan.updated`。
- 应用结果返回每条 operation 的成功 / 失败状态和最新 plan snapshot，前端必须把结果更新到建议卡片。

由于逐条调用不是原子事务，卡片必须清楚展示已成功和失败的 operation，避免用户误以为整组建议已完整应用。失败后，用户可以让 agent 基于最新 plan 继续修正，或用单组编辑按钮精准处理。

### POST /api/runs/:runId/audience-sampling-plan/confirm

确认 plan 并自动创建观众生成 pipeline job。后端按 run 级串行化同一计划的确认请求；并发重复确认时，只允许第一个请求完成确认并创建 active audience generation job，后续请求会在看到已确认 plan 或 active job 后返回 409，不得返回 500 或创建重复 job。后端在同一个 active audience generation job 内流式展开 profile slot，并在 profile 写库后并发生成人设；前端只观察进度。

Profile expansion 按 directive chunk 流式展开。默认 chunk size 为 10，真实 LLM 并发上限当前默认 3。每个 chunk 独立调用 Profile Expander，不向 provider 传入其他 chunks 或 directives 已生成的 `existingProfiles`；跨 directive 去重由采样计划本身和 directive 边界承担。Profile Expander 输出 NDJSON `profile_completed` frame；后端每解析出一个合法 profile 就创建 `AudienceProfile(profile_only)` 并推送前端。单个 directive 最终数量必须等于 `directive.quantity`；失败时标记该 directive failed，重试该 directive 会清理该 directive 下已有 profiles / identities 后重新展开整组。

Identity generation 不等待全部 profile expansion 完成。任意 profile 进入 `profile_only` 后，即可被同一 pipeline job 内的 identity pool 通过数据库状态原子 claim。真实 LLM 并发上限当前默认 10。每个 profile 仍是一次独立 Persona Generator 调用和一次独立事务提交，成功/失败按 profile 推送事件；不得用一次模型调用批量生成多个人设。

Real provider 对非流式 `chat.completions.create` 临时错误做短重试：429 / rate limit、408、5xx、网络超时或连接中断可以按指数退避加 jitter 重试 2-3 次；若响应含 `Retry-After`，优先使用 provider 建议等待时间。该规则当前覆盖 plan revision、seat revision、profile expansion、persona 和 journey action；不覆盖采样计划 streaming 生成和报告生成。结构化输出校验失败、字段缺失、JSON 不可解析等确定性错误不做退避重试，直接进入对应失败路径。

Response：

```json
{
  "success": true,
  "data": {
    "runId": "run_001",
    "job": {
      "id": "job_002",
      "scope": "profile_expansion",
      "status": "queued",
      "active": true,
      "samplingPlanId": "plan_001",
      "targetCount": 30,
      "batchSize": 10
    },
    "progress": {
      "runId": "run_001",
      "planId": "plan_001",
      "status": "expanding_profiles",
      "total": 30,
      "profileCreatedCount": 0,
      "identityReadyCount": 0,
      "identityFailedCount": 0,
      "activeJob": { "id": "job_002", "scope": "profile_expansion", "status": "queued", "active": true },
      "directives": [],
      "profiles": []
    }
  }
}
```

### POST /api/runs/:runId/audience-sampling-plan/clear-audience

已确认 plan 且观众尚未入场时，清空当前已生成的 `AudienceProfile` 与其未被运行期引用的本地 `User / Agent / PlatformAccount`，保留当前 `AudienceSamplingPlan / AudienceSamplingDirective` 结构，并撤销 plan 确认：

- `AudienceSamplingPlan.confirmedAt = null`
- `AudienceSamplingPlan.status = ready_for_review`
- 所有 directive 的 `expansionStatus = pending`
- `TestRun.status = planning_audience`

该接口不调用 LLM、不重新生成采样计划。若已有 active audience generation job，或已有 `RunParticipant` / 运行期引用，返回 409。

Response：

```json
{
  "success": true,
  "data": {
    "runId": "run_001",
    "plan": { "planId": "plan_001", "status": "ready_for_review" },
    "progress": { "runId": "run_001", "status": "ready_for_review", "total": 30, "profiles": [] }
  }
}
```

### GET /api/runs/:runId/audience-generation

读取生成进度和已生成的人设结果。进度按 directive 聚合；`generationStatus / generationError` 表示生成进度来源，不覆盖采样计划 directive 自身的 `expansionStatus / expansionError`。`profiles` 只用于结果页展示和身份维护，不作为第一步审核对象。

```json
{
  "success": true,
  "data": {
    "runId": "run_001",
    "planId": "plan_001",
    "status": "ready_with_failures",
    "total": 30,
    "profileCreatedCount": 30,
    "identityReadyCount": 27,
    "identityFailedCount": 3,
    "activeJob": null,
    "directives": [
      {
        "directiveId": "directive_001",
        "description": "核心用户：...",
        "targetCount": 12,
        "profileCreatedCount": 12,
        "identityReadyCount": 11,
        "identityFailedCount": 1,
        "generationStatus": "ready",
        "generationError": null
      }
    ],
    "profiles": [
      {
        "id": "profile_001",
        "samplingPlanId": "plan_001",
        "samplingDirectiveId": "directive_001",
        "sampleIndex": 0,
        "samplingLabel": "预算敏感准妈妈",
        "demographics": {
          "gender": "female",
          "ageRange": "28-34",
          "cityTier": "二线",
          "lifeStage": "孕晚期",
          "role": "准妈妈",
          "spendingPower": "预算紧"
        },

        "identityStatus": "identity_ready",
        "identity": {
          "user": { "id": "user_001", "nickname": "陈琳", "avatarUrl": null },
          "agent": { "id": "agent_001", "userId": "user_001" },
          "platformAccount": { "id": "platform_001", "userId": "user_001", "platform": "configured-platform" },
          "personaJson": {
            "profile": "...",
            "personality": "...",
            "mbtiType": "ISFJ",
            "responseStyle": "..."
          },
          "favorited": false,
          "saved": false
        }
      }
    ]
  }
}
```

### POST /api/runs/:runId/audience-sampling-plan/directives/:directiveId/retry-expansion

仅允许重试 `expansionStatus=failed` 的 directive。后端清理该 directive 下失败或半残留的 profiles / identities，再创建 `profile_expansion` job。

### POST /api/runs/:runId/audience-generation/retry-identities

重试失败人设。空数组表示重试当前 run 下全部 `identity_failed` profiles；非空数组只允许选择当前 run 下失败 profiles。

```json
{
  "profileIds": []
}
```

### POST /api/runs/:runId/audience-profiles

在已确认分组下新增一个结果层观众。应用成功后创建 `AudienceProfile`，同步对应 `AudienceSamplingDirective.quantity`、`AudienceSamplingPlan.totalCount` 和 `TestRun.audienceCount`，推送 `audience.plan.updated`，并启动 `scope=single_identity` 的人设生成任务。

```json
{
  "directiveId": "...",
  "samplingLabel": "预算敏感准妈妈",
  "demographics": {
    "gender": "female",
    "ageRange": "28-34",
    "cityTier": "二线",
    "lifeStage": "孕晚期",
    "role": "准妈妈",
    "spendingPower": "预算紧"
  }
}
```

### PATCH /api/runs/:runId/audience-profiles/:profileId/identity

编辑已生成的人设身份。仅 `identity_ready` 可用；这是结果层身份维护，不是编辑中间 AudienceProfile。

字段边界：

```text
nickname / avatarUrl -> 更新 User
personaJson.profile / personality / mbtiType / responseStyle -> 更新 Agent
favorited -> 更新 Agent.favoritedAt
PlatformAccount 不接受账号简介、平台标签、平台语气、可见身份等产品编辑字段
```

### POST /api/runs/:runId/audience-profiles/:profileId/identity/regenerate

结果层单个重生人设。仅用于确认 plan 后已展开出的单个 profile，不修改 sampling plan、directive 或 demographics。后端创建 `scope=single_identity` 的 audience generation job；若该 profile 已有完整身份，生成失败时保留原身份，生成成功后替换为新 `User / Agent / PlatformAccount`。

### POST /api/runs/:runId/audience-profiles/:profileId/identity/favorite

收藏或取消收藏人设身份。

```json
{
  "favorited": true
}
```

### DELETE /api/runs/:runId/audience-profiles/:profileId

删除尚未入场的结果层观众。删除后同步对应 `AudienceSamplingDirective.quantity`、`AudienceSamplingPlan.totalCount` 和 `TestRun.audienceCount`，推送 `audience.plan.updated`；Start 默认只纳入仍存在且 `identity_ready` 的 profiles。

### POST /api/runs/:runId/audience-profiles/revision-suggestions

为"打磨观众人设"弹窗生成结果层观众修改建议。该接口只调用 agent 生成 proposal，不修改数据库。

适用阶段：

```text
generating_audience / audience_ready
confirmed plan 之后，start 之前
```

Request：

```json
{
  "messages": [
    {
      "role": "user",
      "visibleText": "把 @核心用户 里表达太像的人拉开一点，@陈琳 可以更理性一些",
      "hiddenMentionContexts": [
        {
          "kind": "directive",
          "directiveId": "directive_001",
          "label": "核心用户",
          "context": {
            "directive": {},
            "profiles": [],
            "counts": {
              "target": 5,
              "identityReady": 4,
              "identityFailed": 1,
              "missing": 0
            }
          }
        },
        {
          "kind": "profile",
          "profileId": "profile_001",
          "label": "陈琳",
          "context": {
            "samplingLabel": "预算敏感准妈妈",
            "demographics": {},

            "identityStatus": "identity_ready",
            "user": { "nickname": "陈琳", "avatarUrl": null },
            "personaJson": {
              "profile": "...",
              "personality": "...",
              "mbtiType": "ISFJ",
              "responseStyle": "..."
            },
            "favorited": false
          }
        }
      ]
    }
  ]
}
```

Response：

```json
{
  "proposal": {
    "summary": "建议把陈琳调成更理性的价格 / 证据判断型观众，并重生另一位表达相近的观众。",
    "operations": [
      {
        "operationId": "op_1",
        "op": "update_identity",
        "profileId": "profile_001",
        "patch": {
          "personaJson": {
            "profile": "...",
            "personality": "...",
            "mbtiType": "INTJ",
            "responseStyle": "..."
          }
        },
        "before": {},
        "reason": "用户希望该观众更理性，且和同组其他观众拉开。"
      },
      {
        "operationId": "op_2",
        "op": "regenerate_identity",
        "profileId": "profile_002",
        "reason": "该观众和同组另一位表达风格过近。"
      }
    ],
    "warnings": []
  }
}
```

规则：

- 对话历史只缓存在前端；接口不保存 chat。
- 后端生成建议前必须按 `profileId` / `directiveId` 读取当前 DB 最新结果层事实，不能信任 hidden context 作为应用事实。
- 结果层新增观众会同步 `AudienceSamplingDirective.quantity`、`AudienceSamplingPlan.totalCount` 和 `TestRun.audienceCount`；修改人群定义和重新规划整场分布仍属于未确认 plan 阶段。
- 支持的可应用 operation 必须能映射到普通用户 API：`POST /audience-profiles`、`PATCH /audience-profiles/:profileId/identity`、`POST /identity/regenerate`、`POST /identity/favorite`、`DELETE /audience-profiles/:profileId`、`POST /audience-generation/retry-identities`。
- `add_profile` 表示新增一个采样 slot 并启动单个人设生成任务；请求体使用 `samplingLabel` 和 `demographics`。

### 应用 audience profile revision proposal

前端建议卡片按 operation 顺序直接调用现有结果层 API，并把每条 operation 的成功 / 失败状态渲染回卡片。不要新增 apply 或 batch API，不允许 agent-only 写库路径。

## 7. 获取 run 概览

### GET /api/runs/:runId

`status` 取值：`draft` | `planning_audience` | `generating_audience` | `audience_ready` | `running` | `pausing` | `paused` | `report_generating` | `completed`

#### Response

```json
{
  "success": true,
  "data": {
    "runId": "run_001",
    "status": "running",
    "mode": "single",
    "contentVersion": {
      "id": "version_a",
      "title": "这 8 个宝宝用品千万别乱买",
      "coverImageUrl": "https://cdn.example.com/assets/abc123.png",
      "imageUrls": [
        "https://cdn.example.com/assets/abc123.png",
        "https://cdn.example.com/assets/detail456.png"
      ],
      "bodyText": "完整正文，供工作台恢复、观众生成预览和试映现场使用。",
      "bodyPreview": "正文前 120 字..."
    },
    "progress": {
      "audienceTotal": 30,
      "journeyFinishedCount": 12,
      "journeyFailedCount": 1,
      "currentSimulatedTime": 356
    },
    "clock": {
      "serverNow": "2026-05-29T10:00:40+08:00",
      "clockElapsedMs": 356000,
      "clockAnchorAt": "2026-05-29T10:00:05+08:00",
      "clockScale": 10
    },
    "latestLiveEventSequence": "42",
    "createdAt": "2026-05-29T10:00:00+08:00",
    "startedAt": "2026-05-29T10:00:05+08:00",
    "completedAt": null,
    "terminalReason": null
  }
}
```

`latestLiveEventSequence` 是该 run 当前 `live_events` 表中最大的 `sequence` 字符串，用于前端首次连接 SSE 时跳过历史事件重放。无事件时为 `null`。

## 8. 实时事件流（SSE）

### GET /api/runs/:runId/events

SSE 端点，推送 run 的所有实时事件。这是唯一的实时通信方式，不使用 WebSocket 或轮询。

#### 请求 Header 与 Query

```http
Accept: text/event-stream
Last-Event-ID: 42          # 可选，live_events.sequence 字符串
```

```text
GET /api/runs/:runId/events?after=42        # 可选，query 参数，live_events.sequence 字符串
GET /api/runs/:runId/events?liveOnly=true   # 可选，跳过"无游标时的初始历史重放"
```

`Last-Event-ID` header 与 `after` query 任一存在时，按 `Last-Event-ID` > `after` > undefined 解析为游标 `afterSequence`，并 replay 该游标之后的所有持久化事件。

`liveOnly=true` 仅在"无游标"（既没有 `Last-Event-ID` 也没有 `after`）时跳过初始历史重放，只推送连接建立后的新事件；用于只关心实时更新、不关心历史的订阅者（例如报告页 `useReportEvents` hook：报告数据在挂载时通过 REST 拉取，只需订阅后续的 `report.regenerated` 事件）。

如果 `liveOnly=true` 同时带了游标（典型场景：浏览器 EventSource 断线重连时自动带上 `Last-Event-ID`），服务端**仍然会** replay 游标之后的持久化事件，以补偿断线期间丢失的事件。`liveOnly` 永远不会抑制游标驱动的 replay。

#### 响应 Header

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

#### Event 格式

```text
id: 42
event: post_state.updated
data: {"eventId":"42","runId":"run_001",...}
```

所有事件的 SSE `id:` 必须使用 `String(live_events.sequence)`。payload 中的 `eventId` 同样使用该 sequence 字符串：

```json
{
  "eventId": "42",
  "type": "post_state.updated",
  "runId": "run_001",
  "contentVersionId": "version_a",
  "simulatedTime": 42,
  "createdAt": "2026-05-29T10:00:10+08:00"
}
```

#### 事件类型完整清单

当前 `LiveEventType` 必须与 `packages/shared/src/live-events.ts` 保持一致：

```text
post_state.updated
comments.page_loaded
comment.created
comment.updated
action_log.created
summary.updated
insight.created
audience.status_updated
audience.action_happened
audience.generation.job.started
audience.generation.job.completed
audience.generation.job.failed
audience.generation.job.canceled
audience.plan.started
audience.plan.reasoning.delta
audience.plan.progress
audience.plan.frame
audience.plan.ready
audience.plan.updated
audience.plan.confirmed
audience.plan.failed
audience.profile.expansion.started
audience.profile.expansion.ready
audience.profile.expansion.directive_started
audience.profile.expansion.directive_ready
audience.profile.expansion.directive_failed
audience.profile.created
audience.identity.started
audience.identity.ready
audience.identity.failed
audience.updated
run.clock.updated
run.started
run.pausing
run.paused
run.resumed
run.completed
run_log.created
report.regenerated
```

#### 断线重连机制

客户端断线后重新连接时，通过 `Last-Event-ID` 请求头告知服务端最后收到的事件 ID。服务端从 `live_events` 表中查询该 ID 之后的所有事件并依次推送，完成追赶（catch-up）后切换为实时推送。

首次连接时，前端可通过 `GET /api/runs/:runId` 获取 `latestLiveEventSequence`，以 `?after=<sequence>` 参数连接 SSE，跳过历史事件重放，避免旧事件（如已处理的 `audience.generation.job.failed`）重复触发 toast。

```text
首次连接 → ?after=42 → 从 sequence > 42 的事件开始推送（跳过历史）
客户端重连 → Last-Event-ID: 15 → 从 sequence > 15 的事件开始推送
无 cursor → 从头推送所有历史事件
```

> **live_events 表**：所有 SSE 事件持久化到 `live_events` 表，包含 `id`、`run_id`、`event_type`、`payload`、`sequence`、`created_at`。`id` 是数据库 UUID 主键；SSE `id:` 和 payload `eventId` 使用 `String(sequence)`。

> **audience.plan.reasoning.delta 已抑制**：该事件为高频 debug 推理片段，当前实现不写入 `live_events`，也不在主 `/events` SSE 通道发送。`live_events` 是持久化可回放流，不含 token 级 debug trace。依赖 reasoning delta 做状态恢复的前端逻辑不可用；`audience.plan.frame` 和 `audience.plan.progress` 仍按原逻辑持久化和推送。

## 9. SSE 事件 payload 结构

### 9.0 audience.plan.reasoning.delta（已抑制）

`audience.plan.reasoning.delta` 当前为 no-op：不写入 `live_events`，不通过主 `/events` SSE 通道推送。该事件为高频 debug 推理片段，`live_events` 的 sequence 语义不适合承载此类瞬时 trace。`audience.plan.frame` 和 `audience.plan.progress` 仍正常持久化和推送。未来若需要调试推理流，应通过独立 debug 通道实现，不依赖 `live_events` 回放。

### 9.0.1 audience.plan.progress

`progress` 使用 shared `AudiencePlanProgressEvent` 契约：

```json
{
  "eventId": "41",
  "type": "audience.plan.progress",
  "runId": "run_001",
  "jobId": "job_001",
  "progress": {
    "stage": "quantities",
    "label": "人数分配",
    "detail": "已为 4 个分组分配人数",
    "directiveCount": 4,
    "quantityTotal": 12,
    "targetCount": 12
  }
}
```

`stage` 只允许 `model_request | public_reasoning | dimensions | directives | quantities | plan_summary`。

`audience.plan.progress` 提供模型生成过程的辅助进度信息。采样计划审阅区的结构化预览以 `audience.plan.frame.preview` 为准。

### 9.0.2 audience.plan.frame

`audience.plan.frame` 是采样计划生成的结构化流式预览事件。事件必须持久化到 `live_events`，支持 Last-Event-ID 回放。它不是正式计划事实；正式事实仍以 `audience.plan.ready` 和 `GET /audience-sampling-plan` 返回的 `AudienceSamplingPlanView` 为准。

```json
{
  "eventId": "43",
  "type": "audience.plan.frame",
  "runId": "run_001",
  "jobId": "job_001",
  "frameIndex": 7,
  "frame": {
    "type": "directive_patch",
    "key": "d2",
    "patch": {
      "name": "谨慎新手",
      "quantity": 4
    }
  },
  "preview": {
    "planMarkdown": "这次试映会围绕……",
    "dimensions": [
      { "key": "trust", "label": "信任阈值" }
    ],
    "directives": [
      {
        "key": "d2",
        "sortOrder": 1,
        "status": "streaming",
        "name": "谨慎新手",
        "quantity": 4
      }
    ],
    "quantityTotal": 4,
    "targetCount": 12,
    "completed": false,
    "validationIssues": []
  }
}
```

支持的 frame 类型：

```ts
type AudiencePlanFrame =
  | { type: "plan_markdown_delta"; text: string }
  | { type: "dimension_upsert"; key: string; label: string }
  | { type: "directive_started"; key: string; sortOrder: number }
  | { type: "directive_patch"; key: string; patch: {
      name?: string;
      description?: string;
      quantity?: number;
      diversityAxes?: string[];
      rationale?: string;
    } }
  | { type: "directive_completed"; key: string }
  | { type: "plan_completed"; totalCount: number }
  | { type: "parser_error"; line: string; message: string }
  | { type: "validation_issue"; key?: string; message: string };
```

preview directive 状态：

```ts
type AudiencePlanPreviewDirectiveStatus = "streaming" | "complete" | "invalid";
```

规则：

- 模型输出协议是 NDJSON，一行一个 JSON frame；后端只解析完整行。
- `key` 是生成期稳定 key，不是数据库 id。`audience.plan.ready` 后由正式 `directive.id` 接管。
- `plan_markdown_delta` 追加到 preview 的 `planMarkdown`。
- `directive_completed` 只有在对应 directive 已具备 `name / description / quantity / diversityAxes / rationale` 且字段合法时，preview 才标记为 `complete`；否则标记为 `invalid` 并记录 `validation_issue`。
- `plan_completed` 后，后端编译 canonical draft；校验通过才写入正式表并发送 `audience.plan.ready`。
- `parser_error` 和 `validation_issue` 用于可视化生成问题和调试，不得创建正式 plan。
- 如果客户端漏收 frame 或 SSE 断线，按普通 `live_events.sequence` 回放恢复 preview；如果模型流本身缺帧、坏帧或最终校验失败，整个 `sampling_plan` job 失败，前端展示错误并让用户重新生成整份计划，不做局部续写。

### 9.1 post_state.updated

```json
{
  "eventId": "42",
  "type": "post_state.updated",
  "runId": "run_001",
  "contentVersionId": "version_a",
  "simulatedTime": 42,
  "postState": {
    "exposureCount": 12,
    "openCount": 8,
    "likeCount": 3,
    "favoriteCount": 5,
    "commentCount": 2,
    "shareCount": 0,
    "exitCount": 1
  }
}
```

### 9.2 comments.page_loaded

```json
{
  "eventId": "43",
  "type": "comments.page_loaded",
  "runId": "run_001",
  "contentVersionId": "version_a",
  "simulatedTime": 48,
  "page": {
    "journeyId": "journey_001",
    "audienceName": "陈琳",
    "cursor": null,
    "nextCursor": "eyJzaW11bGF0ZWRUaW1lIjo0OH0",
    "hasMore": true,
    "sort": "latest",
    "comments": [
      {
        "id": "comment_seed_001",
        "audienceName": "路人A",
        "commentText": "这个有具体型号吗",
        "parentCommentId": null,
        "rootCommentId": "comment_seed_001",
        "mentionedAudienceIds": [],
        "mentionedCommentIds": [],
        "createdAt": "2026-05-29T10:00:09+08:00"
      }
    ]
  }
}
```

### 9.3 comment.created

```json
{
  "eventId": "44",
  "type": "comment.created",
  "runId": "run_001",
  "contentVersionId": "version_a",
  "simulatedTime": 55,
  "comment": {
    "id": "comment_001",
    "audienceName": "陈琳",
    "segment": "核心用户",
    "commentText": "蹲一个具体型号，别又是广吧",
    "parentCommentId": null,
    "rootCommentId": "comment_001",
    "mentionedAudienceIds": [],
    "mentionedCommentIds": []
  }
}
```

### 9.4 comment.updated

`comment.updated` 是评论热度字段 patch 事件。前端只能按 `commentId` 更新 `patch` 中出现的字段；不得把该事件当成完整评论对象覆盖本地评论。

```json
{
  "eventId": "45",
  "type": "comment.updated",
  "runId": "run_001",
  "contentVersionId": "version_a",
  "simulatedTime": 58,
  "commentId": "comment_001",
  "patch": {
    "likeCount": 3,
    "replyCount": 1
  }
}
```

### 9.5 action_log.created

该事件保留为证据链事件。现场页主 UI 不再将行动日志作为常驻中栏展示；前端应将其写入观众详情、洞察详情、最终报告证据链或调试视图。

```json
{
  "eventId": "46",
  "type": "action_log.created",
  "runId": "run_001",
  "contentVersionId": "version_a",
  "simulatedTime": 61,
  "log": {
    "id": "log_001",
    "participantId": "participant_001",
    "audienceName": "陈琳",
    "segment": "核心用户",
    "action": "thought",
    "text": "标题里的"避坑"吸引我，封面看起来像真实整理，但我也有点担心是不是广告。"
  }
}
```

### 9.6 audience.status_updated

用于更新 AI 观众席状态矩阵。

```json
{
  "eventId": "47",
  "type": "audience.status_updated",
  "runId": "run_001",
  "contentVersionId": "version_a",
  "participantId": "participant_001",
  "simulatedTime": 62,
  "status": "watching",
  "currentAction": "正在阅读正文"
}
```

`status` 取值：

```text
not_started
entered
watching
hesitating
viewing_comments
liked
favorited
commented
skipped
finished
failed
```

### 9.7 audience.action_happened

用于触发观众席与模拟帖子之间的关键行为联动。普通阅读、普通等待等高频低价值动作可以不触发显著动画。

```json
{
  "eventId": "47",
  "type": "audience.action_happened",
  "runId": "run_001",
  "contentVersionId": "version_a",
  "participantId": "participant_001",
  "simulatedTime": 65,
  "action": "favorite_post",
  "animationHint": "star",
  "text": "陈琳收藏了这篇内容"
}
```

`action` 取值（与 `packages/shared` 中 `AudienceActionHappenedPayload.action` 一致，共 8 个）：

```text
open_post
read_post
like_post
favorite_post
share_post
write_comment
like_comment
exit_browsing
```

`animationHint` 取值：

```text
heart
star
comment
risk
skip
none
```

`animationHint` 映射规则：

```text
open_post       → "none"
read_post       → "none"
like_post       → "heart"
favorite_post   → "star"
share_post      → "none"
write_comment   → "comment"
like_comment    → "heart"
exit_browsing   → "skip"（exit_outcome = skipped）
                  "risk"（exit_outcome = risk_exit）
                  "none"（exit_outcome = browsed_and_left / max_steps）
```

### 9.8 summary.updated

```json
{
  "eventId": "48",
  "type": "summary.updated",
  "runId": "run_001",
  "contentVersionId": "version_a",
  "simulatedTime": 80,
  "summary": {
    "audienceTotal": 30,
    "reachedCount": 18,
    "openedCount": 13,
    "finishedCount": 7,
    "likedCount": 4,
    "favoritedCount": 8,
    "commentedCount": 3,
    "trustConcernCount": 6,
    "adConcernCount": 4,
    "questionCount": 3
  }
}
```

### 9.9 insight.created

```json
{
  "eventId": "49",
  "type": "insight.created",
  "runId": "run_001",
  "contentVersionId": "version_a",
  "simulatedTime": 120,
  "insight": {
    "id": "insight_001",
    "level": "risk",
    "title": "广告感风险上升",
    "evidence": "已有 4 位观众提到像软广或追问具体品牌来源。",
    "relatedAudienceIds": ["aud_001", "aud_006"],
    "relatedCommentIds": ["comment_001"]
  }
}
```

### 9.10 run.clock.updated

run 时钟校准事件。所有 `clockAnchorAt` 变化、时钟冻结或归零都必须推送该事件，包括开始、继续、真正暂停、自然结束进入报告生成、报告完成、reset、retry 和错误冻结。生命周期事件只负责 UI 状态语义，不负责 HUD 时间校准。

```json
{
  "eventId": "49",
  "type": "run.clock.updated",
  "runId": "run_001",
  "reason": "report_started",
  "status": "report_generating",
  "clock": {
    "serverNow": "2026-05-29T10:03:41.000Z",
    "clockElapsedMs": 720000,
    "clockAnchorAt": null,
    "clockScale": 10
  }
}
```

`reason` 取值：

`started` | `resumed` | `paused` | `report_started` | `completed` | `reset` | `retry_started` | `error_frozen`

前端收到后必须用完整 `clock` 覆盖本地 `runClock`；`clockAnchorAt !== null` 时继续插值，`null` 时停止计时。不要用 `simulatedTime` 秒数重建时钟。

### 9.11 run.completed

`reportId` 是内部报告产物 ID，用于调试和证据追踪。前端进入报告页和获取报告时仍使用 `runId`：`/reports/:runId`、`GET /api/runs/:runId/report`。

```json
{
  "eventId": "50",
  "type": "run.completed",
  "runId": "run_001",
  "contentVersionId": "version_a",
  "simulatedTime": 720,
  "reportId": "report_001"
}
```

### 9.12 系统异常暂停

run 级异常不使用 `failed` 终态。自动重试耗尽后，后端应先冻结 clock 并推送 `run.clock.updated(reason="error_frozen")`，再将 run 置为 `paused`，写入 `errorMessage`，并推送 `run.paused`。用户可选择修改配置后继续、结束并生成报告，或通过重试接口处理局部失败。

```json
{
  "eventId": "51",
  "type": "run.paused",
  "runId": "run_001",
  "reason": "system_error",
  "error": {
    "code": "REPORT_GENERATION_FAILED",
    "message": "报告生成失败，已重试 3 次"
  }
}
```

## 10. 获取模拟帖子状态

### GET /api/runs/:runId/post-state

V1 固定一个 run 只有一个 content version。服务端必须先通过 `runId` 解析唯一 `contentVersionId`，再读取该内容版本的帖子状态；不得直接按 `runId` 查询帖子状态。

```json
{
  "success": true,
  "data": {
    "runId": "run_001",
    "contentVersionId": "version_a",
    "postState": {
      "exposureCount": 30,
      "openCount": 22,
      "likeCount": 8,
      "favoriteCount": 13,
      "commentCount": 9,
      "shareCount": 0,
      "exitCount": 4,
      "likedByMe": false,
      "favoritedByMe": true,
      "sharedByMe": false
    }
  }
}
```

## 11. 获取评论区

### GET /api/runs/:runId/comments

`limit` 默认 10，最大 100。`cursor` 为服务端返回的 opaque keyset cursor，不是 offset；前端继续加载更早评论时必须原样带回。`sort=latest` 按最新评论优先返回，`sort=hot` 按 `likeCount`、`replyCount`、时间倒序返回，`sort=time` 按模拟时间升序返回。该接口用于前端展示评论区；Agent 的 `view_comments` 工具复用同一分页逻辑，默认按 10 条一页加载。

服务端必须先解析 run 的唯一 `contentVersionId`，并只返回该内容版本下的评论、回复和当前用户点赞状态。

普通评论列表 `CommentItem` 不包含 `intent`。评论意图只来自 Agent `write_comment` 工具输出，并仅投影到 `GET /api/runs/:runId/audiences/:participantId` 的 `comments[].intent`，供观众详情、证据链和报告层使用。前端用户评论不提交、也不统计 `intent`。

```json
{
  "success": true,
  "data": {
    "comments": [
      {
        "id": "comment_001",
        "audienceName": "陈琳",
        "segment": "核心用户",
        "commentText": "蹲一个具体型号，别又是广吧",
        "parentCommentId": null,
        "rootCommentId": "comment_001",
        "mentionedAudienceIds": [],
        "mentionedCommentIds": [],
        "likeCount": 0,
        "replyCount": 2,
        "intent": "doubt",
        "simulatedTime": 55,
        "createdAt": "2026-05-29T10:00:10+08:00"
      }
    ],
    "hasMore": true,
    "nextCursor": null
  }
}
```

## 12. 删除 run

### DELETE /api/runs/:runId

硬删除某次试映。该接口用于历史试映管理页，不做软删除。

删除规则：

```text
1. status = running / pausing / report_generating 时拒绝删除。
2. 存在 active audience generation job 时拒绝删除。
3. 删除 test_runs 后由数据库外键级联删除该 run 拥有的 content_versions、profiles、groups、participants、generation jobs、journeys、actions、tool calls、events、logs、reports 等数据。
4. content_version_images 记录随 content version 删除；本地 asset 仅在不再被任何 content version 引用时删除 asset 记录和 uploads 文件。
5. `Agent.retentionPolicy = delete_with_origin_run` 的 user / agent / platform_account 在无其他引用且 `favoritedAt` 为空时清理；`retain` 或已收藏身份不因删除 run 被删除。
6. 外部图片 URL 和收藏身份不由该接口删除。
```

#### Response

```json
{
  "success": true,
  "data": {
    "runId": "run_001",
    "deleted": true
  }
}
```

#### 错误

| code | HTTP | 说明 |
|---|---:|---|
| RUN_NOT_FOUND | 404 | run 不存在 |
| INVALID_RUN_STATUS | 409 | 当前 run 状态或 active generation job 不允许删除 |

## 13. 统一帖子互动 API

以下 API 供前端用户操作使用；Agent 工具不通过 HTTP 调用，但必须调用同一 runtime service。

所有帖子互动 API 都必须先解析 run 的唯一 `contentVersionId`，再写入内容事实表。`social_interaction_events`、`social_reactions`、`simulated_post_states` 均以 `contentVersionId` 为内容归属边界，不以 `runId` 作为内容事实 owner。

### POST /api/runs/:runId/post/open

记录前端用户点开帖子。对应 Agent 工具 `open_post` 的底层 service。

### POST /api/runs/:runId/post/like

幂等点赞帖子。重复请求返回当前状态，不重复增加 `likeCount`。

### POST /api/runs/:runId/post/favorite

幂等收藏帖子。重复请求返回当前状态，不重复增加 `favoriteCount`。

### POST /api/runs/:runId/post/share

记录前端用户分享意图。分享是事件型行为，不提供取消；同一前端用户对同一内容版本重复分享应幂等返回当前状态，不重复增加 `shareCount`。Agent 工具调用也复用同一 runtime service，因此同一 Agent 重复分享同一内容不应重复增加计数。

统一返回。`active` 仅在 like / favorite 接口返回。`postState` 会携带当前前端用户对该帖子的 `likedByMe` / `favoritedByMe` / `sharedByMe` 状态，用于前端恢复按钮激活态：

```json
{
  "success": true,
  "data": {
    "postState": {
      "openCount": 12,
      "likeCount": 8,
      "favoriteCount": 4,
      "commentCount": 9,
      "shareCount": 1,
      "exitCount": 2,
      "likedByMe": true,
      "favoritedByMe": false,
      "sharedByMe": true
    },
    "simulatedTime": 55
  }
}
```

## 14. 统一评论互动 API

### POST /api/runs/:runId/comments

前端用户发表评论。对应 Agent 工具 `write_comment` 的底层 service。

评论、回复和评论点赞均作用于 run 的唯一 `contentVersionId`。回复或点赞目标评论如果不属于该 content version，返回目标不存在，不允许跨内容版本操作。

```json
{
  "content": "蹲一个具体型号",
  "intent": "ask",
  "replyToCommentId": null
}
```

`content` 最大 200 字符（`packages/shared` 中 `MAX_COMMENT_LENGTH` 常量，`write_comment` Agent 工具和前端评论 API 共用）。

`intent` 标记评论意图，用于结构化分类，方便报告统计。Agent 工具 `write_comment` 中 `intent` 必填，缺失返回 `comment_intent_required`；前端评论 API 不传时默认 `agree`。主评论区不展示 `intent`，仅用于观众详情、证据链和报告层。

### POST /api/runs/:runId/comments/:commentId/replies

前端用户回复评论。回复暂时可以不在 UI 中开放，但 service 和 API 需作为目标架构保留。

```json
{
  "content": "同问，想知道价格区间",
  "intent": "ask"
}
```

### POST /api/runs/:runId/comments/:commentId/like

幂等设置评论点赞状态。对应 `CommentService.likeComment`，维护 `social_reactions` 和 `simulated_comments.like_count`。

请求体：

```json
{
  "active": true
}
```

`active=true` 表示点赞，重复请求不重复增加计数；`active=false` 表示取消点赞，重复请求不重复扣减计数。

统一返回：

```json
{
  "success": true,
  "data": {
    "comment": {
      "id": "comment_001",
      "audienceName": "陈琳",
      "segment": "核心用户",
      "commentText": "蹲一个具体型号，别又是广吧",
      "parentCommentId": null,
      "rootCommentId": "comment_001",
      "likeCount": 3,
      "likedByMe": true,
      "replyCount": 2,
      "intent": "doubt",
      "simulatedTime": 55,
      "createdAt": "2026-06-03T10:00:00.000Z"
    }
  }
}
```

### 14.1 评论 intent 枚举

`intent` 取值与 `packages/shared` 中 `CommentIntentSchema` 一致：

```text
ask              提问
doubt            质疑
share_experience 补充个人经验
agree            认同/共鸣
joke             梗/调侃
pushback         反驳/不同意
```

`intent` 不影响评论内容生成，也不在主评论区展示；它只作为结构化标签，供观众详情抽屉、证据链和报告层统计使用。评论正文仍由 Agent 根据 persona 自然生成，或由前端用户直接输入。前端评论 API 不提交 `intent`，因此前端用户评论不会有该字段。

## 15. 获取行动日志

### GET /api/runs/:runId/logs

Query 示例：`limit=100&cursor=xxx`

该接口用于观众详情、洞察详情、最终报告证据链和调试视图。现场页不应把它渲染成常驻主区域日志列表。

```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "log_001",
        "turnId": "turn_001",
        "simulatedTime": 3,
        "audienceName": "陈琳",
        "segment": "核心用户",
        "text": "标题里的"避坑"吸引我，封面看起来像真实整理，但我也有点担心是不是广告。",
        "action": "thought"
      }
    ],
    "nextCursor": null
  }
}
```

## 16. 获取运行日志

### GET /api/runs/:runId/run-logs

Query 示例：`logType=generation&limit=50&order=desc&cursor=xxx`

该接口返回 run 级别运行日志，用于现场页右侧 Runtime Dock。它和行动日志不同：`/logs` 记录观众心路历程与工具行为证据，`/run-logs` 记录观众生成、运行控制、调度解释和异常提示。

`logType` 可选；`limit` 默认 50，最大 200；`order` 可选 `asc` / `desc`，默认 `asc`；`cursor` 是服务端返回的不透明分页游标，前端不得自行构造。现场页日志栏使用 `order=desc` 先展示最新日志，向下滚动时用 `nextCursor` 自动加载更早日志；SSE 推送的新日志继续合并到当前列表。

```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "run_log_001",
        "logType": "generation",
        "message": "本批 5 人已就绪，剩余 7 人待生成",
        "participantId": null,
        "metadata": {},
        "simulatedTime": 42,
        "createdAt": "2026-05-29T10:00:10+08:00"
      }
    ],
    "hasMore": true,
    "nextCursor": "eyJzaW11bGF0ZWRUaW1lIjo0MiwiY3JlYXRlZEF0IjoiMjAyNi0wNS0yOVQwMjowMDoxMC4wMDBaIiwiaWQiOiJydW5fbG9nXzAwMSJ9"
  }
}
```

## 17. 获取 AI 观众席

### GET /api/runs/:runId/audience-seats

该接口返回前端渲染 AI 观众席状态矩阵所需的派生模型。服务端可以从 `run_participants`、`users`、`platform_accounts`、`journeys`、`social_interaction_events`、`social_reactions`、`simulated_comments` 和 `action_logs` 派生，不要求新增核心事实表。

该接口是 run 级视图，但其中的互动、评论、行动日志证据必须使用该 run 的唯一 `contentVersionId` 过滤。V1 不支持一个 run 多内容版本的观众席聚合。

```json
{
  "success": true,
  "data": {
    "seats": [
      {
        "participantId": "participant_001",
        "actorUserId": "user_001",
        "agentId": "agent_001",
        "platformAccountId": "pa_xhs_001",
        "name": "陈琳",
        "avatarUrl": null,
        "segment": "新手妈妈",
        "personaSummary": "谨慎型新手妈妈，关注真实避坑经验和具体型号",
        "status": "favorited",
        "currentAction": "看评论",
        "hasOpened": true,
        "hasLiked": false,
        "hasFavorited": true,
        "hasShared": false,
        "hasCommented": true,
        "hasSkipped": false,
        "hasDoubt": true,
        "lastObservableLog": "收藏了帖子，并追问具体型号",
        "lastUpdatedSimulatedTime": 65
      }
    ],
    "summary": {
      "total": 30,
      "activeCount": 18,
      "commentedCount": 5,
      "favoritedCount": 7,
      "skippedCount": 4,
      "doubtCount": 3,
      "finishedCount": 9
    }
  }
}
```

## 18. 参与者 API

### GET /api/runs/:runId/participants

获取全部 run participants 列表。该列表只包含已 start 后从 `identity_ready` profile 物化出的入场快照，供现场页观众席、列表视图和详情入口使用。

```json
{
  "success": true,
  "data": {
    "participants": [
      {
        "participantId": "participant_001",
        "actorUserId": "user_agent_001",
        "agentId": "agent_001",
        "platformAccountId": "pa_xhs_001",
        "displayName": "陈琳",
        "avatarUrl": "/uploads/avatar_001.png",
        "status": "active",
        "journeyStatus": "active"
      }
    ]
  }
}
```

### GET /api/runs/:runId/participants/:participantId

该接口用于观众详情抽屉，返回 persona、旅程、时间线、互动和评论证据。

```json
{
  "success": true,
  "data": {
    "participantId": "participant_001",
    "actorUserId": "user_agent_001",
    "agentId": "agent_001",
    "platformAccountId": "pa_xhs_001",
    "avatarUrl": "/uploads/avatar_001.png",
    "persona": {
      "name": "陈琳",
      "segment": "新手妈妈",
      "profile": "31 岁一胎新手妈妈，住新一线城市，近期在控制预算但愿意为确定性付费。",
      "personality": "谨慎务实，风险规避倾向强，愿意听同阶段用户经验但不轻易被种草。",
      "mbtiType": "ISFJ",
      "responseStyle": "通常相信真实经历、价格明细和具体型号；有用会收藏，遇到不确定信息会看评论或追问来源，评论表达口语化且问题具体。"
    },
    "journey": {
      "status": "finished",
      "currentStep": 6,
      "finalSummary": "认为内容有收藏价值，但仍需要具体型号和购买渠道",
      "exitOutcome": "browsed_and_left",
      "exitReason": "观众没有更多动作，结束浏览。",
      "exitReasonCategory": "no_more_action",
      "exitReadingDepth": "partial",
      "exitInterestLevel": "medium",
      "exitTrustLevel": "medium"
    },
    "timeline": [
      {
        "id": "log_001",
        "simulatedTime": 3,
        "action": "open_post",
        "kind": "tool_call",
        "data": {
          "toolName": "open_post",
          "input": {},
          "output": { "postId": "cv_001", "transition": "post_detail_observed" }
        },
        "observableLog": "被标题里的避坑吸引后点开帖子",
        "innerReaction": "想确认是否有具体清单"
      }
    ],
    "interactions": [
      {
        "type": "favorite_post",
        "simulatedTime": 65,
        "reason": "内容有复看价值"
      }
    ],
    "comments": [
      {
        "commentText": "蹲一个具体型号，别又是广吧",
        "commentType": "question",
        "sentiment": "cautious",
        "riskTag": "ad_concern",
        "intent": "doubt"
      }
    ]
  }
}
```

`journey` 中的 exit 结构化字段仅在 `exit_browsing` 已执行时存在，由 `exit_browsing` 工具参数写入：

```text
exitOutcome          系统归类的粗粒度离开结果：skipped | browsed_and_left | risk_exit | max_steps
exitReason           人类可读离开摘要
exitReasonCategory   离开原因分类（来自 exit_browsing.reasonCategory）
exitReadingDepth     离开时阅读深度（来自 exit_browsing.readingDepth）
exitInterestLevel    离开时兴趣水平（来自 exit_browsing.interestLevel）
exitTrustLevel       离开时信任水平（来自 exit_browsing.trustLevel）
```

`exitReasonCategory` 取值：`not_relevant | not_interested | low_trust | too_ad_like | content_too_long | need_more_evidence | finished_normally | no_more_action`

`exitReadingDepth` 取值：`feed_only | skimmed | partial | full`（feed 阶段只能 `feed_only`，post 阶段不能 `feed_only`）

`exitInterestLevel` / `exitTrustLevel` 取值：`low | medium | high`

`comments[].intent` 取值见第 14.1 节评论 intent 枚举。

## 19. 获取洞察

### GET /api/runs/:runId/insights

```json
{
  "success": true,
  "data": {
    "insights": [
      {
        "id": "insight_001",
        "level": "risk",
        "title": "广告感风险上升",
        "evidence": "4 位观众提到像软广。",
        "simulatedTime": 120
      }
    ]
  }
}
```

## 20. 获取报告

> **备注**：当前版本 ReportView 不包含 `audienceModel`、`reportModel`、`runMetadata` 等模型拆分字段。报告底部只展示 `model`、`promptVersion`、`createdAt`、`runId`。模型拆分和 token 用量追踪作为未来路线，暂未公开。

> **指标口径**：当前开发阶段不兼容旧报告 JSON，旧报告需删除或重生成。`ReportOutput.funnel` 主指标使用按 participant 去重的人数：`openedActors`、`commentedActors`、`positiveActionActors` 等；事件次数单独使用 `openEvents`、`commentEvents` 等字段。所有转化率都使用人数计算，例如 `commentRateAfterOpen = commentedActors / openedActors`，不能用评论条数计算评论率。

### GET /api/runs/:runId/report

报告对外以 `runId` 定位。响应中的 `reportId` 是内部主键，前端可以用于调试展示或证据追踪，但不应把它作为报告页路由参数。

报告是 run 级最终产物，但生成输入必须来自该 run 的唯一 `contentVersionId`。如果数据库中同一 run 出现多个 content version，属于 V1 约束违规，服务端不得默认第一条生成报告。

如果报告还没生成：

```json
{
  "success": false,
  "error": {
    "code": "REPORT_NOT_READY",
    "message": "试映报告尚未生成"
  }
}
```

报告已生成：

```json
{
  "success": true,
  "data": {
    "reportId": "report_001",
    "runId": "run_001",
    "recommendation": "modify_then_publish",
    "reportOutput": {
      "verdict": {
        "recommendation": "modify_then_publish",
        "recommendationLabel": "修改后发布",
        "confidence": "medium",
        "headline": "选题打中目标人群，但证据不足影响信任",
        "oneSentence": "有宝宝/装修需求的观众愿意点开和收藏，但多名观众以 need_more_evidence / low_trust 离开。",
        "topOpportunity": "有宝宝/装修需求的观众愿意点开和收藏",
        "topRisk": "多名观众以 need_more_evidence / low_trust 离开",
        "priorityFix": "补充检测数据、真实案例和材料来源",
        "evidenceRefs": []
      },
      "funnel": {
        "audienceCount": 30,
        "completedCount": 28,
        "failedCount": 2,
        "exposedActors": 30,
        "openedActors": 22,
        "readActors": 18,
        "deepReadActors": 9,
        "readSkimActors": 6,
        "readPartialActors": 7,
        "readFullActors": 5,
        "viewedCommentsActors": 9,
        "likedActors": 4,
        "favoritedActors": 7,
        "commentedActors": 3,
        "sharedActors": 1,
        "exitedActors": 30,
        "positiveActionActors": 10,
        "openEvents": 22,
        "readEvents": 18,
        "commentEvents": 3,
        "shareEvents": 1,
        "exitEvents": 30,
        "openRate": 0.73,
        "readRateAfterOpen": 0.82,
        "deepReadRateAfterOpen": 0.41,
        "favoriteRateAfterOpen": 0.32,
        "commentRateAfterOpen": 0.14,
        "shareRateAfterOpen": 0.05,
        "positiveActionRate": 0.33,
        "notes": "样本量 30，证据质量中等"
      },
      "mainBlocker": {
        "blockerType": "trust_evidence",
        "title": "点开后信任不足",
        "severity": "high",
        "affectedCount": 8,
        "summary": "22 人点开，18 人阅读，其中 8 人以 need_more_evidence / low_trust 离开",
        "diagnosis": "选题能吸引目标用户，但正文没有完成说服",
        "evidenceRefs": []
      },
      "audienceGroupAnalysis": {
        "groups": [],
        "inferredGroups": [],
        "confidence": "medium",
        "crossGroupSummary": "",
        "coreTargetHit": true,
        "coreTargetHighInterestLowTrust": true,
        "peripheralExpansionOpportunity": false,
        "contrastSkipExpected": true,
        "contrastUnexpectedRisk": false,
        "evidenceRefs": []
      },
      "segments": [],
      "diagnostics": [],
      "keepAndChange": {
        "keep": [],
        "change": []
      },
      "revisionPlan": [],
      "retestPlan": [],
      "evidenceRefs": [],
      "keyFindings": [],
      "rewriteSuggestions": {
        "recommendedTitles": [],
        "recommendedTags": []
      },
      "summaryMarkdown": ""
    },
    "evidencePack": {
      "meta": {
        "runId": "run_001",
        "contentVersionId": "cv_001",
        "audienceCount": 30,
        "completedCount": 28,
        "failedCount": 2,
        "skippedCount": 10,
        "generatedAt": "2026-06-27T10:00:00.000Z",
        "evidenceQuality": "medium",
        "evidenceQualityReason": "样本量 30，证据质量中等"
      },
      "content": {
        "title": "宝宝入住精装房甲醛避坑指南",
        "bodyPreview": "刚拿到精装房钥匙，宝宝马上要入住...",
        "platformName": "小红书",
        "imageCount": 3
      },
      "funnel": {
        "exposedActors": 30,
        "openedActors": 22,
        "readActors": 18,
        "deepReadActors": 9,
        "readSkimActors": 6,
        "readPartialActors": 7,
        "readFullActors": 5,
        "viewedCommentsActors": 9,
        "likedActors": 4,
        "favoritedActors": 7,
        "commentedActors": 3,
        "sharedActors": 1,
        "exitedActors": 30,
        "positiveActionActors": 10,
        "openEvents": 22,
        "readEvents": 18,
        "commentEvents": 3,
        "shareEvents": 1,
        "exitEvents": 30,
        "openRate": 0.73,
        "readRateAfterOpen": 0.82,
        "deepReadRateAfterOpen": 0.41,
        "favoriteRateAfterOpen": 0.32,
        "commentRateAfterOpen": 0.14,
        "shareRateAfterOpen": 0.05,
        "positiveActionRate": 0.33
      },
      "exitAnalysis": {
        "byReasonCategory": { "need_more_evidence": 5, "low_trust": 3, "not_relevant": 10, "finished_normally": 12 },
        "byReadingDepth": { "feed_only": 10, "skimmed": 6, "partial": 7, "full": 7 },
        "byInterestLevel": { "low": 12, "medium": 10, "high": 8 },
        "byTrustLevel": { "low": 8, "medium": 15, "high": 7 },
        "riskExitCount": 8,
        "riskExitRate": 0.27
      },
      "commentAnalysis": {
        "totalComments": 3,
        "byIntent": { "ask": 1, "doubt": 1, "agree": 1 },
        "representativeComments": []
      },
      "thoughtAnalysis": {
        "representativeThoughts": [],
        "themes": []
      },
      "segments": {
        "persuaded": {
          "key": "persuaded",
          "name": "被打动的人",
          "participantIds": [],
          "size": 7,
          "percentage": 0.23,
          "summary": "",
          "commonTraits": [],
          "evidenceRefs": []
        },
        "interestedButNotConvinced": {
          "key": "interested_but_not_convinced",
          "name": "高兴趣低信任的人",
          "participantIds": [],
          "size": 8,
          "percentage": 0.27,
          "summary": "",
          "commonTraits": [],
          "evidenceRefs": []
        },
        "skipped": {
          "key": "skipped",
          "name": "直接流失的人",
          "participantIds": [],
          "size": 10,
          "percentage": 0.33,
          "summary": "",
          "commonTraits": [],
          "evidenceRefs": []
        },
        "skeptical": {
          "key": "skeptical",
          "name": "质疑/反驳的人",
          "participantIds": [],
          "size": 5,
          "percentage": 0.17,
          "summary": "",
          "commonTraits": [],
          "evidenceRefs": []
        }
      },
      "blockers": [],
      "audienceGroups": {
        "groups": [],
        "inferredGroups": [],
        "confidence": "medium",
        "crossGroupSummary": "",
        "coreTargetHit": true,
        "coreTargetHighInterestLowTrust": true,
        "peripheralExpansionOpportunity": false,
        "contrastSkipExpected": true,
        "contrastUnexpectedRisk": false,
        "evidenceRefs": []
      },
      "journeySamples": [],
      "evidenceIndex": {}
    },
    "model": "gpt-4o",
    "promptVersion": "report_decision_dashboard_v1",
    "createdAt": "2026-06-27T10:00:00.000Z"
  }
}
```

> **字段说明**：
> - 顶层 `recommendation` 保留用于快速访问和向后兼容，完整结构在 `reportOutput.verdict.recommendation`。
> - `reportOutput` 对应 `ReportOutputSchema`，详见 `06_报告生成规格.md` 第 5 节。`audienceGroupAnalysis` 与 `evidencePack.audienceGroups` 共用 `AudienceGroupAnalysisSchema`。
> - `evidencePack` 对应 `EvidencePackSchema`，详见 `06_报告生成规格.md` 第 4 节。`segments` 是固定四键对象（persuaded/interestedButNotConvinced/skipped/skeptical），不是数组；`evidenceIndex` 是 record（对象），key 为证据 id。
> - `keyFindings` / `rewriteSuggestions` / `summaryMarkdown` 为可选字段，旧报告可能缺失。`rewriteSuggestions` 中 `recommendedOpening` / `recommendedCommentPrompt` / `recommendedCoverText` / `recommendedBodyStructure` 为可选对象 `{ text, reason }`。
> - `model` / `promptVersion` / `createdAt` 来自报告持久化记录，用于报告底部展示。

### POST /api/runs/:runId/report

为尚未生成报告的 run 生成最终报告；已存在报告时该接口直接返回现有报告。前端在 paused 状态用它结束试映并生成报告。

支持查询参数 `?regenerate=true`：在 `completed` 或 `paused` 状态下强制重新生成报告，不修改 run 状态，只 emit `report.regenerated` 事件。前端在报告页"重新生成报告"按钮使用此参数。

约束：

```text
- 首次生成（无 ?regenerate=true）只允许 status = paused；report 已存在时幂等返回现有报告
- ?regenerate=true 允许在 status = completed 或 paused 时强制重新生成报告，不修改 run 状态
- 生成完成后仍通过 GET /api/runs/:runId/report 读取
- reportOutput.funnel 中的计数类字段以后端运行事实为准，真实报告模型不得覆盖这些字段
- run.terminalReason = user_ended；自然完成生成报告时为 all_journeys_finished
- runtimeMode=real 时报告模型调用失败不得静默降级为 Mock/fallback 报告；后端应将 run 置为 paused，写入 errorMessage，推送 run.paused，并返回 REPORT_GENERATION_FAILED
```

## 21. 模型设置

模型设置以本地 YAML 文件为唯一配置源。页面保存后，后端覆盖 YAML 文件并同步更新当前 API 进程内快照；API key 不会通过 `GET` 接口回显给前端，只返回是否已保存。

设计边界：模型设置接口属于本地单用户 V1 管理能力，当前应用层刻意不实现账号、权限或接口鉴权。它只能在 localhost、受信任网络或已有外部鉴权保护的环境中使用，不得将当前默认形态直接裸露到公网。

### GET /api/settings/llm

```json
{
  "success": true,
  "data": {
    "provider": "openai-compatible",
    "runtimeMode": "mock",
    "isConfigured": false,
    "isRealConfigComplete": false,
    "hasApiKey": false,
    "apiKeyMasked": "",
    "baseUrl": "",
    "models": {
      "fast": "",
      "pro": ""
    },
    "capacity": {
      "mode": "auto",
      "preset": "standard",
      "shared": {
        "initialRpm": 8,
        "minRpm": 2,
        "maxRpm": 60,
        "hardMaxRpm": 1000,
        "initialConcurrency": 4,
        "minConcurrency": 1,
        "maxConcurrency": 4,
        "hardMaxConcurrency": 100
      },
      "retry": { "maxRetries": 4 },
      "auto": {
        "cooldownMs": 15000,
        "successWindow": 5,
        "rpmIncreaseStep": 2
      }
    },
    "configPath": "E:\\work\\TryCue\\config\\llm.local.yaml"
  }
}
```

### PUT /api/settings/llm

```json
{
  "provider": "openai-compatible",
  "runtimeMode": "real",
  "apiKey": "sk-...",
  "baseUrl": "https://api.openai.com/v1",
  "models": {
    "fast": "gpt-4.1-mini",
    "pro": "gpt-4.1"
  },
  "capacity": {
    "mode": "auto",
    "preset": "standard",
    "shared": {
      "initialRpm": 8,
      "minRpm": 2,
      "maxRpm": 60,
      "hardMaxRpm": 1000,
      "initialConcurrency": 4,
      "minConcurrency": 1,
      "maxConcurrency": 4,
      "hardMaxConcurrency": 100
    },
    "retry": { "maxRetries": 4 },
    "auto": {
      "cooldownMs": 15000,
      "successWindow": 5,
      "rpmIncreaseStep": 2
    }
  }
}
```

说明：

```text
runtimeMode 必填，只允许 mock 或 real；缺少 runtimeMode 的请求不兼容
apiKey 留空或不传：保留当前服务端已保存 key
clearApiKey=true：清除当前服务端 key
runtimeMode=mock：后续运行使用 Mock provider，即使 real 配置字段完整也不会调用真实模型
runtimeMode=real：必须同时填写或保留 apiKey、baseUrl、models.fast、models.pro
capacity 可选；未传时保留服务端已保存值。capacity 字段校验由后端 validateCapacitySettings 执行：
  - minRpm <= initialRpm <= maxRpm <= hardMaxRpm
  - minConcurrency <= initialConcurrency <= maxConcurrency <= hardMaxConcurrency
  - maxRetries、cooldownMs、successWindow、rpmIncreaseStep 为非负整数
  - preset=custom 时允许用户自定义容量数值；其他预设由后端覆盖为完整预设值，并按 hard cap 夹到合法范围

模型使用范围：

- models.fast：画像展开、人设批量生成、试映中观众行为回合。
- models.pro：采样计划生成、优化观众分布问答、打磨观众人设问答、试映报告生成。
- 采样计划、优化问答、打磨人设和报告生成会携带图片输入；models.pro 必须支持图片输入。后端不自动降级到 models.fast。
模型调用由轻量 AI Task Runner 按 taskType 统一选择 fast/pro 模型；MVP 不提供全局 AI 并发池、排队、自动重试或短总时长超时。
设置保存到 config/llm.local.yaml，并立即更新当前 API 进程的 LlmConfigStore 和 LlmCapacityManager
```

### POST /api/settings/llm/models

使用当前保存的 API key/base URL，或请求体中临时提供的值，请求 OpenAI-compatible `GET /models` 并返回可选择模型名。

`baseUrl` 只支持 `http` / `https` scheme；明确不禁止 `127.0.0.1`、`localhost`、私网或局域网地址。本地模型服务、Ollama、LM Studio 或局域网 OpenAI-compatible 网关可使用 `http://127.0.0.1:...`、`http://localhost:...` 或内网地址。

安全边界：该接口会由服务端发起网络请求，并可能使用请求中提供或服务端已保存的 API key。部署到非可信网络时，必须通过访问控制、鉴权、反向代理或只绑定内网管理入口限制谁能调用设置和模型列表接口；不要依赖应用层禁止私网地址，也不要把 CORS 当作鉴权。

风险提示：裸露这些接口会允许未授权调用方修改 LLM 配置，或诱导服务端访问任意 http(s) 地址，可能造成密钥滥用、费用损失、配置篡改和对 localhost/私网服务的服务端请求风险。这是本地 V1 的已知设计边界，不是公网安全承诺。

```json
{
  "apiKey": "sk-...",
  "baseUrl": "https://api.openai.com/v1"
}
```

```json
{
  "success": true,
  "data": {
    "models": [
      { "id": "gpt-4.1", "ownedBy": "openai" }
    ]
  }
}
```

### GET /api/settings/llm/capacity/status

返回当前 `LlmCapacityManager` 运行时状态快照。该接口只读，不泄露 API key。

```json
{
  "success": true,
  "data": {
    "mode": "auto",
    "effectiveRpm": 8,
    "effectiveConcurrency": 1,
    "configuredMaxRpm": 60,
    "configuredMaxConcurrency": 4,
    "inFlight": 0,
    "queueSize": 0,
    "cooldownUntil": null,
    "recentLimitCount": 0,
    "lastLimitAt": null,
    "lastLimitReason": null
  }
}
```

字段说明：

```text
mode                当前容量模式（auto / manual）
effectiveRpm        运行时实际生效 RPM（AIMD 调整后的值）
effectiveConcurrency 运行时实际生效并发
configuredMaxRpm    配置的 maxRpm（auto 模式上限）
configuredMaxConcurrency 配置的 maxConcurrency
inFlight            当前在飞的 LLM HTTP 请求数
queueSize            等待获取容量许可的排队请求数
cooldownUntil       限流冷却结束时间（ISO 字符串或 null）
recentLimitCount    最近遇到的限流次数
lastLimitAt         最近一次限流时间（ISO 字符串或 null）
lastLimitReason     最近一次限流原因（字符串或 null）
```

### POST /api/settings/llm/capacity/probe

启动容量校准 job。job-based 异步 API：POST 启动后返回 jobId，GET 查询进度，POST cancel 取消。校准使用 prompt `"不思考，回复1"`、`max_tokens: 1`，单次请求超时 15 秒。每档并发测试 60 秒，档间冷却 60 秒。推荐值取最佳档位 RPM 的 75%。

请求：

```json
{
  "mode": "normal",
  "maxRpm": 60,
  "maxConcurrency": 4,
  "model": "gpt-4.1-mini",
  "apiKey": "sk-...",
  "baseUrl": "https://api.openai.com/v1"
}
```

```text
mode        normal / high_quota / custom
maxRpm      custom 模式下用户填写的探测上限（受 hardMaxRpm 保护）
maxConcurrency custom 模式下用户填写的探测上限（受 hardMaxConcurrency 保护）
model       可选，覆盖当前保存的 models.fast
apiKey      可选，覆盖当前保存的 apiKey
baseUrl     可选，覆盖当前保存的 baseUrl
runtimeMode=mock 时返回 400 CAPACITY_PROBE_MOCK_MODE
runtimeMode=real 且缺少 apiKey/baseUrl/model 时返回 400 CAPACITY_PROBE_MISSING_FIELDS
已有 job 运行时返回 409 PROBE_ALREADY_RUNNING
```

POST 响应（启动）：

```json
{
  "success": true,
  "data": {
    "jobId": "uuid-...",
    "status": "running"
  }
}
```

### GET /api/settings/llm/capacity/probe/:jobId

查询校准 job 进度或结果。jobId 不存在返回 404。

响应（运行中）：

```json
{
  "success": true,
  "data": {
    "id": "uuid-...",
    "status": "running",
    "phase": "testing",
    "currentConcurrency": 2,
    "currentLevelSentRequests": 30,
    "currentLevelSuccessfulRequests": 28,
    "currentLevelFailedRequests": 2,
    "currentLevelTotalTokens": 510,
    "currentLevelAvgLatencyMs": 420,
    "currentLevelElapsedMs": 32000,
    "currentLevelDurationMs": 60000,
    "cooldownRemainingMs": 0,
    "cooldownTotalMs": 0,
    "sentRequests": 90,
    "successfulRequests": 85,
    "failedRequests": 5,
    "inputTokens": 425,
    "outputTokens": 85,
    "totalTokens": 510,
    "stableRpm": 60,
    "stableConcurrency": 1,
    "elapsedMs": 65000,
    "maxElapsedMs": 480000,
    "levels": [],
    "message": "并发 2 测试中：已发 30，成功 28，失败 2"
  }
}
```

响应（完成）：

```json
{
  "success": true,
  "data": {
    "id": "uuid-...",
    "status": "completed",
    "phase": "done",
    "currentConcurrency": 3,
    "sentRequests": 150,
    "successfulRequests": 140,
    "failedRequests": 10,
    "inputTokens": 700,
    "outputTokens": 140,
    "totalTokens": 840,
    "stableRpm": 45,
    "stableConcurrency": 3,
    "elapsedMs": 180000,
    "maxElapsedMs": 480000,
    "message": "校准完成",
    "result": {
      "recommendedRpm": 33,
      "recommendedConcurrency": 3,
      "testedMaxRpm": 45,
      "testedMaxConcurrency": 3,
      "avgLatencyMs": 420,
      "inputTokens": 700,
      "outputTokens": 140,
      "totalTokens": 840,
      "levels": [
        {
          "concurrency": 2,
          "sentRequests": 90,
          "successfulRequests": 88,
          "failedRequests": 2,
          "rpm": 88,
          "successRate": 98,
          "avgLatencyMs": 420,
          "inputTokens": 440,
          "outputTokens": 88,
          "totalTokens": 528,
          "elapsedMs": 60420,
          "selected": true
        }
      ],
      "warnings": []
    }
  }
}
```

```text
id                              job 唯一标识
status                          running / completed / failed / cancelled
phase                           starting / testing / cooldown / done
currentConcurrency              当前测试的并发档位
currentRpm                      当前档位实测 RPM（按 60 秒窗口成功数计算）
currentLevelSentRequests        当前档位已发送请求数
currentLevelSuccessfulRequests  当前档位成功请求数
currentLevelFailedRequests      当前档位失败请求数
currentLevelTotalTokens         当前档位累计 token
currentLevelInputTokens         当前档位累计输入 token
currentLevelOutputTokens        当前档位累计输出 token
currentLevelAvgLatencyMs        当前档位平均延迟
currentLevelElapsedMs           当前档位已耗时
currentLevelDurationMs          当前档位测试窗口时长（60000ms）
cooldownRemainingMs             phase=cooldown 时的剩余等待时间
cooldownTotalMs                 phase=cooldown 时的总冷却时长
sentRequests                    累计发送请求数
successfulRequests              累计成功请求数
failedRequests                  累计失败请求数
inputTokens                     累计输入 token 数
outputTokens                    累计输出 token 数
totalTokens                     累计总 token 数
stableRpm                       已找到的最佳 RPM
stableConcurrency               已找到的最佳并发
elapsedMs                       job 已运行总时长
maxElapsedMs                    job 最大允许时长（超时自动取消）
levels                          已完成档位结果列表，用于解释推荐依据
message                         当前阶段人类可读进度文案
result                          status === "completed" 时存在
result.recommendedRpm         推荐立即使用的实际 RPM（最佳档位 RPM 75%）
result.recommendedConcurrency  推荐立即使用的实际并发（最佳档位并发）
result.testedMaxRpm            实际探测到的最大稳定 RPM
result.testedMaxConcurrency    实际探测到的最大稳定并发
result.avgLatencyMs           探测请求平均延迟
result.inputTokens             探测总输入 token
result.outputTokens            探测总输出 token
result.totalTokens             探测总 token
result.levels                  已完成档位结果列表，并标记 selected 推荐档
result.warnings                警告信息列表
error                          status === "failed" 时的错误信息
```

校准并发档位按倍增序列上探（`buildConcurrencyPlan`）：从 `startConcurrency` 起始，按 `next * 2` 倍增直到 `maxConcurrency`。各模式起始与上限：

```text
normal      startConcurrency=2, maxConcurrency=4,  maxRpm=60
high_quota  startConcurrency=4, maxConcurrency=16, maxRpm=300
custom      startConcurrency=min(userMaxConcurrency,4), maxConcurrency=userMaxConcurrency, maxRpm=userMaxRpm
```

若起始档失败，回退测试并发 1。每档维持 60 秒，统计成功请求数作为该并发下实测 RPM；若更高并发下实测 RPM 不再超过当前最佳档位，则停止上探。推荐 RPM 取最佳档位 RPM 的 75%，并强制下限为 2。

### POST /api/settings/llm/capacity/probe/:jobId/cancel

取消正在运行的校准 job。jobId 不存在返回 404。

校准结果不会自动写入配置；用户在前端点击"应用推荐值"后才会调用 apply-recommended 接口写入。

### POST /api/settings/llm/capacity/reset-learning

重置 `LlmCapacityManager` 的运行时学习状态，将 `effectiveRpm` / `effectiveConcurrency` 恢复为 `initialRpm` / `initialConcurrency`，清空 `recentSuccessCount` / `recentLimitCount` / `cooldownUntil` / `lastLimitAt` / `lastLimitReason`。不修改 YAML 配置文件。

```json
{
  "success": true,
  "data": {
    "mode": "auto",
    "effectiveRpm": 8,
    "effectiveConcurrency": 1,
    "configuredMaxRpm": 60,
    "configuredMaxConcurrency": 4,
    "inFlight": 0,
    "queueSize": 0,
    "cooldownUntil": null,
    "recentLimitCount": 0,
    "lastLimitAt": null,
    "lastLimitReason": null
  }
}
```

### POST /api/settings/llm/capacity/apply-recommended

应用校准结果，并持久化到 `config/llm.local.yaml`，同时更新当前 `LlmCapacityManager`。

- `recommendedRpm` / `recommendedConcurrency` 会写入 `capacity.shared.initialRpm` / `capacity.shared.initialConcurrency`，并立即更新运行时 `effectiveRpm` / `effectiveConcurrency`。
- `testedMaxRpm` / `testedMaxConcurrency` 会写入 `capacity.shared.maxRpm` / `capacity.shared.maxConcurrency`，作为自动模式上限。
- 旧字段 `maxRpm` / `maxConcurrency` 暂保留为兼容别名，语义等同于 `recommendedRpm` / `recommendedConcurrency`，用于向后兼容早期调用方；新调用不要继续使用旧字段名，待确认无外部依赖后移除。

```json
{
  "recommendedRpm": 45,
  "recommendedConcurrency": 3,
  "testedMaxRpm": 60,
  "testedMaxConcurrency": 4
}
```

```text
recommendedRpm、recommendedConcurrency 必填，且不能超过 hardMaxRpm / hardMaxConcurrency
写入后 preset 自动改为 custom
返回更新后的完整 LlmSettingsView
```

## 21.5 重置运行时

### POST /api/runs/:runId/reset-runtime

重置 run 的运行时状态，清除所有运行时事实（旅程、行动、互动、日志、报告等），保留内容版本、观众采样计划和已生成身份，将 run 回退到 `audience_ready`。用于已完成或暂停的 run 需要重新试映时。

#### 允许的 run 状态

`paused` | `completed` | `audience_ready`

#### 拒绝的 run 状态

`running` | `pausing` | `report_generating` | `generating_audience` | `planning_audience` | `draft` → `409 INVALID_RUN_STATUS`

存在 active audience generation job 时 → `409 AUDIENCE_GENERATION_ACTIVE`

#### 清理范围

**保留**：contentVersion / images / assets、audienceSamplingPlan / directives、audienceProfiles、已生成的 User / Agent / PlatformAccount

**删除**：runParticipants、agentJourneys、agentTurns / agentToolCalls / agentTurnContexts、agentSessions / agentTranscriptItems、interactions / comments / loadedCommentPages、actionLogs / runLogs / liveEvents、simulatedPostState、report、insights

#### Response

```json
{
  "success": true,
  "data": {
    "runId": "run_001",
    "status": "audience_ready",
    "deleted": {
      "reports": 1,
      "insights": 5,
      "runLogs": 42,
      "actionLogs": 120,
      "simulatedComments": 30,
      "loadedCommentPages": 8,
      "socialInteractionEvents": 95,
      "socialReactions": 60,
      "simulatedPostStates": 1,
      "liveEvents": 200,
      "agentToolCalls": 80,
      "agentTurnContexts": 80,
      "agentTurns": 120,
      "agentTranscriptItems": 240,
      "agentSessions": 30,
      "agentJourneys": 30,
      "runParticipants": 30
    }
  }
}
```

#### 说明

- 重置会清空旧 `live_events`，随后推送新的 `run.clock.updated(reason="reset")` 事件校准 HUD 时间；前端收到成功响应后仍需 reload runtime snapshots 和 SSE 状态。
- configJson 中的 `controlState`、`startedAudienceCount`、`excludedProfileCount` 会被清除，`controlState` 重置为 `"none"`。
- clock 相关字段（`clockElapsedMs`、`clockAnchorAt`）归零/清空，`startedAt`、`completedAt`、`terminalReason`、`errorMessage` 清空。

## 22. 试映暂停与继续

### POST /api/runs/:runId/pause

暂停试映。状态变为 `pausing`，当前 running action 完成后变 `paused`。

### POST /api/runs/:runId/resume

继续试映。状态从 `paused` 变为 `running`。

开始试映见 `POST /api/runs/:runId/start`；结束并生成报告见 `POST /api/runs/:runId/report`。

## 23. 重试单个参与者

### POST /api/runs/:runId/retry

对单个参与者（participant）的失败旅程进行重试。允许在 `running`、`paused`、`completed` 状态下调用；其他状态返回 `409 INVALID_RUN_STATUS`。

```json
{
  "participantId": "participant_001",
  "strategy": "continue_retry"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| participantId | 是 | 必须属于当前 run |
| strategy | 否 | 默认 `continue_retry`；枚举 `continue_retry` / `clean_retry` |

#### 校验

| 条件 | 错误 |
|---|---|
| run 不存在 | `404 RUN_NOT_FOUND` |
| run 状态不在 running / paused / completed | `409 INVALID_RUN_STATUS` |
| participantId 不属于该 run | `409 INVALID_RETRY_TARGET` |
| 该参与者无 failed 状态的 journey | `409 INVALID_RETRY_TARGET` |

#### 通用行为

- 删除该 run 的已有报告（报告在重试后已过期）。
- 设置 run status = `running`，`clockAnchorAt = now`，`completedAt = null`，`terminalReason = null`，`errorMessage = null`，`configJson.controlState = "none"`。
- 若 scheduler 已启用，启动 scheduler。

#### continue_retry

保留既有旅程、行动、工具调用、会话、transcript 和业务事实，从失败点继续：

1. 重激活当前 screen 对应的 failed session（如有）。
2. 向活跃 session 追加一条 `system_notice`，说明上次尝试失败及错误原因。
3. 设置 journey status = `active`，`runnerStatus` = `queued`，`lockedBy / lockedAt / heartbeatAt = null`，`errorMessage = null`，`completedAt = null`。
4. 设置 participant `runtimeStatus = "queued"`。
5. 将 `currentStepIndex` 推进到 `max(existing action.stepIndex) + 1`，由 AgentRunner 创建新 turn。

```json
{
  "success": true,
  "data": {
    "runId": "run_001",
    "status": "running",
    "participantId": "participant_001",
    "strategy": "continue_retry"
  }
}
```

#### clean_retry

**破坏性操作**：仅删除该参与者的运行时痕迹和业务事实，不影响其他参与者。

1. 按 FK 安全顺序删除：actionLogs → simulatedComments → loadedCommentPages → socialInteractionEvents → socialReactions → agentSessionItems → journeyToolCalls → journeyActionContexts → journeyActions → agentSessions → journeys（均按 participantId 过滤）。
2. 保留 RunParticipant 行和 identity/profile 行。
3. 从剩余事实重算 `simulatedPostState` 计数：openCount、shareCount、exitCount、commentCount、likeCount、favoriteCount、exposureCount。保持 `currentPhase = running`。
4. 设置 participant `runtimeStatus = "ready"`，下次正常入场会创建新旅程并增加 exposure。

```json
{
  "success": true,
  "data": {
    "runId": "run_001",
    "status": "running",
    "participantId": "participant_001",
    "strategy": "clean_retry",
    "deleted": {
      "actionLogs": 5,
      "simulatedComments": 2,
      "loadedCommentPages": 1,
      "socialInteractionEvents": 8,
      "socialReactions": 4,
      "agentSessionItems": 12,
      "journeyToolCalls": 6,
      "journeyActionContexts": 6,
      "journeyActions": 6,
      "agentSessions": 2,
      "journeys": 1
    }
  }
}
```

## 24. 常见错误码

| code | HTTP | 说明 |
|---|---:|---|
| VALIDATION_ERROR | 400 | 参数错误 |
| RUN_NOT_FOUND | 404 | run 不存在 |
| INVALID_RUN_STATUS | 409 | run 状态不允许当前操作 |
| INVALID_RETRY_TARGET | 409 | participantId 不属于该 run 或无 failed journey |
| AUDIENCE_IDENTITY_INCOMPLETE | 409 | 还有画像未生成人设，且请求未带 `allowPartialAudience=true` |
| AUDIENCE_GENERATION_ACTIVE | 409 | 观众生成任务仍在执行，不能开始试映 |
| PAUSE_FAILED | 409 | 暂停失败 |
| REPORT_NOT_READY | 409 | 报告未生成 |
| SCHEDULER_BUSY | 409 | 调度器正在运行 |
| CONFIG_ERROR | 500 | real AI run 的 base URL 配置错误、模型不支持 vision 或模型调用失败 |
| MODEL_LIST_FAILED | 502 | OpenAI-compatible 模型列表获取失败 |
| AGENT_RUN_FAILED | 500 | Agent 调用失败 |
| TOOL_COMMIT_FAILED | 500 | 工具提交失败 |
| INTERNAL_ERROR | 500 | 未知错误 |
