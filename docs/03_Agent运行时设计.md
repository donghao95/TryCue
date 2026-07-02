# 03 Agent 运行时设计

## 1. 设计原则与架构概述

### 1.1 核心原则

```text
1. Agent 是 {platformName} 用户，不是内容分析师。
2. Agent 的外部行为通过 tool use 发生。
3. Agent 的可展示心路来自本轮 assistant content；content 非空才保存为 thought_text。
4. Agent 不主动打分，不主动写 memory。分数和洞察由报告/分析层基于已持久化证据生成。
5. 一个 AgentTurn 可以有多个 tool call，也可以只有 thought_text；content 为空但有 tool_calls 是有效工具回合。
6. 每个 tool call 都要可落库、可回放、可追溯。
7. 工具函数通过统一 runtime service 在事务内提交，不允许 toolExecutor 直接改点赞、收藏、评论等业务事实表。
8. 实时通信使用 SSE（Server-Sent Events），不使用 WebSocket 或轮询。
9. Agent 与前端用户共享 User + Agent + PlatformAccount 统一行为主体模型，Agent 工具默认 source = agent_tool。
10. Agent 接收真实封面图片（多模态视觉输入），直接进行视觉判断。
11. 工具像真实环境接口：合法性、幂等、重复调用由服务基于 DB 事实返回结果，不靠 prompt 自觉。
12. prompt 管行为风格，不承担事实边界约束。
```

### 1.2 架构概述

当前运行期采用 Agent 级调度：

```text
AgentJourney  = 单个观众在一次 run 中的浏览旅程
AgentRunner   = 持有一个 AgentJourney 的执行循环
AgentTurn     = Runner 循环中的一个模型回合和证据单元
AgentToolCall = AgentTurn 内一个原生 tool call 的持久化记录
AgentTranscriptItem = append-only transcript 恢复事实源
```

不再使用旧的 action-level queue。Scheduler 只 claim AgentJourney，不 claim turn/tool/action。

V1 技术栈：

```text
SQLite 持久化（未来生产可迁移 PostgreSQL）
内存 Scheduler 调度
最多 N 个 AgentRunner 并发（SCHEDULER_DEFAULT_CONCURRENCY）
Run Clock 以倍率推进模拟时间
AI SDK generateText 执行 native tool use（基于 @ai-sdk/openai-compatible 的 createOpenAICompatible provider）
工具通过统一 runtime service 串行提交数据库
SSE 推送 durable live_events
```

不使用 RabbitMQ、Kafka、BullMQ、Inngest、Trigger.dev、真实等待 sleep 或真实外部平台自动化。

### 1.3 核心不变量

1. 一个 AgentRunner claim 一个 AgentJourney，持续执行到该观众结束浏览、失败或达到最大步数。
2. Scheduler 只 claim journey，不 claim turn/tool/action。
3. 并发上限为全局 SCHEDULER_DEFAULT_CONCURRENCY。
4. 模型一次可以返回多个 native tool calls；提交层按 callIndex 顺序串行校验和提交。
5. 每个 tool call 都落库为 agent_tool_calls，状态为 pending | committed | ignored | failed。
6. 已经 committed 的 tool call 不得重复执行；重复提交只能返回已持久化结果。
7. 每个 assistant 消息、tool call 声明、tool result 都写入 agent_transcript_items。
8. open_post 是 feed session 到 post session 的唯一 phase transition。
9. 单 Agent 失败只标记该 AgentJourney / RunParticipant 失败，不暂停整场 run。
10. durable live_events 只保存业务事件；reasoning/debug delta 不进入主事件流。

---

## 2. Agent 旅程模型

### 2.1 数据库表

运行期核心表：

```text
agent_journeys          — 单个观众在本次 run 中的完整浏览生命周期
agent_turns             — 一轮模型决策和工具提交证据
agent_turn_contexts     — AgentTurn 的上下文快照
agent_tool_calls        — 一个 native tool call 的持久化记录
agent_transcript_items  — append-only transcript 恢复事实源
run_participants        — 正式入场快照
live_events             — 持久化业务事件
run_logs                — 运行日志
action_logs             — 行为日志
```

### 2.2 AgentJourney

```text
agent_journeys
  id
  run_id
  run_participant_id
  actor_user_id
  platform_account_id
  content_version_id
  prompt_version
  status                  active | finished | failed
  runner_status           queued | idle | running
  queue_seq
  last_transcript_seq
  current_step_index
  thought_summary
  final_summary
  exit_outcome            skipped | browsed_and_left | risk_exit | max_steps
  exit_reason
  error_message
  locked_by
  locked_at
  heartbeat_at
  started_at
  completed_at
  created_at
  updated_at
```

AgentJourney 是运行期业务实体，runner 独占锁是它的自然属性。同一 AgentJourney 同一时刻只允许一个 runner。

### 2.3 AgentTurn

```text
agent_turns
  id
  agent_journey_id
  run_id
  run_participant_id
  actor_user_id
  platform_account_id
  content_version_id
  step_index
  queue_seq
  status                  created | context_recorded | model_calling | model_returned
                          | tools_executing | completed | failed | recovered
  thought_text
  reasoning_content
  raw_agent_output_json
  request_json             -- 发给模型的完整请求或可重建请求
  raw_response_json        -- 模型 provider 原始响应
  parsed_tool_calls_json   -- 从原始响应解析出的 tool calls
  model
  prompt_version
  retry_count
  error_message
  locked_by
  locked_at
  started_at
  completed_at
  created_at
  updated_at
```

AgentTurn 状态机：

```text
created
  -> context_recorded
    -> model_calling
      -> model_returned
        -> tools_executing
          -> completed
          -> failed
        -> failed (model call failed)
      -> recovered
```

关键不变量：

1. 一个 turn 的 agent_turn_context 最多创建一次；重试模型调用时复用同一 context。
2. assistant output 一旦持久化，同一 turn 不再重新调用模型。
3. tool call 一旦 committed，不得重复执行。
4. 工具执行中断后，恢复逻辑补齐 failed tool result，然后让同一个 runner 或下一轮 turn 继续。
5. 一个 AgentRunner 内创建下一轮 AgentTurn，不把每轮 turn 重新丢回全局 scheduler。

### 2.4 AgentTurnContext

```text
agent_turn_contexts
  id
  agent_turn_id
  screen_before_json
  post_state_before_json
  comments_page_json
  thought_summary
  available_tools_json
  input_context_json
  model
  prompt_version
  created_at
```

每个 turn 最多创建一个 context，保存当前 screen、post state、comments page 和模型输入上下文快照。

### 2.5 AgentToolCall

```text
agent_tool_calls
  id
  agent_turn_id
  run_id
  journey_id
  run_participant_id
  actor_user_id
  platform_account_id
  source                  agent_tool
  content_version_id
  call_index
  sdk_call_id             -- AI SDK 的 toolCallId，仅用于审计/排查
  idempotency_key         -- 全局唯一幂等键
  raw_tool_call_json      -- provider 原始 tool call
  input_json              -- 解析后的工具参数
  output_json             -- 返回给模型的工具结果
  status                  pending | committed | ignored | failed
  error_message
  started_at
  completed_at
  created_at
  updated_at
```

唯一约束：
- `(agentTurnId, callIndex)` — 稳定区分同一步里的第 N 个工具调用
- `idempotencyKey` — 全局唯一，防止重试时重复执行副作用

`sdkCallId` 只作为可选审计字段，不作为系统不变量。

### 2.6 AgentTranscriptItem

```text
agent_transcript_items
  id
  run_id
  journey_id
  agent_turn_id            nullable
  agent_tool_call_id       nullable
  seq
  item_type                observation | assistant_message | assistant_tool_calls
                           | tool_result | system_notice
  content                  -- 原样给模型看的内容
  reasoning_content        -- MiMo 的 reasoning_content
  observation_json
  tool_calls_json
  tool_result_json
  metadata_json
  created_at
```

