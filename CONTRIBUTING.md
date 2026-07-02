# 贡献指南

感谢你对 TryCue 的兴趣！本文说明如何参与贡献。

## 行为准则

参与本项目即代表你同意遵守 [Code of Conduct](CODE_OF_CONDUCT.md)。请在所有交流中保持尊重和友善。

## 先决条件

- Node.js 24+
- pnpm 10.4.0（仓库通过 `packageManager` 字段固定版本）
- Windows / macOS / Linux 均可，本地开发脚本以 PowerShell 为主

## 本地开发环境

```bash
# 1. 克隆并安装依赖
git clone https://github.com/donghao95/TryCue.git
cd TryCue
pnpm install

# 2. 准备本地配置（默认 mock 模式，无需真实 LLM Key）
cp .env.example .env.local
cp config/llm.example.yaml config/llm.local.yaml

# 3. 生成 Prisma Client 并执行开发迁移
pnpm db:generate
pnpm db:migrate

# 4. （可选）写入 demo 种子数据
pnpm db:seed-demo

# 5. 启动本地开发服务
pnpm dev:local
```

Windows / PowerShell 推荐使用 `pnpm dev:local`；其他系统可使用通用 `pnpm dev`。

## 项目结构

```text
apps/api          Fastify API、SSE、调度器、Agent 提供者
apps/web          Vite React 工作台
packages/db       Prisma schema、迁移、种子数据
packages/shared   共享 Zod 契约、DTO、枚举、SSE 事件类型
docs              产品、架构、API、运行时、前端和运维文档
config            LLM 运行时配置模板
scripts           本地开发和辅助脚本
```

修改代码前，请先阅读 [docs/00_README_文档索引.md](docs/00_README_文档索引.md)，按任务类型选择对应领域文档。

## 关键约定

### API 与共享契约

- 跨 API 边界的 request/response DTO 优先定义在 `packages/shared`。
- 需要运行时校验的 request body 使用 `packages/shared` 导出的 Zod schema。
- 不要在 `apps/web/src/types.ts` 复制 API response 类型。
- 不要把 Prisma row type 直接暴露为 API DTO。
- API 字段变更时，同步更新 `docs/02_API契约与共享DTO.md`。

### Run 生命周期与状态机

- 数据库 run 状态固定为：`draft` / `planning_audience` / `generating_audience` / `audience_ready` / `running` / `pausing` / `paused` / `report_generating` / `completed`。
- `starting` 只是前端瞬时 UI 状态，不是数据库 run 状态。
- Tool call 状态统一为 `pending | committed | ignored | failed`，提交层必须做幂等控制。

### 前端

- UI 文案必须通过 `t(key)` 或 `i18n.t(key)` 引用，不直接硬编码中文。
- 新增 i18n key 同步补到 `apps/web/src/locales/zh-CN.ts` 和 `apps/web/src/locales/en-US.ts`。
- 第一屏是可用工作台，不是营销 landing page。
- 页面需保留模拟标识：`以下互动为 AI 试映模拟结果，不代表真实平台数据。`

### 文档同步

当实现与文档不一致时，应随代码变更同步更新相关文档，或修正实现以匹配当前文档。文档事实源以 [docs/00_README_文档索引.md](docs/00_README_文档索引.md) 为准。

## 提交前检查

提交 PR 前必须通过完整验证：

```bash
pnpm verify
```

该命令依次执行：`db:generate` → `lint` → `typecheck` → `test` → `test:integration` → `build`。

窄范围改动可先跑最小相关检查；触及共享边界或用户可见流程时跑完整 `pnpm verify`。

## 提交规范

使用 Conventional Commits 风格：

```text
<type>(<scope>): <subject>

<body>
```

常见 type：

- `feat` 新功能
- `fix` Bug 修复
- `refactor` 重构（不改行为）
- `docs` 文档
- `test` 测试
- `chore` 构建、配置、依赖

示例：

```text
feat(audience): 支持采样指令批量编辑
fix(scheduler): 修复暂停后继续的状态合并顺序
docs(api): 补充 report regenerated 事件契约
```

## PR 流程

1. 从 `main` 拉取最新代码创建功能分支：`feat/<short-desc>` / `fix/<short-desc>`
2. 确保 `pnpm verify` 通过
3. PR 描述说明：改了什么、为什么改、如何验证、是否更新文档
4. 关联相关 Issue（如有）
5. 等待 CI 通过和 code review

## 报告 Bug 与提议功能

- Bug 请通过 GitHub Issues 提交，并附上复现步骤、期望行为和实际行为
- 功能提议请说明使用场景和动机，避免直接堆功能
- 安全漏洞请按 [SECURITY.md](SECURITY.md) 流程私下报告，不要开公开 Issue

## 开源边界

TryCue 是开源核心项目，仓库不包含真实 API Key、真实用户数据、生产部署配置、内部审查记录或未公开路线图。贡献内容不应引入这些敏感信息。

## CI 与发版（Fork 用户注意）

本仓库使用 [release-please](https://github.com/googleapis/release-please) 自动维护版本号和 GitHub Release，并依赖 `release-please.yml` 中的 **PAT**（Personal Access Token）触发 Docker 镜像构建。

**Fork 后需手动配置 Secret 才能启用自动发版：**

1. 前往 [GitHub Developer Settings → Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. 创建新的 Fine-grained PAT：
   - Token name: `GH_PAT`（或任意名称）
   - Expiration: 选择合理期限（建议 1 年）
   - Repository access: 仅限此 fork 仓库
   - Permissions → Repository permissions:
     - **Contents**: Read and write
     - **Actions**: Read and write
     - **Workflows**: Write
3. 在 Fork 仓库的 Settings → Secrets and variables → Actions 中创建名为 `GH_PAT` 的 Secret，粘贴上一步生成的 token

配置后，合并到 main 分支的 PR 将自动触发 release-please 工作流，打 tag 后自动构建 Docker 镜像推送到你的 GHCR。
