## 改动说明

<!-- 简述这个 PR 做了什么、为什么做。如果有关联 Issue，写上 Closes #xxx / Refs #xxx。 -->

## 改动类型

- [ ] feat 新功能
- [ ] fix Bug 修复
- [ ] refactor 重构（不改行为）
- [ ] docs 文档
- [ ] test 测试
- [ ] chore 构建 / 配置 / 依赖
- [ ] other 其他

## 影响范围

<!-- 勾选受影响的层；触及共享边界或用户可见流程时跑完整 pnpm verify。 -->

- [ ] `packages/shared`（共享 DTO / Zod 契约）
- [ ] `packages/db`（Prisma schema / migration / seed）
- [ ] `apps/api`（API / Scheduler / Runner / 状态机 / 持久化）
- [ ] `apps/web`（前端 UI / 状态 / i18n）
- [ ] `docs/`（规格文档）
- [ ] CI / 构建 / 配置
- [ ] 不影响代码（纯文档等）

## 验证

- [ ] `pnpm verify` 通过
- [ ] 触及共享边界时跑了受影响的 API/Web typecheck
- [ ] 触及状态机 / 持久化 / API 行为时跑了 `pnpm test:integration`
- [ ] 触及前端行为时通过本地 dev server 验证

<!-- 如果某些检查无法运行，请说明原因。 -->

## 文档同步

- [ ] API / DTO 变更已同步到 `docs/02_API契约与共享DTO.md`
- [ ] DB / migration / 生命周期变更已同步到 `docs/01_Database_Schema_Spec.md`
- [ ] Agent / Scheduler / Runner 变更已同步到 `docs/03_Agent运行时设计.md`
- [ ] 前端行为变更已同步到 `docs/05_前端规格.md`
- [ ] 无需同步文档（改动不涉及公开契约）

## 开源边界自检

- [ ] 没有引入真实 API Key、真实用户数据、生产凭证
- [ ] 没有引入对未公开私有仓库或内部未发布包的运行时依赖
- [ ] 没有把内部路线图、商业判断、未公开计划写进公开 docs