`agent_transcript_items` 是 Agent 的上下文账本，用来恢复和继续模型对话。它是 append-only 恢复事实源，不等同于前端行动日志。

不能只从 `agent_turns + agent_tool_calls + 业务事实表` 临时重建 transcript，原因是：

1. 工具返回给模型的 observation 不一定等于业务表最终状态。
2. system notice、失败 tool result、phase 切换消息和空 assistant content 很难从业务事实无损反推。
3. 调试时必须知道模型当时真实看到的上下文。
4. reset / replay / resume 都依赖严格的 seq 顺序。

### 2.7 Session 阶段分离

观众运行期分为两个独立的 LLM 会话阶段，但**不通过独立数据库表管理**，而是通过 AgentTurn 的 session 状态字段区分：

```text
feed session   — 信息流首屏判断阶段
post session   — 帖子详情互动阶段
```

一个 Journey 从 feed session 开始；当观众调用 `open_post` 成功后，feed session 完成，进入 post session。两个 session 是独立的 LLM 会话，不共享对话历史。

---

## 3. 工具定义

### 3.1 V1 可用工具

工具按会话阶段固定分配，不再每轮动态裁切工具 schema。

#### Feed 阶段可用工具

| 工具 | 作用 |
|---|---|
| open_post | 点开帖子，写入 social_interaction_events open_post 事件，进入 post 阶段 |
| exit_browsing | 结束浏览（在 feed 阶段即为"跳过"） |

#### Post 阶段可用工具

| 工具 | 作用 |
|---|---|
| read_post | 阅读帖子正文，记录阅读深度和关注点，不更新任何计数 |
| view_comments | 查看评论分页 |
| like_post | 点赞帖子 |
| favorite_post | 收藏帖子 |
| share_post | 分享帖子 |
| write_comment | 评论或回复评论（必填 intent） |
| like_comment | 点赞评论 |
| exit_browsing | 结束浏览（必填结构化参数） |

### 3.2 V1 已移除工具

```text
record_reaction  — 心路历程由非工具输出承载，避免把想法伪装成用户操作
record_memory    — V1 不需要用户主动管理记忆，连续性由上下文摘要解决
update_score     — 用户不应该给自己打分，评分属于最终汇总分析
inspect_feed_card — 看到卡片本身就是上下文输入，不需要额外检查动作
scroll_down      — 系统不是 DOM 模拟，详情页直接提供完整正文
wait             — 排队由 Scheduler 自动处理，不暴露给 Agent
finish_turn      — 排队由 Scheduler 自动处理，不暴露给 Agent
skip_post        — 统一为 exit_browsing
finish_journey   — 统一为 exit_browsing
exit_post        — 统一为 exit_browsing
```

### 3.3 工具定义格式

工具使用 AI SDK 的 `tool()` + `jsonSchema()` 定义，以 `createAiSdkToolSet` 工厂函数返回 `Record<string, Tool>` 格式。

每个工具独立定义 `description`、`inputSchema`、`execute`。公共逻辑（事务、上下文加载、幂等检查、验证）在 `withToolContext` 里。

```typescript
function createAiSdkToolSet(ctx: AiSdkToolContext): Record<string, Tool> {
  return {
    open_post: tool({
      description: "点开当前信息流帖子。",
      inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false }),
      execute: async (_args, { toolCallId }) => executeTool("open_post", {}, toolCallId, (txCtx) =>
        commitOpenPost(txCtx.tx, txCtx.action, txCtx.journey, txCtx.audience, txCtx.toolCall, txCtx.simulatedTime)
      )
    }),
    view_comments: tool({
      description: "查看或继续翻页评论区。",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          postId: { type: "string" },
          cursor: { type: ["string", "null"] },
          sort: { type: ["string", "null"], enum: ["latest", "hot", null] }
        },
        required: ["postId"],
        additionalProperties: false
      }),
      execute: async (args, { toolCallId }) => executeTool("view_comments", args, toolCallId, ...)
    }),
    // ... 其他工具同理
  };
}
```

### 3.4 工具详细定义

#### 3.4.1 open_post

**阶段**：仅 feed 阶段可用

**Args**：

```ts
type OpenPostArgs = {};
```

**行为**：写入 open_post 交互事件，将阶段从 feed 过渡到 post。系统追加 post detail observation 到 transcript。Agent 在后续 turn 中基于 post detail 信息继续决策。

#### 3.4.2 read_post

**阶段**：仅 post 阶段可用（feed 阶段调用返回 `post_not_opened`）

**Args**：

```ts
type ReadPostArgs = {
  postId: string;
  depth: "skim" | "partial" | "full";
  focus?: string[]; // max 3 项，每项 max 20 字符
};
```

**参数说明**：

- `postId`：当前 contentVersionId。
- `depth`：阅读深度，必填。
  - `skim`：快速扫读
  - `partial`：认真看了一部分
  - `full`：基本看完
- `focus`：可选，表示这次阅读主要关注的关键词（例如价格、材料、步骤、风险、证据）。不传默认 `[]`；传入时最多 3 项，每项最长 20 字符。

**校验**：

- `depth` 必填，缺失返回 `read_depth_required`
- `focus` 格式非法（非数组、超过 3 项、单项超长或非字符串）返回 `read_focus_invalid`
- `postId` 必填且必须等于当前 contentVersionId，否则返回 `post_id_required` / `post_not_found`

**行为**：

1. 写入 `social_interaction_events`，`interactionType = "read_post"`。
2. 写入 transcript tool result（`agent_transcript_items.tool_result_json`）。
3. 写入 action log。
4. **不更新 post counters**：`likeCount` / `favoriteCount` / `commentCount` / `shareCount` / `openCount` / `exitCount` 均不变，不推送 `post_state.updated` 事件。
5. 推送 `audience.action_happened`（`action = "read_post"`，`animationHint = "none"`）。

**工具 output**：

```json
{
  "ok": true,
  "postId": "content_version_id",
  "status": "read",
  "depth": "partial",
  "focus": ["甲醛", "宝宝入住"]
}
```

**action log 文案**（只记录事实，不写动机）：

```text
{name} 快速扫读了正文        // depth = skim
{name} 认真看了一部分正文    // depth = partial
{name} 基本看完了正文        // depth = full
```

设计定位：`read_post` 承载"看了但不互动"的真实中间状态，解决原有运行时缺少非互动阅读行为的问题。主观动机由 assistant 短想法（`thought_text`）承载，action log 不代写。

#### 3.4.3 view_comments

**阶段**：仅 post 阶段可用

**Args**：

```ts
type ViewCommentsArgs = {
  postId: string;
  cursor?: string | null;
  sort?: "latest" | "hot" | null;
};
```

**行为**：
1. 默认按 `latest` 加载 10 条评论。
2. cursor 为空时加载第一页。
3. cursor 不为空时加载 cursor 指向的下一页。
4. `sort=hot` 按评论点赞数、回复数和时间排序；`sort=latest` 按最新评论排序。
5. 返回 comments、next_cursor、has_more。

#### 3.4.4 like_post

**阶段**：仅 post 阶段可用

**Args**：

```ts
type LikePostArgs = { postId: string };
```

**行为**：点赞帖子。重复点赞返回 `ok: false, reason: "already_liked"`（不取消，不增加计数）。结果持久化到 agent_tool_calls.output。

#### 3.4.5 favorite_post

**阶段**：仅 post 阶段可用

**Args**：

```ts
type FavoritePostArgs = { postId: string };
```

**行为**：收藏帖子。重复收藏返回 `ok: false, reason: "already_favorited"`（不取消，不增加计数）。结果持久化到 agent_tool_calls.output。

#### 3.4.6 share_post

**阶段**：仅 post 阶段可用

**Args**：

```ts
type SharePostArgs = { postId: string };
```

**行为**：分享帖子。分享是事件型行为，不写 social_reactions，同一用户可多次分享。

#### 3.4.7 write_comment

**阶段**：仅 post 阶段可用

**Args**：

