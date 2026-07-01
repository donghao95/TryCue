# TryCue

**AI 内容试映工作台：在真正发布前，把内容交给一组 AI 观众试映。**

把一篇社交内容草稿发布到一个模拟试映现场，观察不同观众如何浏览、停留、点赞、收藏、评论和离开，并基于完整行为证据生成反馈报告。

TryCue 不是一个简单的“AI 打分器”，而是一个可观察、有行为过程、有证据链的 AI 内容试映系统。

<p align="center">
  <a href="https://github.com/donghao95/TryCue/stargazers">
    <img src="https://img.shields.io/github/stars/donghao95/TryCue?style=social" alt="GitHub stars">
  </a>
  <a href="https://github.com/donghao95/TryCue/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/donghao95/TryCue" alt="License">
  </a>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#核心功能">核心功能</a> ·
  <a href="#工作流程">工作流程</a> ·
  <a href="#文档">文档</a> ·
  <a href="#路线图">路线图</a>
</p>

> TryCue 不连接真实社交平台，不操作真实 DOM。所有互动数据均为 AI 试映模拟结果，仅用于内容自检、产品研究和开发实验。

---

## 预览

> 截图 / GIF 后续补充。

建议优先放一张主图，直接展示“AI 试映现场”：

```text
左侧：模拟帖子 / 评论区 / 实时互动
右侧：AI 观众席 / 观众状态 / 运行日志
顶部：试映进度 / 控制按钮 / 状态提示
```

建议图片路径：

```text
docs/assets/screenshot-live.png        AI 试映现场
docs/assets/screenshot-create.png      内容创建与试映设置
docs/assets/screenshot-audience.png    AI 观众生成与审核
docs/assets/screenshot-report.png      试映报告
```

---

## 快速开始

TryCue 默认支持 mock 模式，无需真实 LLM API Key 即可体验。

### 方式一：Docker（推荐，零依赖）

适合只想快速体验的普通用户。只需安装 Docker。

**Windows / PowerShell：**

```powershell
.\scripts\docker-run.ps1
```

**macOS / Linux：**

```bash
chmod +x scripts/docker-run.sh
./scripts/docker-run.sh
```

脚本会自动拉取镜像、创建数据目录和配置模板，并启动容器。启动完成后访问 http://localhost:4000

或手动启动：

```bash
cp config/llm.example.yaml config/llm.local.yaml
docker compose up -d
```

### 方式二：本地开发

适合想阅读源码、二次开发的开发者。需要 Node.js 24+ 和 pnpm 10.4.0。

**Windows / PowerShell：**

```powershell
pnpm install
powershell -ExecutionPolicy Bypass -File ./scripts/run-local.ps1
```

**macOS / Linux：**

```bash
pnpm install
chmod +x scripts/run-local.sh
./scripts/run-local.sh
```

启动后访问终端输出的本地地址，通常是 http://localhost:3000

### 切换到 real 模式

mock 模式用于快速体验。要使用真实 LLM 生成更丰富的观众行为，编辑 `config/llm.local.yaml`：

```yaml
runtimeMode: real
apiKey: "your-api-key"
baseUrl: "https://your-llm-endpoint/v1"
models:
  fast: "model-name-fast"
  pro: "model-name-pro"  # 需支持 vision（使用封面图时）
```

详细配置说明见 [docs/09_部署与运维.md](docs/09_部署与运维.md)。

---

## TryCue 解决什么问题

很多内容在正式发布前，真正需要的不是一个抽象分数，而是这些问题的答案：

- 标题第一眼有没有吸引力？
- 封面和正文是否让目标用户愿意继续看？
- 哪些人会点赞、收藏、评论？
- 哪些人会快速离开？
- 评论区可能出现什么质疑、共鸣或误解？
- 不同人群的反馈权重是否一样？
- 这篇内容应该发布、修改，还是重写？

TryCue 的目标是把这些问题变成一场可观察的 AI 试映。

你不是得到一段静态 AI 建议，而是看到一组 AI 观众进入现场、阅读内容、产生判断、执行行为，并留下可追溯的证据。

---

## 核心功能

### 内容创建

- 输入标题、正文和图片
- 创建一条待试映的内容草稿
- 使用模拟社交帖子承载内容
- 支持 mock 数据快速体验完整流程

### AI 观众生成

- 生成观众采样计划
- 生成可编辑的观众采样指令
- 将采样指令展开为具体观众画像
- 创建模拟用户、Agent 和平台身份
- 支持在试映前审核和调整观众

### 实时试映现场

- 将内容发布到 AI 试映现场
- 通过调度器驱动观众逐步行动
- 使用 SSE 推送实时状态
- 实时更新帖子互动、评论区、观众席和运行日志
- 支持观察每个观众的状态和行为过程

### 观众行为模拟

V1 中，AI 观众可以执行这些模拟行为：

```text
open_post       打开帖子
view_comments   查看评论
like_post       点赞帖子
favorite_post   收藏帖子
share_post      分享帖子
write_comment   写评论
like_comment    点赞评论
exit_browsing   离开浏览
```

这些行为会写入持久化数据，作为后续报告的证据来源。

### 试映报告

试映结束后，TryCue 会基于持久化证据生成报告，包括：

- 内容整体表现
- 互动表现
- 评论反馈
- 人群反应
- 典型动机
- 主要阻力
- 风险提示
- 修改建议
- 发布建议

报告不是凭空生成，而是基于运行过程中保存的操作、评论、日志和证据。

---

