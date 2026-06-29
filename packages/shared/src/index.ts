/**
 * @trycue/shared barrel.
 *
 * 领域拆分（PR3）：
 * - 拆分为 7 个领域文件，按"为什么会一起变化"组织。
 * - 依赖图（无循环）：tool / audience / llm / api → 无依赖；
 *   report → audience + tool；run → tool + report；live-events → run。
 * - 此文件仅做 re-export，保持 `import { ... } from "@trycue/shared"` 的公共 API 不变。
 *
 * 不要在 index.ts 里直接新增类型/常量；新增内容应放入对应领域文件，
 * 然后通过这里的 `export *` 自动暴露。
 */

export * from "./api.js";
export * from "./tool.js";
export * from "./audience.js";
export * from "./llm.js";
export * from "./report.js";
export * from "./run.js";
export * from "./live-events.js";