```ts
type WriteCommentArgs = {
  postId: string;
  intent: "ask" | "doubt" | "share_experience" | "agree" | "joke" | "pushback";
  content: string;
  replyToCommentId?: string | null;
};
```

**参数说明**：

- `intent`：评论意图，必填。用于结构化标记评论意图，方便报告统计。
  - `ask`：提问
  - `doubt`：质疑
  - `share_experience`：补充个人经验
  - `agree`：认同/共鸣
  - `joke`：梗/调侃
  - `pushback`：反驳/不同意
- `content`：评论正文，由 Agent 根据 persona 自然生成，不模板化。
- `replyToCommentId`：回复某条评论时使用，为空则评论主帖。

**校验**：
- `intent` 必填，缺失返回 `comment_intent_required`
- content: 1-200 字（`MAX_COMMENT_LENGTH`），缺失返回 `comment_content_required`，超长返回 `comment_content_too_long`
- 不得包含真实人身攻击、违法、色情、仇恨内容
- 不得编造具体品牌严重负面事实
- 必须符合 persona 语气
- replyToCommentId 如果存在，必须属于当前帖子的一条评论，否则返回 `reply_target_comment_not_found`

**行为**：replyToCommentId 为空时回复主帖；有值时回复对应评论或已有回复。提交层写 parent_comment_id，并计算 root_comment_id，因此支持 Agent A 评论、Agent B 回复 A、Agent C 再回复 B 的多层交流链。工具 output 返回 `commentId`、`comment`、`commentCount` 和 `intent`。

`intent` 不在主评论区展示，仅用于观众详情、证据链和报告层。

#### 3.4.8 like_comment

**阶段**：仅 post 阶段可用

**Args**：

```ts
type LikeCommentArgs = {
  commentId: string;
};
```

**校验**：
- commentId 必须属于当前 run / content_version
- 重复点赞 ignored 或返回已有状态，不重复增加 like_count

#### 3.4.9 exit_browsing

**阶段**：feed 和 post 阶段均可用

**Args**：

```ts
type ExitBrowsingArgs = {
  reasonCategory:
    | "not_relevant"
    | "not_interested"
    | "low_trust"
    | "too_ad_like"
    | "content_too_long"
    | "need_more_evidence"
    | "finished_normally"
    | "no_more_action";
  readingDepth: "feed_only" | "skimmed" | "partial" | "full";
  interestLevel: "low" | "medium" | "high";
  trustLevel: "low" | "medium" | "high";
};
```

全部字段必填。`exit_browsing` 是关键证据工具，不只是"结束按钮"：离开原因、阅读深度、兴趣和信任水平构成结构化证据，供报告层统计离开原因分布、信任水平分布等。

**参数说明**：

- `reasonCategory`：离开原因分类。
  - `not_relevant`：与我无关
  - `not_interested`：不感兴趣
  - `low_trust`：信任不足
  - `too_ad_like`：广告感太强
  - `content_too_long`：内容太长
  - `need_more_evidence`：需要更多证据
  - `finished_normally`：正常看完离开
  - `no_more_action`：没有更多动作
- `readingDepth`：离开时阅读深度。
  - `feed_only`：只看了信息流卡片
  - `skimmed`：快速扫读
  - `partial`：看了一部分
  - `full`：基本看完
- `interestLevel`：离开时兴趣水平。`low` / `medium` / `high`
- `trustLevel`：离开时信任水平。`low` / `medium` / `high`

**校验**：

- `reasonCategory` 必填，缺失返回 `exit_reason_category_required`
- `readingDepth` 必填，缺失返回 `exit_reading_depth_required`
- `interestLevel` 必填，缺失返回 `exit_interest_level_required`
- `trustLevel` 必填，缺失返回 `exit_trust_level_required`
- **阶段绑定**：
  - feed 阶段（未 open_post）只能 `feed_only`，传其他值返回 `exit_reading_depth_invalid_for_feed`
  - post 阶段（已 open_post）不能 `feed_only`，传 `feed_only` 返回 `exit_reading_depth_invalid_for_post`

**行为**：
1. journey.status = finished，更新 RunParticipant runtimeStatus
2. 根据 `reasonCategory` 和 `hasOpenedPost` 推导 `exitOutcome`（见下方映射规则）
3. 根据 `reasonCategory` 生成人类可读 `exitReason` 摘要
4. 写入 `social_interaction_events: exit_browsing`
5. exit_count + 1
6. 结构化参数（`reasonCategory` / `readingDepth` / `interestLevel` / `trustLevel`）写入 AgentToolCall.output 和 transcript tool result
7. 推送 `audience.status_updated`、`post_state.updated`、`audience.action_happened`

**exit_outcome 映射规则**（由 `reasonCategory` 和 `hasOpenedPost` 推导，不再从 action log 风险标签启发式推断）：

```text
!hasOpenedPost                                                    → skipped
reasonCategory ∈ {low_trust, too_ad_like, need_more_evidence}     → risk_exit
否则                                                              → browsed_and_left
max_steps（由 Scheduler 达到最大步数触发，非工具参数推导）          → max_steps
```

**exitReason 摘要映射**：

```text
not_relevant        → 观众认为内容与自己关系不大，结束浏览。
not_interested      → 观众兴趣不足，结束浏览。
low_trust           → 观众信任感较低，结束浏览。
too_ad_like         → 观众觉得广告感较强，结束浏览。
content_too_long    → 观众觉得内容过长，结束浏览。
need_more_evidence  → 观众觉得证据不足，结束浏览。
finished_normally   → 观众正常浏览后离开。
no_more_action      → 观众没有更多动作，结束浏览。
```

**工具 output**：

```json
{
  "ok": true,
  "status": "finished",
  "finished": true,
  "exitOutcome": "browsed_and_left",
  "reasonCategory": "no_more_action",
  "readingDepth": "partial",
  "interestLevel": "medium",
  "trustLevel": "medium"
}
```

**action log 文案**（只记录事实，不写动机）：

```text
{name} 离开了内容
```

### 3.5 多 tool call 提交规则

Agent / AI SDK 可以一次产生多个 tool call。提交规则：

```text
1. 每个工具调用通过统一 runtime service 在自身数据库事务内修改数据并提交（Service Commit）。
2. 提交成功后，立即生成对应事件（如 action_log.created、post_state.updated、comment.created、comments.page_loaded 等）。
3. 提交成功后，立即通过 SSE 推送事件给前端。
4. 所有工具按 callIndex 顺序执行，保证状态变化的因果一致性。
5. 如果某个状态变更工具非法，标记 ignored 或 failed，并继续评估是否还能执行后续安全工具。
6. 非法/不适用调用的结果（ok: false / reason）必须持久化到 agent_tool_calls.output 和 agent_transcript_items。
```

### 3.6 终止工具规则

终止工具只有 `exit_browsing`。一旦生效，后续状态变更工具必须 ignored。

例如：

```text
exit_browsing committed
write_comment ignored: journey already finished
```

### 3.7 Service Commit 保护规则

每个工具通过统一 runtime service 提交数据库，需要以下保护机制：

```text
1. 幂等键：unique(idempotencyKey) 和 unique(agentTurnId, callIndex) 共同防止重试时重复执行副作用。
2. 每个工具在自身独立的数据库事务内运行。
3. 修改数据前必须通过 journey 状态和 DB 环境事实校验。
4. 工具按 callIndex 顺序执行。
5. exit_browsing 执行后，后续状态变更工具直接忽略。
6. 提交成功后立即生成对应事件，并通过 SSE 推送实时事件。
```

### 3.8 工具结果语义

工具像真实环境接口：合法性、幂等、重复调用等由工具/服务基于 DB 事实返回结果，不靠 prompt 自觉。

```text
1. 工具返回值作为 tool result 追加到 session transcript，不改写历史上下文。
2. 点赞、收藏、评论、分享等工具只返回本次接口结果：ok/status、actor 状态、必要计数、commentId 等。
3. like_post / favorite_post 暂不做取消语义，重复调用返回 already_liked / already_favorited 或等价状态，而不是取消。
4. 非法/不适用调用应作为工具结果返回 ok: false / reason 并持久化，而不是只静默 ignored。
5. 提交状态可仍记录 ignored，但 transcript 中要保留 observation（工具返回值）。
```

