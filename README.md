# TryCue

TryCue 是一个 AI 试映工作台，用于在发布前模拟观众画像对社交内容草稿的反应。

V1 的范围是单版本试映流程：创建一条内容草稿，生成并审核观众采样计划，运行模拟观众行为流，实时观察交互证据，最终从持久化证据生成报告。

## V1 功能概览

- 从标题、正文和图片创建试映任务。
- 生成 `AudienceSamplingPlan` 和可编辑的 `AudienceSamplingDirective`，再创建具体身份。
- 将已确认的指令展开为 `AudienceProfile`，然后创建 `User / Agent / PlatformAccount` 身份。
- 通过实例化 `RunParticipant` 快照启动模拟运行。
- 通过运行时调度器和允许的工具驱动观众行为。
- 通过 SSE 实时推送状态。
- 从持久化的操作、评论、互动、日志和证据生成最终报告。

TryCue 不连接真实的小红书或任何外部社交平台，不操作真实 DOM，也不声称能预测真实平台表现。

## 路线图

### V2 —— 观众实时对话

V1 中，观众只能通过预定义的工具动作与模拟帖子交互。V2 新增**直接与观众对话**的能力——在试映运行期间或结束后，打开与任意观众画像的实时对话，追问细节，深挖他们的反应，获得基于其模拟身份和行为历史的对话式回应。

## 项目结构

```text
apps/api          Fastify API、SSE、调度器、Agent 提供者
apps/web          Vite React 工作台
packages/db       Prisma schema、迁移、种子数据
packages/shared   共享 Zod 契约、DTO、枚举、SSE 事件类型
docs              产品、架构、API、运行时、前端和运维文档
```

## 本地开发

安装依赖：

```bash
pnpm install
```

在 Windows / PowerShell 下启动本地服务：

```powershell
pnpm dev:local
```

这会在 `data/trycue.db` 创建 SQLite 数据库，执行迁移，并启动 API 和 Web 服务器。

常用检查：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm verify
```

## 配置

复制示例配置文件作为本地配置起点：

```bash
cp .env.example .env.local
cp config/llm.example.yaml config/llm.local.yaml
```

然后填入自己的本地值。`.env.local` 和 `config/llm.local.yaml` 不会被 Git 追踪。

应用和数据库配置从 `.env.local` 或 `.env` 读取。默认 `DATABASE_URL` 使用本地 SQLite 文件（`file:./data/trycue.db`）。LLM 运行时配置从 `LLM_CONFIG_PATH` 指向的 YAML 文件读取，通常是 `config/llm.local.yaml`。

API 密钥必须保存在服务端。不得通过设置 GET API 返回、存储到前端 localStorage、嵌入 URL 或写入日志。

运行时模式：

```text
mock   使用 mock 提供者，即使存在真实提供者配置
real   要求 apiKey、baseUrl、models.fast 和 models.pro
```

前端 UI 文案通过 `i18next` + `react-i18next` 外部化，资源文件在 `apps/web/src/locales/`，支持中英文界面切换。新增或修改 UI 文案必须通过 `t(key)` 引用，不直接硬编码中文；设计见 [docs/05_前端规格.md](docs/05_前端规格.md) 第 19 节。

## 文档

从 [docs/00_README_文档索引.md](docs/00_README_文档索引.md) 开始阅读。它定义了文档的优先级顺序、阅读路径和维护规则。

重要入口：

- [数据库 Schema](docs/01_Database_Schema_Spec.md)
- [API 契约](docs/02_API契约与共享DTO.md)
- [Agent 运行时设计](docs/03_Agent运行时设计.md)
- [前端规格](docs/05_前端规格.md)
- [观众生成](docs/04_观众生成领域规格.md)
- [部署与运维](docs/09_部署与运维.md)

当实现与文档不一致时，应随代码变更一起更新相关文档，或修正实现以匹配当前文档。

## 开源边界

本仓库为开源核心项目，不包含以下内容：

- 真实 API Key、真实环境配置文件（使用 `.env.example` / `config/llm.example.yaml` 作为模板）
- 生产部署配置、服务器凭证
- 真实用户数据、真实内容样本、真实报告输出
- 内部代码审查记录、实现状态追踪、未公开产品路线图
- Codex / Claude 等 AI 助手内部产物

本地开发使用仓库内的 mock 数据和示例配置即可启动。`runtimeMode=mock` 模式无需任何真实 LLM 凭证。
