import { Prisma } from "@trycue/db";
import type { AudiencePersonaJson } from "@trycue/shared/audience";
import type { AudienceSamplingPlanDraft } from "../agents/types.js";
import { ApiError } from "../errors.js";
import { directiveQuantityTotal, objectRecord } from "./audienceGenerationViews.js";

/**
 * Audience sampling plan helpers: draft validation, persona normalization,
 * and editable-plan total sync.
 *
 * Migrated from runService.ts module-level functions.
 *
 * Dependency direction: imports `objectRecord` and `directiveQuantityTotal`
 * from audienceGenerationViews (leaf). This keeps the dependency graph
 * single-directional — views never imports this module.
 *
 * Note: `syncEditableSamplingPlanTotal` writes to the database (updates
 * `audienceSamplingPlan.totalCount` and `testRun.audienceCount`), so this
 * file is named "Helpers" rather than "Validation" to reflect its mixed
 * responsibilities.
 */
export async function syncEditableSamplingPlanTotal(tx: Prisma.TransactionClient, runId: string, planId: string) {
  const directives = await tx.audienceSamplingDirective.findMany({
    where: { planId },
    select: { quantity: true }
  });
  const quantityTotal = directiveQuantityTotal(directives);
  // 乐观锁：只在 plan 仍未确认（confirmedAt = null）时更新 totalCount。
  // 防止 directive 编辑/删除事务在 confirm 提交后排队获取锁、覆盖 confirm 已写入的
  // totalCount/audienceCount，破坏 plan.totalCount == testRun.audienceCount == job.targetCount 三者一致性。
  // requireEditableSamplingPlan 事务外只检查 confirmedAt，不检查 status，
  // 所以 confirm 把 status 改成 expanding_profiles 后，排队的 directive 事务仍会进入——
  // 此处 updateMany where confirmedAt: null 是最后一道防线。
  // 即使 quantityTotal === 0（删除最后一条 directive），也必须做乐观锁检查，
  // 否则 delete 静默成功不抛 409。
  const updateData = quantityTotal > 0 ? { totalCount: quantityTotal } : {};
  const updated = await tx.audienceSamplingPlan.updateMany({
    where: { id: planId, confirmedAt: null },
    data: updateData
  });
  if (updated.count === 0) {
    throw new ApiError("PLAN_CONFIRMED", "观众计划已确认，不能修改人群计划项", 409);
  }
  if (quantityTotal > 0) {
    await tx.testRun.updateMany({ where: { id: runId }, data: { audienceCount: quantityTotal } });
  }
}

export function validateAudienceSamplingPlanDraft(plan: AudienceSamplingPlanDraft, count: number) {
  if (!plan || typeof plan !== "object") throw new Error("AUDIENCE_PLAN_FAILED: provider did not return a plan object.");
  if (plan.totalCount !== count) throw new Error("AUDIENCE_PLAN_FAILED: totalCount must match requested audience count.");
  if (!Array.isArray(plan.directives) || plan.directives.length === 0) throw new Error("AUDIENCE_PLAN_FAILED: directives must be non-empty.");
  const total = plan.directives.reduce((sum, directive) => sum + Number(directive.quantity ?? 0), 0);
  if (total !== count) throw new Error("AUDIENCE_PLAN_FAILED: directive quantities must match requested audience count.");
  for (const directive of plan.directives) {
    if (!directive.name?.trim() || !directive.description?.trim() || !directive.rationale?.trim()) {
      throw new Error("AUDIENCE_PLAN_FAILED: directive fields are incomplete.");
    }
    if (!Array.isArray(directive.diversityAxes) || !directive.diversityAxes.length) {
      throw new Error("AUDIENCE_PLAN_FAILED: directive diversityAxes must be non-empty.");
    }
  }
}

const VALID_MBTI_TYPES = new Set(["INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"]);
const REQUIRED_DEMOGRAPHICS_FIELDS = ["gender", "ageRange", "cityTier", "lifeStage", "role", "spendingPower"];

export function normalizePersonaJson(value: unknown): AudiencePersonaJson {
  const persona = objectRecord(value);
  return {
    profile: requirePersonaString(persona.profile, "profile"),
    personality: requirePersonaString(persona.personality, "personality"),
    mbtiType: requireMbtiType(persona.mbtiType) as AudiencePersonaJson["mbtiType"],
    responseStyle: requirePersonaString(persona.responseStyle, "responseStyle")
  };
}

function requireMbtiType(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!VALID_MBTI_TYPES.has(raw)) {
    throw new Error(`AUDIENCE_GENERATION_FAILED: persona.mbtiType must be one of 16 MBTI types, received "${value}".`);
  }
  return raw;
}

function requirePersonaString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`AUDIENCE_GENERATION_FAILED: persona.${field} must be a non-empty string.`);
  }
  return value.trim();
}

// Re-exported so runService can reference the constant set without duplicating it.
export { REQUIRED_DEMOGRAPHICS_FIELDS, VALID_MBTI_TYPES };