---

## 4. Scheduler 调度器

### 4.1 调度粒度

Scheduler 的职责是维护 run 级状态、按全局并发补充 waiting 观众，并 claim journey。

```text
RunScheduler
  - 负责 run 级状态扫描
  - 负责 admission
  - 按并发上限 claim runnable AgentJourney
  - 启动 AgentRunner

AgentRunner
  - 独占一个 AgentJourney
  - 在内部循环执行多个 AgentTurn
  - 持续到 AgentJourney terminal
```

### 4.2 锁模型

锁落在 AgentJourney 级，不是 AgentTurn 级。Claim 必须用原子更新，条件包含 `runner_status = queued` 和 `status = active`，并写入 `locked_by / locked_at / heartbeat_at`。Runner 结束时释放锁或把 journey 标记为 terminal。

```sql
UPDATE agent_journeys
SET runner_status = 'running',
    locked_by = workerId,
    locked_at = now()
WHERE id IN (
  SELECT id
  FROM agent_journeys
  WHERE run_id = ?
    AND status = 'active'
    AND runner_status IN ('queued', 'idle')
  ORDER BY queue_seq ASC
  LIMIT ?
)
AND runner_status IN ('queued', 'idle')
RETURNING *
```

### 4.3 Scheduler 主循环

```ts
async function runScheduler(runId: string) {
  while (true) {
    const run = await getRun(runId);
    if (!run || run.status === "completed") break;

    if (run.status === "pausing") {
      await waitForClaimedJourneysToStop(runId);
      await freezeRunClock(runId);
      await markRunPaused(runId);
      break;
    }

    if (run.status !== "running") break;

    await recoverStaleClaimedJourneys(runId);
    await admitUpToGlobalConcurrency(runId);

    const journeys = await claimRunnableJourneys({
      runId,
      limit: defaultConcurrency
    });

    if (journeys.length === 0) {
      if (await canCompleteRun(runId)) await generateReportAndCompleteRun(runId);
      break;
    }

    await Promise.allSettled(journeys.map((journey) => runAgentJourney(journey.id)));
  }
}
```

### 4.4 并发模型

```text
SCHEDULER_DEFAULT_CONCURRENCY = 同时运行中的 Agent 数量上限
```

示例：`SCHEDULER_DEFAULT_CONCURRENCY = 10` 时，最多 10 个观众 Agent 同时运行。某个 Agent 结束浏览后，Scheduler 再从 waiting participant 中补充下一个。

### 4.5 心跳与中断恢复

Runner 心跳通过 `heartbeat_at` 字段维护，更新间隔为 `RUNNER_HEARTBEAT_INTERVAL_SECONDS`（默认 5 秒）。

进程重启后，启动扫描恢复：

```text
running / pausing run
report_generating run
active generation job
stale claimed AgentJourney（heartbeat 过期）
model_returned/tools_executing AgentTurn
pending AgentToolCall
```

如果发现模型已返回但 tool result 缺失，先补齐 failed/ignored tool result，再让 journey 进入可重试状态，避免重复执行已提交工具。

### 4.6 Timeout 配置

```text
MODEL_CALL_TIMEOUT_SECONDS       单次模型调用超时（默认 120 秒）
TOOL_CALL_TIMEOUT_SECONDS        单个 tool handler 超时（默认 30 秒）
AGENT_JOURNEY_TIMEOUT_SECONDS    单个 Agent 从开始运行到 terminal 的总时长上限（默认 300 秒）
RUNNER_HEARTBEAT_INTERVAL_SECONDS 单机内存 runner 的心跳更新间隔（默认 5 秒）
```

模型调用和 tool call 的实际 timeout 会被当前 AgentJourney 剩余预算裁剪，避免单轮调用超过总时长。模型调用 timeout 会向 provider 传递 abort signal。

---

## 5. Agent Runner 执行器

### 5.1 AI SDK 集成

Runner 使用 AI SDK 的 `generateText` 替代手动 OpenAI SDK 调用。一次 `generateText` 调用跑完整个 journey（多步 agent loop）。

```typescript
import { generateText, stepCountIs } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const provider = createOpenAICompatible({
  baseURL: config.baseUrl,
  apiKey: config.apiKey,
});

const model = provider.chatModel(config.models.audience);

const result = await generateText({
  model,
  system: buildAudienceSystemPrompt(context),
  messages: [
    { role: "user", content: buildAudienceIdentityPrompt(context) },
    ...toAiSdkMessages(context.messages)
  ],
  tools: createAiSdkToolSet(ctx),
  temperature: 0.8,
  stopWhen: stepCountIs(20),
  abortSignal: context.signal,
  maxRetries: LLM_MAX_RETRIES,
  onStepEnd: async (step) => {
    // 持久化当前步
    await persistStep(ctx.currentAgentTurnId, step);
    // 创建下一步的 AgentTurn
    ctx.currentAgentTurnId = await createNextTurn(ctx.currentAgentTurnId);
  }
});
```

AI SDK 内部自动处理：
- `reasoning_content` 的读取和回传（`@ai-sdk/openai-compatible` provider 原生支持）
- 消息历史中 reasoning 的保留
- 工具调用的解析（不再有 XML fallback 问题）

### 5.2 createAiSdkToolSet

工具工厂函数，返回 AI SDK 的 `Record<string, Tool>` 格式。每个工具独立定义 `description`、`inputSchema`、`execute`。

### 5.3 withToolContext

公共事务/上下文/幂等/验证包装。每个工具的 `execute` 函数通过它获得事务上下文。

```typescript
type ToolContext = {
  tx: Prisma.TransactionClient;
  action: AgentTurn;
  journey: AgentJourney;
  audience: RunParticipant;
  toolCall: AgentToolCall;
  simulatedTime: number;
};

async function withToolContext(
  agentTurnId: string,
  call: {
    toolName: ToolName;
    callIndex: number;
    sdkCallId?: string;
    idempotencyKey: string;
    args: Record<string, unknown>;
  },
  business: (ctx: ToolContext) => Promise<ToolExecutionResult>
): Promise<string> {
  // 1. 在事务中加载 action/journey/audience/contentVersion
  // 2. 幂等检查：查 AgentToolCall by idempotencyKey
  //    - 已存在且非 pending → 返回已有 observation（幂等）
  // 3. 创建 AgentToolCall 记录
  // 4. 验证（validateToolCall：journey 活跃、工具可用、不重复等）
  //    - 验证失败 → markToolIgnored，返回错误 JSON 给模型
  // 5. 调用 business（commit* 函数）执行业务逻辑
  // 6. 在同一事务内写入 tool observation/transcript item 和 live event outbox
  // 7. 返回工具结果的 JSON 字符串给 AI SDK
}
```

### 5.4 onStepEnd

在每步工具执行完毕后调用，持久化：

- `step.text` — 模型输出文本（thought_text）
- `step.reasoningText` — reasoning 内容（存入 AgentTurn.reasoningContent）
- `step.toolCalls` — 工具调用列表
- `step.toolResults` — 工具执行结果
- `step.response.body` — 原始 API 响应（用于审计，存入 raw_response_json）
- `step.request.body` — 发送的请求（用于审计，存入 request_json）

### 5.5 step 管理

`stopWhen: stepCountIs(20)` 限制最大步数。终止条件由 AI SDK `stopWhen` + 工具逻辑共同控制：

- `exit_browsing` 工具执行时，设置 journey 状态为 finished → AI SDK 下一步发现 journey 已结束，停止
- `stopWhen: stepCountIs(20)` 限制最大步数
- 模型不再调用工具（`finishReason === "stop"`）→ 自然结束

### 5.6 幂等控制

