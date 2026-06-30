import { prisma } from "@trycue/db";
import { ApiError } from "../errors.js";

/**
 * Identity cleanup helpers + runtime audience reference guard.
 *
 * Migrated from runService.ts module-level functions and one private method.
 *
 * `assertNoRuntimeAudienceReferences` was a private method on RunService that
 * only queried prisma; it's now a standalone async function.
 *
 * Note: This stage only extracts the low-risk identity helpers and the
 * reference-count guard. The heavier identity cleanup paths
 * (`cleanupProfileIdentity`, `cleanupIdentityByIds`, reference checks across
 * runtime tables) intentionally stay in runService because they involve
 * transactions and multi-table reference checks.
 */
export function profileIdentityIds(profile: { generatedUserId: string | null; generatedAgentId: string | null; generatedPlatformAccountId: string | null }) {
  return {
    userIds: profile.generatedUserId ? [profile.generatedUserId] : [],
    agentIds: profile.generatedAgentId ? [profile.generatedAgentId] : [],
    platformAccountIds: profile.generatedPlatformAccountId ? [profile.generatedPlatformAccountId] : []
  };
}

export function shouldDeleteAgentIdentity(agent: { retentionPolicy: string; favoritedAt: Date | null }) {
  return agent.retentionPolicy === "delete_with_origin_run" && !agent.favoritedAt;
}

export function hasCompleteProfileIdentity(profile: { generatedUserId: string | null; generatedAgentId: string | null; generatedPlatformAccountId: string | null }) {
  return Boolean(profile.generatedUserId && profile.generatedAgentId && profile.generatedPlatformAccountId);
}

/**
 * Guard: reject destructive replan if any runtime audience reference exists.
 *
 * Throws `REPLAN_BLOCKED` (409) if the run already has `RunParticipant` rows,
 * because replanning would orphan runtime facts (journeys, interactions, logs)
 * that reference those participants.
 */
export async function assertNoRuntimeAudienceReferences(runId: string) {
  const participantCount = await prisma.runParticipant.count({ where: { runId } });
  if (participantCount > 0) {
    throw new ApiError("REPLAN_BLOCKED", "已有观众入场或试映历史引用，不能破坏性重新规划", 409);
  }
}