## 工作流程

```text
创建内容草稿
  -> 生成观众采样计划
  -> 审核和调整观众分布
  -> 创建具体 AI 观众
  -> 启动 AI 试映
  -> 观察实时互动
  -> 收集行为证据
  -> 生成试映报告
```

```mermaid
flowchart LR
  Draft[内容草稿] --> Plan[观众采样计划]
  Plan --> Directive[观众采样指令]
  Directive --> Profile[观众画像]
  Profile --> Identity[模拟身份]
  Identity --> Run[试映运行]
  Run --> Evidence[行为 / 评论 / 日志 / 证据]
  Evidence --> Report[试映报告]
```

---

## 适合谁使用

TryCue 适合：

- 内容创作者：发布前检查标题、封面、正文和评论风险
- 产品 / 运营：验证内容表达、卖点、目标人群反馈
- 创业者：快速测试一个内容方向是否容易被理解
- AI Agent 开发者：研究多 Agent 行为模拟和证据链报告
- 内容产品团队：探索“发布前试映”类 AI 工作流

---

## 技术栈

TryCue 是一个 TypeScript monorepo 项目。

主要技术栈：

- pnpm workspace
- TypeScript
- Vite
- React
- Fastify
- Prisma
- SQLite
- Zod
- SSE
- i18next / react-i18next
- AI Provider 抽象层

---

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

---

## 运行模式

TryCue 支持两种运行模式：

```text
mock   使用 mock 提供者，不需要真实 LLM API Key
real   使用真实 LLM 提供者，需要配置 apiKey、baseUrl、models.fast 和 models.pro
```

本地体验和开发建议优先使用 mock 模式。

real 模式适合接入真实模型，验证 Agent 行为质量和报告生成效果。

---

## 给 AI Coding Agent 的入口

如果你使用 Codex、Claude Code、Cursor、Windsurf 或其他 AI Coding Agent 修改 TryCue，建议先阅读：

```text
docs/00_README_文档索引.md
docs/01_Database_Schema_Spec.md
docs/02_API契约与共享DTO.md
docs/03_Agent运行时设计.md
docs/04_观众生成领域规格.md
docs/05_前端规格.md
docs/06_报告生成规格.md
docs/07_测试与验收.md
```

推荐顺序：

```text
先读 docs/00_README_文档索引.md
再按任务选择对应领域文档
最后运行 pnpm verify
```

---

## 文档

从这里开始阅读：

```text
docs/00_README_文档索引.md
```

重要文档：

```text
docs/01_Database_Schema_Spec.md       数据库 Schema
docs/02_API契约与共享DTO.md           API 契约与共享 DTO
docs/03_Agent运行时设计.md             Agent 运行时设计
docs/04_观众生成领域规格.md            观众生成
docs/05_前端规格.md                    前端规格
docs/06_报告生成规格.md                报告生成
docs/07_测试与验收.md                  测试与验收
docs/08_Demo数据规格.md                Demo 数据
docs/09_部署与运维.md                  部署与运维
```

当实现和文档不一致时，应随代码变更同步更新相关文档，或修正实现以匹配当前文档。

---

## 当前状态

TryCue 目前处于 V1 阶段。

V1 目标：

- 完成单版本内容试映流程
- 支持内容创建
- 支持观众生成和审核
- 支持 AI 观众运行
- 支持实时现场观察
- 支持基于证据生成报告
- 支持 mock 模式本地启动
- 保持开源核心仓库可运行、可审查、可扩展

暂不包含：

- 多版本 PK
- 真实社交平台连接
- 真实 DOM 自动化
- 生产级多租户系统
- 真实用户数据接入
- 复杂计费和权限系统

---

## 路线图

### V1：单版本 AI 试映

- 内容创建
- 观众采样计划
- 观众画像生成
- 模拟身份创建
- 实时试映
- 行为证据持久化
- 最终报告生成

### V2：观众实时对话

V2 计划增加“与观众对话”的能力：

- 在试映运行期间追问某个观众
- 在试映结束后采访某个观众
- 深挖他们为什么点赞、收藏、评论或离开
- 基于该观众的身份、行为历史和证据链进行对话

### 未来方向

可能探索：

- 多版本内容对比
- 更复杂的评论区互动
- 更丰富的观众生命周期
- 更细的人群权重分析
- 更强的报告证据链展示
- 更多内容平台样式模板
- 可插拔 Agent Provider
- 更完整的 Demo 数据集

---

## 开源边界

本仓库是 TryCue 的开源核心项目。

仓库不包含：

- 真实 API Key
- 真实环境配置文件
- 生产部署配置
- 服务器凭证
- 真实用户数据
- 真实内容样本
- 真实报告输出
- 内部代码审查记录
- 未公开产品路线图
- Codex / Claude 等 AI 助手内部产物

本地开发使用仓库内 mock 数据和示例配置即可启动。

---

## 贡献

欢迎围绕以下方向贡献：

- 修复 bug
- 改进本地启动体验
- 完善 mock 数据
- 优化前端交互
- 改进观众生成质量
- 完善报告结构
- 增加测试用例
- 改进文档
- 提供新的内容试映场景

提交 PR 前请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [docs/07_测试与验收.md](docs/07_测试与验收.md)，并通过 `pnpm verify`。

请遵守 [Code of Conduct](CODE_OF_CONDUCT.md)。安全漏洞按 [SECURITY.md](SECURITY.md) 流程报告，不要开公开 Issue。

---

## License

Apache-2.0