- `(agentTurnId, callIndex)` 保留为唯一约束，用于稳定区分同一个 assistant step 内的第 N 个工具调用
- `idempotencyKey` 全局唯一，格式为 `runId:participantId:agentTurnId:callIndex`
- AI SDK 的 `toolCallId` 存入 `sdkCallId`，只用于审计和排查；provider 是否稳定不应成为系统不变量
- 工具 retry 只能重试已持久化的 `AgentToolCall`，不能重新问模型生成新的工具调用
- 重放同一个 `AgentTurn` 时，看到同一 `callIndex` 或同一 `idempotencyKey` 就返回已有 observation，不重复副作用

### 5.7 多 tool call 执行顺序

多个 tool call 必须按模型返回数组顺序分配 `callIndex`。即使 AI SDK 并发执行工具，提交层也必须使用 `agentTurnId + callIndex` / `idempotencyKey` 做确定性校验与幂等控制。

### 5.8 错误处理

- **验证错误**（重复点赞、评论为空等）：返回错误 JSON 给 AI SDK，模型看到后调整行为
- **严重错误**（DB 连接断开、journey 已失效）：throw 异常，终止 `generateText`，journey 标记失败

### 5.9 工具副作用与 transcript 原子提交

- 工具 `execute` 在事务内：创建/复用 `AgentToolCall` + 执行业务逻辑 + 写入 tool observation/transcript + 写入 live event outbox
- `onStepEnd` 在事务外只补充 assistant text、reasoning、raw request/response 等模型输出审计信息，并与已提交工具结果对齐
- 不允许出现"点赞/评论等副作用已提交，但对应工具 observation 和证据链缺失"的状态

### 5.10 AgentRunner 执行循环

```ts
async function runAgentJourney(agentJourneyId: string) {
  while (true) {
    const state = await loadAgentJourneyState(agentJourneyId);
    if (state.journeyTerminal) return releaseAgentJourney("finished");
    if (state.stepIndex >= maxSteps) return finishJourney("max_steps");

    const turn = await createOrRecoverTurn(agentJourneyId);

    if (!turn.assistantOutputPersisted) {
      const context = await recordOrLoadTurnContext(turn);
      const modelResult = await callAudienceAgent(context);
      validateModelProtocol(modelResult);
      await persistAssistantOutput(turn, modelResult);
    }

    await executePendingToolCalls(turn);
    await applyTurnCompletion(turn);

    if (turn.endedJourney) return releaseAgentJourney("finished");
  }
}
```

### 5.11 LLM Usage Trace

所有 real provider 调用通过 AI SDK telemetry 记录 token 消耗：

```text
llm_call_traces          每次 provider call 的 usage 明细
run_llm_usage_summaries  run 级累计 usage，供审计和后续实时显示读取
```

边界：
- AgentTurn raw audit 保存完整请求/响应，用于回放和排障。
- llm_call_traces 只保存 usage、model、promptVersion、taskType 和关联 ID，不保存 prompt 文本、图片 data URL 或模型输出正文。
- AI SDK multi-step tool loop 中每个 step 都是一次真实 provider call，必须分别写入明细并累加到 run summary。
- token trace 写入失败不得中断主业务流程，只写 warn 日志。

---

## 6. Session 与 Transcript 管理

### 6.1 会话阶段架构

观众运行期分为两个独立的 LLM 会话阶段：

```text
feed session   — 信息流首屏判断阶段
post session   — 帖子详情互动阶段
```

#### Feed Session

```text
初始输入：feed observation（标题、作者、封面/第一张图、正文预览、feed 可见计数等）
工具集合：feed tools（open_post、exit_browsing）
结束条件：open_post 或 exit_browsing
```

#### Post Session

```text
初始输入：post detail observation（标题、作者、全文、全部图片、帖子状态等）
工具集合：post tools（read_post、view_comments、like_post、favorite_post、share_post、write_comment、like_comment、exit_browsing）
结束条件：exit_browsing 或 max steps
```

#### 阶段切换语义

`open_post` 是阶段切换工具：

```text
1. open_post 在 feed session 中执行，完成 feed session。
2. post session 作为新会话创建，从完整帖子 observation 开始。
3. 不把全文作为 feed session 的普通工具结果塞在 feed 会话里。
4. post session 的 transcript 从 post detail observation 起始，不包含 feed session 的对话历史。
```

### 6.2 Transcript 管理

`agent_transcript_items` 是恢复事实源，append-only。恢复时按 journey seq 重放 assistant/tool 结果，不重新构造已提交工具。

LLM messages 由 `agent_transcript_items` append-only transcript 重建：

```text
initial_observation -> user message（含 feed 首图或 post 全部图片）
assistant_message    -> assistant content（含 reasoningContent）
assistant_tool_calls -> assistant tool_calls
tool_result          -> tool message
system_notice        -> user message
```

feed initial_observation 只包含信息流可见字段；post initial_observation 只在 open_post 成功后创建，包含全文、全部图片和当前 post state。评论不在 initial_observation 中，只有 `view_comments` 的 tool_result 会把评论追加进 transcript。

### 6.3 消息格式转换

`toAiSdkMessages` 将 `AudienceSessionMessage[]` 转为 AI SDK 的 `ModelMessage[]` 格式：

- assistant message 合并 thoughtText + reasoningContent + toolCalls 为一个 item
- tool result 转为 AI SDK 的 `ToolModelMessage` 格式
- image content 从 `{ type: "image_url", image_url: { url } }` 转为 `{ type: "image", image: url }`

### 6.4 reasoning_content 处理

AI SDK 的 `@ai-sdk/openai-compatible` provider 双向支持 MiMo 的 `reasoning_content`：

- **读响应**：provider 内部自动从 `choice.message.reasoning_content` 读取
- **发消息**：assistant message 中的 `ReasoningPart` 自动转为 `{ reasoning_content: "..." }` 发回 API

存储链路：
1. `onStepEnd` → `step.reasoningText` 存入 `AgentTurn.reasoningContent` 和 transcript item
2. `renderSessionMessages` → 从 transcript 读 `reasoningContent`，放入 assistant message
3. `toAiSdkMessages` → `ReasoningPart` 传给 AI SDK → provider 自动转为 `reasoning_content` 发回模型

---

## 7. Prompt 与 Tool Use 规则

### 7.1 共享行为基线

以下规则适用于 feed session 和 post session，作为 system prompt 的稳定前缀：

```text
你是普通 {platformName} 用户，正在参与一场 AI 内容试映。

你不是分析师，不打分，不写报告建议。
基于当前 observation 和已有 tool results 行动，像真实用户一样保留自己的需求、偏见、信任机制和浏览耐心。
assistant content 可以表达可展示的主观反应，但不是隐藏 thinking；如果你决定直接行动，也可以只调用工具。
不要为了覆盖工具而机械互动。
```

### 7.2 Feed Session System Prompt

在共享行为基线之后，追加 feed session 专用指令：

```text
你现在只看到信息流卡片。如果想看详情，调用 open_post；如果不想继续，调用 exit_browsing。

本阶段可用工具：open_post, exit_browsing
```

### 7.3 Post Session System Prompt

在共享行为基线之后，追加 post session 专用指令：

```text
你已经进入帖子详情。你可以阅读正文、看评论、点赞、收藏、分享、评论或退出；评论只有通过 view_comments 的工具结果获得。

如果还在看内容但没有明确互动冲动，调用 read_post；如果想验证真实性或看别人经验，调用 view_comments；如果没有继续动机，调用 exit_browsing。

本阶段可用工具：read_post, view_comments, like_post, favorite_post, share_post, write_comment, like_comment, exit_browsing
```

### 7.4 Identity Message

```text
当前观众：
显示名：{displayName}
persona：
{persona_json_pretty}
```

### 7.5 本轮想法输出

本轮想法不是工具。Agent 除 tool call 外的自然语言输出，作为 agent_turns 对应的 thought_text 持久化。

用途：
- 记录看到封面、标题、正文、评论后的主观反应
- 解释为什么点开、点赞、收藏、评论、翻评论或结束浏览
- 作为行动日志和最终报告证据来源
- 帮助后续 Agent turn 保持上下文连续

约束：
- thought_text 是可展示的角色反应，不是隐藏推理链
- 不要求结构化评分
- 不要求沉淀独立 memory
- 不得输出营销分析口吻
- 如果本轮存在 tool call，thought_text 应能解释这些行为的用户动机
- thought_text 不是强制每轮都必须有

回合有效性判断：
- content 非空：可作为可展示 thought_text 保存
- content 为空但有 tool_calls：有效工具回合，不伪造 fallback thought
- content 为空且无 tool_calls：无效回合，触发 repair

#### 7.5.1 action log 与 thought_text 的分层

action log 只记录外部行为事实，不代写主观动机；动机、感受、判断由 `thought_text` 承载。两者分层落库，前端展示时可组合，但数据库不混写。

允许的 action log 文案（只写行为）：

```text
{name} 点开了帖子
{name} 快速扫读了正文
{name} 收藏了帖子
{name} 离开了内容
```

不允许的 action log 文案（代写动机）：

```text
{name} 点开了帖子，想确认内容是不是有具体经验
{name} 收藏了帖子，因为觉得很有用
{name} 离开了内容，因为觉得证据不足
```

具体工具的 action log 文案见 §3.4 各工具子节（如 `read_post` 按 `depth` 分级、`exit_browsing` 按 `reasonCategory` 派生摘要）。前端展示时可将 `thought_text` 与 action log 组合显示（例如"小林：这个标题像我家情况，想进去看看。随后点开了帖子"），但落库时仍按本节分层原则分别持久化。

### 7.6 评论表达规则

允许：

```text
蹲、码住、姐妹、求链接、尊嘟假嘟、别又是广吧、有一说一、这个坑我踩过、这个说法有点绝对
```

允许负面和质疑：

```text
像广告、标题党、不够具体、太绝对、没看到依据、价格来源呢
```

禁止：

```text
真实人身攻击、违法内容、色情内容、仇恨内容、编造真实品牌严重负面事实、无意义脏话刷屏
```

#### 7.6.1 评论 intent 枚举

`write_comment` 工具要求 Agent 在发表评论时必填 `intent` 字段，用于结构化标记评论意图。`intent` 不影响评论正文生成，也不在主评论区展示；它只作为结构化标签供观众详情、证据链和报告层使用。

`intent` 取值（与 `packages/shared` 中 `CommentIntentSchema` 一致）：

```text
ask              提问
doubt            质疑
share_experience 补充个人经验
agree            认同/共鸣
joke             梗/调侃
pushback         反驳/不同意
```

评论正文仍由 Agent 根据 persona 和平台表达习惯自然生成，`intent` 只是对已生成评论的意图归类，不模板化评论内容。缺失 `intent` 的工具调用返回 `comment_intent_required`。

### 7.7 评分规则

Audience Agent 不打分。以下内容不允许由观众 Agent 输出或通过工具提交：

```text
attention score、trust score、value score、interaction_intent score、risk_sensitivity score、scores_delta
```

评分由报告 Agent / 分析层在试映结束后基于证据生成。可使用的证据包括：thought_text、行为日志、互动记录、评论分页行为、最终评论文本、persona 信息。

### 7.8 Agent 不该做的事

不要输出：

```text
这个标题通过制造痛点提升点击率。
该内容转化链路较完整。
建议作者补充信任背书。
我的 attention +0.6，trust -0.2。
```

应该输出：

```text
这个标题有点吓人，我想点开看看是不是我也踩过。
看着有用，但没说具体型号，我有点怕是广。
```

### 7.9 Repair Prompt

当出现以下问题时触发 repair：

- content 为空且无 tool_calls（无效回合）
- 工具参数缺失
- 调用了当前 session 不可用的工具
- write_comment.content 为空
- replyToCommentId 不存在或不属于当前帖子

Repair System Prompt：

```text
你刚才的输出不符合试映用户行为要求。
请重新执行当前回合。

你可以输出一段可展示的用户心路历程，然后按需要调用工具。

只允许根据当前 session 可用工具行动：
{current_session_tools}

不要调用其他工具。不要给内容打分。
```

Repair 只允许一次。repair 仍失败则 action failed 或按失败策略结束该 journey。

### 7.10 Prompt 版本管理

所有 prompt 都必须带版本号：

```text
AUDIENCE_GENERATOR_PROMPT_VERSION = audience_generator_v1
AUDIENCE_SAMPLING_PLAN_REVISION_PROMPT_VERSION = audience_sampling_plan_revision_v1
AUDIENCE_SEAT_REVISION_PROMPT_VERSION = audience_seat_revision_v1
AUDIENCE_AGENT_PROMPT_VERSION = audience_agent_behavior_v1
AUDIENCE_AGENT_PROMPT_VERSION_V1 = audience_agent_ai_sdk_v1（legacy fallback）
REPAIR_PROMPT_VERSION = repair_tool_use_v2
REPORT_PROMPT_VERSION_V1 = report_generator_v1（legacy，产出 flat summary/dimensions/commentPreview/risks/revisionSuggestions/evidenceIndex）
REPORT_PROMPT_VERSION = report_decision_dashboard_v1
```

每个 `agent_turn_context` 需要保存 `model`、`prompt_version`、`input_context_json`。

### 7.11 运行期图片输入边界

- 观众运行期需要看图时，图片必须出现在 user observation 的多模态 content part 中。
- `open_post` 只表达"进入详情页"后的结构化环境事实，不得在 tool result 中返回 `imageUrls`、`image-url` content part 或 `data:image`。
- 原因：AI SDK 的 OpenAI-compatible tool output 会把 content part 序列化到 `tool.content` 字符串中；如果这里包含 data URL，provider 会把 base64 当文本 token 化，而不是当图片输入处理。
- 因此首次 feed observation 中一次性传入当前内容的完整图片列表；后续 tool result 仅返回 JSON 事实。

---

## 8. 暂停/继续与运行控制

### 8.1 暂停语义

用户暂停语义：

```text
1. run.status running -> pausing
2. Scheduler 不再 claim 新 AgentJourney
3. 已运行 AgentRunner 不被打断，继续跑到该 AgentJourney terminal
4. 所有 running AgentRunner 都结束后，run 冻结 clock 并进入 paused
```

暂停不是"暂停当前 Agent 的半截浏览"，而是"停止新 Agent 入场/开始；已经开始浏览的 Agent 保持完整生命周期"。

禁止：

```text
强杀正在进行的模型 HTTP 请求
强杀 tool handler 事务
把已开始的 AgentJourney 标记为 paused 后留待下次继续
```

### 8.2 继续语义

```text
1. run.status paused -> running
2. Scheduler 扫描 active + queued AgentJourney
3. 只启动尚未 terminal 的 AgentJourney
```

### 8.3 系统异常暂停

系统异常升级为 run pause 必须是原子 CAS。只有成功把 run 从 running/pausing/report_generating 改为 paused 的事务写 `run.paused` 事件和 exception log。

### 8.4 前端控制语义

前端必须明确区分三个操作：

```text
暂停试映：POST /pause，进入 paused，可继续
重置试映：POST /reset-runtime，破坏性清理运行期事实，回 audience_ready
结束并生成报告：POST /report，只在 paused 进入 report_generating / completed
```

---

## 9. 重试机制

### 9.1 单 Agent 失败

单个 AgentJourney 失败不应直接导致整个 run 失败。默认语义：

```text
1. AgentJourney.status = failed
2. RunParticipant.runtimeStatus = failed
3. 当前 AgentTurn.status = failed
4. 写 run_log.created
5. 写 audience.status_updated
6. Run 继续运行其他 Agent
7. 前端观众席展示该 Agent 失败，并提供单独重试入口
8. 当失败率超过阈值，或错误被判定为系统性错误时，才升级为 run.paused
```

系统性错误示例：数据库写入不可用、模型配置错误/鉴权错误、tool schema 与代码不一致、同类 Agent 大面积连续失败。

### 9.2 重试策略

`POST /api/runs/:runId/retry`：

```ts
{
  participantId: string;
  strategy?: "continue_retry" | "clean_retry";
}
```

#### continue_retry（默认策略）

保留失败前的 transcript、turn、tool result 和业务事实。在 transcript 末尾追加 system_notice，说明上一轮失败原因。从失败恢复点或下一轮 AgentTurn 继续。

适合模型临时失败、单个工具失败、可解释的环境错误。

#### clean_retry（显式破坏性策略）

删除目标参与者的运行期事实和报告，保留身份与 profile，然后重新入场。

适合用户想让该观众"从头再来"，或失败污染了该 Agent 的行为链。

注意：如果失败前该 Agent 已对帖子产生点赞、收藏、评论等业务事实，`clean_retry` 不能只删 transcript；必须调用同一套数据生命周期清理能力，按 actor / participant 维度删除或回滚该 Agent 的 runtime facts。

### 9.3 LLM 容量控制与 AI SDK 重试配置

LLM 调用容量由 `LlmCapacityManager`（`apps/api/src/llm/llmCapacityManager.ts`）统一管理，替代旧的固定 RPM singleton。所有真实 LLM HTTP 请求都经过 capacity manager 提供的 fetch wrapper。fetch wrapper 会将调用方的 `AbortSignal` 传入排队等待：如果调用方在等待 slot 期间取消（如 AI SDK 超时），排队 promise 会被移除并 reject，不会浪费 dispatch slot。

```text
LlmCapacityManager 职责：
  - RPM + 并发双限流（shared lane）
  - AIMD 自动调整：429/503 时 RPM 减半、并发减 1；连续 successWindow 次成功后小幅上调（默认 successWindow=5, rpmIncreaseStep=2）
  - 429/503 cooldown：优先读取 Retry-After / retry-after-ms，否则使用 auto.cooldownMs
  - 热重载：PUT /api/settings/llm 保存后调用 update() 即时生效
  - maxRetries 统一从 capacity.retry.maxRetries 读取（默认 4）
  - applyRecommendedValues 同时更新 maxRpm/maxConcurrency 上限和 effectiveRpm/effectiveConcurrency 当前值
```

运行时状态：

```text
effectiveRpm           运行时实际 RPM（AIMD 调整后）
effectiveConcurrency   运行时实际并发
inFlight               当前在飞请求数
nextAvailableAt        下一次允许发请求的时间
cooldownUntil          限流冷却结束时间
recentSuccessCount     连续成功计数
recentLimitCount       限流计数
lastLimitAt            最近一次限流时间
lastLimitReason        最近一次限流原因
```

调度规则（每次 HTTP attempt 前）：

```text
1. 未处于 cooldownUntil
2. inFlight < effectiveConcurrency
3. Date.now() >= nextAvailableAt

放行时：
  inFlight += 1
  nextAvailableAt = now + 60_000 / effectiveRpm

响应或异常结束后：
  inFlight -= 1
  根据结果更新自动学习状态
```

AIMD 调整顺序：优先提高 RPM，RPM 接近上限且稳定后再提高并发；遇到限流时同时降 RPM 和并发。

AI SDK retry 配置：

```typescript
// 所有 generateText / streamText 调用统一从 capacity manager 读取
const result = await generateText({
  // ...
  maxRetries: getSharedCapacityManager().getMaxRetries(), // 默认 4
});
```

realAgent 和 reportAgent 都使用同一套 `getSharedCapacityManager().getMaxRetries()`，不再有散落硬编码。`maxRetries = 4` 表示一次逻辑调用最多 5 次 HTTP attempt，每次 attempt 都进入 shared limiter。

容量配置来自 `config/llm.local.yaml` 的 `capacity` 字段，支持 `auto` / `manual` 模式和 `conservative` / `standard` / `high_quota` / `custom` 预设。详细配置结构、API 和校准档位倍增规则见 `02_API契约与共享DTO.md` 第 21 节。

#### 9.3.1 非目标

V1 容量控制刻意不做以下能力，避免成为主线复杂度：

```text
- TPM（token per minute）精确控制
- 按 provider / baseUrl / apiKey / model 分多级容量模型
- fast / pro 分 lane（当前共用一条 shared lane）
- 复杂自适应算法、预测模型或长期容量画像
- 自动探测到非常高的 RPM / 并发上限
- 将 OpenAI-compatible `/models` 的返回结果视为容量事实
- 跨重启持久化运行学习结果（当前 effectiveRpm/effectiveConcurrency 只存内存，重启回保守初始值）
```

#### 9.3.2 AIMD 参数选择

`auto.cooldownMs`、`auto.successWindow`、`auto.rpmIncreaseStep` 是 AIMD 调整的关键参数。默认值 `cooldownMs=15000`、`successWindow=5`、`rpmIncreaseStep=2` 的选择依据：

```text
- successWindow=5：连续 5 次成功才尝试上调，避免瞬时通畅误判
- rpmIncreaseStep=2：每次上调 2 RPM，加速 RPM 爬坡但不冒进
- 遇到 429/503 时 RPM 直接减半、并发减 1，快速退避
```

调整顺序原则：优先提高 RPM；RPM 接近上限且稳定后再提高并发；遇到限流时同时降 RPM 和并发。这样避免过早提高并发导致多个长请求和 AI SDK retry 叠加。

### 9.4 进程恢复

进程崩溃时，中断中的 active journey / 非终态 turn 标记为 failed，然后继续启动仍处于 `running` / `pausing` 的 run，让 run loop 根据剩余 active/ready participant 自然收敛。

已删除的恢复代码：
- `rawAgentOutputJson` 恢复分支（`rawAgentOutputJson` 变为纯审计字段，不再用于恢复）
- `recoverIncompleteToolResultsForAction`
- `recoverInterruptedJourneyRunners`
- `toolCallsFromRawOutput`
- `persistFailedToolCallResults`

---

## 10. 运行时数据生命周期

### 10.1 RunDataLifecycle

运行时数据生命周期通过 `runDataLifecyclePolicies` 配置对象和 `cleanupRuntimeFacts` / `cleanupParticipantRuntimeFacts` 函数管理。`resetRuntime` 和 `clearGeneratedAudience` 等业务操作在 `runService.ts` 中实现，调用 lifecycle 函数完成实际清理。

```text
runDataLifecycle.ts 导出：
  runDataLifecyclePolicies      — 清理策略配置
  cleanupRuntimeFacts(runId)    — 清理 run 级运行时事实
  cleanupParticipantRuntimeFacts(participantId) — 清理单个 participant 的运行时事实

runService.ts 中的业务操作：
  resetRuntime(runId)           — 重置运行时，保留内容和观众
  clearGeneratedAudience(runId) — 清空已生成观众，保留 plan
```

### 10.2 生命周期分组

每张表归属到一个生命周期组：

```text
Content setup facts（reset-runtime 保留，delete-run 删除或引用检查）
  TestRun, ContentVersion, ContentVersionImage, Asset

Audience preparation facts（reset-runtime 保留）
  AudienceSamplingPlan, AudienceSamplingDirective, AudienceProfile,
  AudienceGenerationJob, User, Agent, PlatformAccount

Runtime facts（reset-runtime 删除）
  RunParticipant, AgentJourney, AgentTurn, AgentTurnContext,
  AgentToolCall, AgentTranscriptItem, LiveEvent, SimulatedPostState,
  SocialInteractionEvent, SocialReaction, LoadedCommentPage,
  SimulatedComment, ActionLog, RunLog, LlmCallTrace,
  RunLlmUsageSummary, Insight, Report

Reusable identity / asset facts（reset-runtime 不动，delete-run 引用检查）
  User, Agent, PlatformAccount, Asset
```

ActionLog 是统一结构化时间线事实表。每条记录包含：
- `event_kind`：粗类型（thought / tool_call / system / exception）
- `event_payload_json`：结构化原始 payload（toolName / input / output / content 等）
- `log_text`：fallback 展示文案
- `action`：工具名或 "thought"

展示文案由 view/frontend 从结构化 payload 派生，不再依赖数据库中的中文 `log_text`。

### 10.3 reset-runtime

`POST /api/runs/:runId/reset-runtime` 只允许在 `audience_ready | paused | completed` 状态执行。

删除：
- 所有 runtime facts（见上述分组）
- reports、insights

保留：
- content_versions / content_version_images / assets
- audience_sampling_plans / audience_sampling_directives
- audience_profiles
- generated User / Agent / PlatformAccount
- 用户对观众人设的编辑

重置后 run 回到 `audience_ready`，清空 clock、terminal reason、runtime control state 和报告。

### 10.4 清理策略

强归属数据通过数据库外键 `onDelete: Cascade` 表达：

```text
agent_turns -> agent_journeys
agent_tool_calls -> agent_turns
agent_transcript_items -> agent_journeys
run_logs -> test_runs
live_events -> test_runs
reports -> test_runs
```

弱归属或可复用资源不盲目 cascade（User / Agent / PlatformAccount / Asset），必须经过引用检查、收藏状态和 retentionPolicy 判断。

---

## 11. 时钟与模拟时间

Run Clock 以倍率推进模拟时间。模拟时间用于：

- 工具调用时记录 `simulatedTime`
- SSE 事件中的 `simulatedTime` 字段
- 前端展示时间线

暂停时冻结 clock，继续时恢复。reset-runtime 清空 clock。

---

## 12. 运行时 SSE 事件

### 12.1 Durable Fact Events

保留在 `live_events`，支持 SSE 回放：

```text
run.started
run.pausing
run.paused
run.resumed
run.completed
post_state.updated
comments.page_loaded
comment.created
comment.updated
audience.status_updated
audience.action_happened
action_log.created
summary.updated
run_log.created
report.*
```

### 12.2 audience.action_happened 事件

工具执行成功后，系统通过 SSE 推送 `audience.action_happened` 事件，用于触发观众席与帖子之间的行为联动动画。

```ts
type AudienceActionHappened = {
  type: "audience.action_happened";
  runId: string;
  participantId?: string;
  userId: string;
  platformAccountId: string;
  source: "agent_tool" | "human_ui" | "system_seed" | "replay";
  simulatedTime: number;
  action:
    | "open_post"
    | "read_post"
    | "like_post"
    | "favorite_post"
    | "share_post"
    | "write_comment"
    | "like_comment"
    | "exit_browsing";
  animationHint?: "heart" | "star" | "comment" | "risk" | "skip" | "none";
  exitOutcome?: "skipped" | "browsed_and_left" | "risk_exit" | "max_steps";
  exitReason?: string;
  text?: string;
};
```

animationHint 映射（与 `toolExecutor.emitAudienceEvents` 中 `animationMap` 一致）：

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

`text` 字段由 `audienceActionText` 生成，按 `action` 和 `exitOutcome` 派生：

```text
open_post                → "{name} 点开了内容"
read_post                → "{name} 阅读了正文"
like_post                → "{name} 点赞了这篇内容"
favorite_post            → "{name} 收藏了这篇内容"
share_post               → "{name} 分享了这篇内容"
write_comment            → "{name} 发表了评论"
like_comment             → "{name} 点赞了一条评论"
exit_browsing (skipped)  → "{name} 跳过了内容"
exit_browsing (risk_exit)→ "{name} 离开了内容"
exit_browsing (其他)      → "{name} 结束了浏览"
```

### 12.3 不进入 Live Events 的内容

```text
audience.plan.reasoning.delta（高频 debug telemetry）
debug token stream
prompt dump
provider raw chunk
```

### 12.4 Sequence 与 Reset

`live_events.sequence` 是数据库全局递增序列。reset-runtime 删除该 run 的 `live_events` 后，不要求 sequence 归零。

前端规则：
- 不假设任何 run 的 eventId 从 1 开始
- reset-runtime 成功后清空 seenEventIds 和 latestLiveEventSequenceRef
- 重新加载 run overview，以服务端返回的 latestLiveEventSequence 为准
- 如果 reset 后暂无 live_events，latestLiveEventSequence 可以为 null

### 12.5 前端展示映射

| 来源 | 前端表现 |
|---|---|
| thought_text | 行动日志新增一条用户心路历程 |
| open_post | 点开数变化，当前观众进入详情状态 |
| read_post | 观众状态变为"正在阅读正文"（不更新任何计数，无动画） |
| view_comments | 评论区加载 10 条评论，展示分页状态 |
| like_post | 点赞数跳动 |
| favorite_post | 收藏数跳动 |
| write_comment | 评论区新增评论或回复，评论数跳动 |
| exit_browsing（!hasOpenedPost） | 该观众显示"已跳过"，卡片淡出动画 |
| exit_browsing（其他页面） | 该观众结束浏览，旅程完成统计变化 |

### 12.6 行为事件过滤

只有以下关键行为事件会被观众席和行动日志展示：

```text
open_post、read_post、like_post、favorite_post、share_post、write_comment、like_comment、exit_browsing
```

以下内容不在行动日志中直接展示：

```text
view_comments 的分页加载细节（仅展示评论内容变化）
```

`read_post` 虽然是"看了但不互动"的阅读行为，但它会推送 `audience.action_happened`（`animationHint = "none"`）并写入 action log，用于观众席状态展示和报告层阅读深度统计。

### 12.7 事件流分层

```text
Durable Fact Events   — live_events，支持 SSE 回放
Runtime Logs          — run_logs 是事实源，SSE 只推 run_log.created 通知
Generation Preview    — audience.plan.frame 带 jobId、frameSeq、previewId
Debug/High Frequency  — 不持久化或写入带 TTL 的 debug 表
```

---

## 13. 验证要求

### 13.1 数据一致性

- 每个 tool call 必须落库为 agent_tool_calls，状态为 pending | committed | ignored | failed
- 已经 committed 的 tool call 不得重复执行
- 工具副作用和 transcript 必须在同一事务内原子提交
- 刷新后只要看得到互动副作用，就能找到对应工具调用、observation 和事件证据

### 13.2 状态机

- AgentTurn 状态转换必须按顺序：created → context_recorded → model_calling → model_returned → tools_executing → completed/failed
- Journey 状态：active → finished/failed
- Runner 状态：queued → running → 释放

### 13.3 幂等

- 每个 tool call 的唯一约束：`(agentTurnId, callIndex)` 和 `idempotencyKey`
- 重试时已 committed 的 tool call 不重复执行
- 重放同一 AgentTurn 时，看到同一 callIndex 或同一 idempotencyKey 就返回已有 observation

### 13.4 恢复

- 进程崩溃后，中断中的 journey/turn 标记为 failed
- 不逐步恢复工具调用
- 已持久化 assistant output 后不重跑模型
- 已 committed tool call 不重复执行

### 13.5 Transcript 完整性

- 每个 assistant 消息、tool call 声明、tool result 都写入 agent_transcript_items
- 恢复时按 journey seq 重放，不重新构造已提交工具
- reasoning_content 必须正确保留和回传

### 13.6 并发

- 同一 AgentJourney 同一时刻只允许一个 runner
- Claim 必须用原子 UPDATE
- 并发上限为全局 SCHEDULER_DEFAULT_CONCURRENCY

### 13.7 前端事实源

- 后端 snapshot 是事实源，SSE 是同一事实版本上的增量通知
- 观众相关 snapshot 和 SSE 携带 `audienceRevision`
- 前端收到旧 revision 的 audience 事件必须丢弃
- reset-runtime 成功后清空 seenEventIds，重新加载 snapshot

---

## 附录：交叉引用

- 数据库 Schema 与生命周期：`docs/01_Database_Schema_Spec.md`
- API 契约：`docs/02_API契约与共享DTO.md`
- 观众生成领域规格：`docs/04_观众生成领域规格.md`
- 前端状态与 UI 规范：`docs/05_前端规格.md`
- 测试与验收：`docs/07_测试与验收.md`
- 部署、环境变量、可观测性与排障：`docs/09_部署与运维.md`
