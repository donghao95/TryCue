import { prisma, Prisma } from "@trycue/db";
import type {
  AudienceGenerationJobView,
  AudienceGenerationProgressView,
  AudienceProfileView,
  AudienceSamplingDirective,
  AudienceSamplingPlanView
} from "@trycue/shared/audience";
import type { AudienceSamplingDirectiveView, AudienceSamplingPlanViewForProvider } from "../agents/types.js";

/**
 * Audience generation view helpers + builders.
 *
 * Migrated from runService.ts module-level functions and private methods.
 *
 * This module is the leaf of the audience-generation dependency graph: it owns
 * the low-level normalizers (`isString`, `jsonStringArray`, `objectRecord`,
 * `normalizeDemographics`) that other modules (`runImageAssets`, `audiencePlanHelpers`)
 * import. Keeping them here prevents circular imports.
 *
 * Dependency direction (single, no cycles):
 *   audienceGenerationViews (leaf)
 *     ↑
 *   runImageAssets, audiencePlanHelpers
 *     ↑
 *   runService (root)
 */
export const profileViewInclude = {
  generatedAgent: true,
  generatedPlatformAccount: true,
  generatedUser: true
} satisfies Prisma.AudienceProfileInclude;

export function profileView(profile: {
  id: string;
  samplingPlanId?: string | null;
  samplingDirectiveId: string | null;
  sampleIndex?: number;
  generationJobId?: string | null;
  sortOrder: number;
  samplingLabel: string;
  demographicsJson?: unknown;
  identityStatus: string;
  identityError: string | null;
  identityGeneratedAt: Date | null;
  generatedUserId: string | null;
  generatedAgentId: string | null;
  generatedPlatformAccountId: string | null;
  generatedAgent?: {
    id: string;
    userId: string;
    personaJson: unknown;
    memorySummary: string | null;
    retentionPolicy: string;
    favoritedAt: Date | null;
  } | null;
  generatedUser?: { id: string; userType: string; nickname: string; avatarUrl: string | null } | null;
  generatedPlatformAccount?: { id: string; userId: string; platform: string } | null;
  createdAt: Date;
  updatedAt: Date;
}): AudienceProfileView {
  return {
    id: profile.id,
    profileId: profile.id,
    samplingPlanId: profile.samplingPlanId ?? null,
    samplingDirectiveId: profile.samplingDirectiveId,
    sampleIndex: profile.sampleIndex ?? 0,
    generationJobId: profile.generationJobId,
    sortOrder: profile.sortOrder,
    samplingLabel: profile.samplingLabel,
    demographicsJson: normalizeDemographics(profile.demographicsJson),
    identityStatus: profile.identityStatus as AudienceProfileView["identityStatus"],
    identityError: profile.identityError,
    identityGeneratedAt: profile.identityGeneratedAt?.toISOString() ?? null,
    generatedUserId: profile.generatedUserId,
    generatedAgentId: profile.generatedAgentId,
    generatedPlatformAccountId: profile.generatedPlatformAccountId,
    identity: profile.generatedAgent
      ? {
          user: profile.generatedUser
            ? {
                id: profile.generatedUser.id,
                userType: profile.generatedUser.userType,
                nickname: profile.generatedUser.nickname,
                avatarUrl: profile.generatedUser.avatarUrl
              }
            : null,
          agent: {
            id: profile.generatedAgent.id,
            userId: profile.generatedAgent.userId,
            memorySummary: profile.generatedAgent.memorySummary
          },
          platformAccount: profile.generatedPlatformAccount
            ? {
                id: profile.generatedPlatformAccount.id,
                userId: profile.generatedPlatformAccount.userId,
                platform: profile.generatedPlatformAccount.platform
              }
            : null,
          personaJson: objectRecord(profile.generatedAgent.personaJson),
          retentionPolicy: profile.generatedAgent.retentionPolicy,
          favorited: Boolean(profile.generatedAgent.favoritedAt),
          saved: Boolean(profile.generatedAgent.favoritedAt)
        }
      : null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString()
  };
}

export function participantView(participant: {
  id: string;
  sourceProfileId: string | null;
  samplingDirectiveId: string | null;
  sortOrder: number;
  userId: string;
  agentId: string;
  platformAccountId: string;
  source: string;
  displayNameSnapshot: string;
  avatarUrlSnapshot: string | null;
  profileSnapshotJson: unknown;
  agentSnapshotJson: unknown;
  platformAccountSnapshotJson: unknown;
  runtimeStatus: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    participantId: participant.id,
    id: participant.id,
    sourceProfileId: participant.sourceProfileId,
    samplingDirectiveId: participant.samplingDirectiveId,
    sortOrder: participant.sortOrder,
    userId: participant.userId,
    agentId: participant.agentId,
    platformAccountId: participant.platformAccountId,
    source: participant.source,
    displayName: participant.displayNameSnapshot,
    avatarUrl: participant.avatarUrlSnapshot,
    profileSnapshot: participant.profileSnapshotJson,
    agentSnapshot: participant.agentSnapshotJson,
    platformAccountSnapshot: participant.platformAccountSnapshotJson,
    runtimeStatus: participant.runtimeStatus,
    createdAt: participant.createdAt.toISOString(),
    updatedAt: participant.updatedAt.toISOString()
  };
}

export function jobView(job: {
  id: string;
  runId: string;
  scope: string;
  status: string;
  active: boolean;
  profileId: string | null;
  samplingPlanId?: string | null;
  samplingDirectiveId?: string | null;
  targetCount: number;
  batchSize: number;
  errorMessage: string | null;
  attemptCount: number;
  heartbeatAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AudienceGenerationJobView {
  return {
    id: job.id,
    runId: job.runId,
    scope: job.scope as AudienceGenerationJobView["scope"],
    status: job.status as AudienceGenerationJobView["status"],
    active: job.active,
    profileId: job.profileId,
    samplingPlanId: job.samplingPlanId ?? null,
    samplingDirectiveId: job.samplingDirectiveId ?? null,
    targetCount: job.targetCount,
    batchSize: job.batchSize,
    errorMessage: job.errorMessage,
    attemptCount: job.attemptCount,
    heartbeatAt: job.heartbeatAt?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    canceledAt: job.canceledAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString()
  };
}

export function directiveProgressView(
  directive: { id: string; description: string; quantity: number; expansionStatus: string; expansionError: string | null },
  profiles: Array<{ identityStatus: string }>
) {
  return {
    directiveId: directive.id,
    description: directive.description,
    targetCount: directive.quantity,
    profileCreatedCount: profiles.length,
    identityReadyCount: profiles.filter((profile) => profile.identityStatus === "identity_ready").length,
    identityFailedCount: profiles.filter((profile) => profile.identityStatus === "identity_failed").length,
    generationStatus: directive.expansionStatus as "pending" | "generating" | "ready" | "failed",
    generationError: directive.expansionError
  };
}

export function samplingPlanView(plan: {
  id: string;
  runId: string;
  totalCount: number;
  status: string;
  planMarkdown: string;
  dimensionsJson: unknown;
  confirmedAt: Date | null;
  directives: Array<{
    id: string;
    sortOrder: number;
    name: string;
    description: string;
    quantity: number;
    diversityAxesJson: unknown;
    rationale: string;
    groupRole: string;
    samplingReason: string;
    expansionStatus: string;
    expansionError: string | null;
  }>;
}): AudienceSamplingPlanView {
  const directives = plan.directives.map((directive) => ({
    id: directive.id,
    sortOrder: directive.sortOrder,
    name: directive.name,
    description: directive.description,
    quantity: directive.quantity,
    diversityAxes: jsonStringArray(directive.diversityAxesJson),
    rationale: directive.rationale,
    groupRole: directive.groupRole as AudienceSamplingDirective["groupRole"],
    samplingReason: directive.samplingReason,
    expansionStatus: directive.expansionStatus as "pending" | "generating" | "ready" | "failed",
    expansionError: directive.expansionError
  }));
  return {
    planId: plan.id,
    runId: plan.runId,
    totalCount: plan.totalCount,
    status: plan.status as AudienceSamplingPlanView["status"],
    planMarkdown: plan.planMarkdown,
    dimensions: jsonStringArray(plan.dimensionsJson),
    confirmedAt: plan.confirmedAt?.toISOString() ?? null,
    directives,
    validation: samplingPlanValidation(plan.totalCount, plan.directives)
  };
}

export function samplingPlanValidation(totalCount: number, directives: Array<{ quantity: number }>) {
  const quantityTotal = directiveQuantityTotal(directives);
  const issues: string[] = [];
  if (!directives.length) issues.push("至少需要一条人群计划项");
  for (const [index, directive] of directives.entries()) {
    if (!Number.isInteger(directive.quantity) || directive.quantity < 0) issues.push(`第 ${index + 1} 条人群数量不能为负数`);
  }
  return {
    quantityTotal,
    expectedTotal: totalCount,
    isQuantityValid: issues.length === 0,
    issues
  };
}

export function directiveQuantityTotal(directives: Array<{ quantity: number }>) {
  return directives.reduce((sum, directive) => sum + directive.quantity, 0);
}

export function directiveToProviderView(directive: {
  id: string;
  sortOrder: number;
  name: string;
  description: string;
  quantity: number;
  diversityAxesJson: unknown;
  rationale: string;
  expansionStatus?: string | null;
  expansionError?: string | null;
}): AudienceSamplingDirectiveView {
  return {
    id: directive.id,
    sortOrder: directive.sortOrder,
    name: directive.name,
    description: directive.description,
    quantity: directive.quantity,
    diversityAxes: jsonStringArray(directive.diversityAxesJson),
    rationale: directive.rationale,
    expansionStatus: directive.expansionStatus ?? undefined,
    expansionError: directive.expansionError ?? null
  };
}

// ── Builder functions (migrated from RunService private methods) ──
// These query prisma directly and don't depend on `this`, so they become
// standalone async functions.

export async function buildAudienceSamplingPlanView(runId: string) {
  const plan = await prisma.audienceSamplingPlan.findUnique({
    where: { runId },
    include: { directives: { orderBy: { sortOrder: "asc" } } }
  });
  return plan ? samplingPlanView(plan) : null;
}

export async function buildAudienceSamplingPlanViewById(planId: string) {
  const plan = await prisma.audienceSamplingPlan.findUniqueOrThrow({
    where: { id: planId },
    include: { directives: { orderBy: { sortOrder: "asc" } } }
  });
  return samplingPlanView(plan);
}

export async function buildAudienceGenerationProgress(runId: string): Promise<AudienceGenerationProgressView> {
  const [plan, profiles, activeJob] = await Promise.all([
    prisma.audienceSamplingPlan.findUnique({
      where: { runId },
      include: { directives: { orderBy: { sortOrder: "asc" } } }
    }).catch(() => null),
    prisma.audienceProfile.findMany({ where: { runId }, orderBy: [{ samplingDirectiveId: "asc" }, { sortOrder: "asc" }], include: profileViewInclude }),
    prisma.audienceGenerationJob.findFirst({ where: { runId, active: true }, orderBy: { createdAt: "desc" } })
  ]);
  const profilesByDirective = new Map<string, typeof profiles>();
  for (const profile of profiles) {
    const key = profile.samplingDirectiveId ?? "";
    profilesByDirective.set(key, [...(profilesByDirective.get(key) ?? []), profile]);
  }
  const directiveProgress = plan?.directives.map((directive) => {
    const directiveProfiles = profilesByDirective.get(directive.id) ?? [];
    return directiveProgressView(directive, directiveProfiles);
  }) ?? [];
  return {
    runId,
    planId: plan?.id ?? null,
    status: plan?.status ?? "not_started",
    total: plan?.totalCount ?? 0,
    profileCreatedCount: profiles.length,
    identityReadyCount: profiles.filter((profile) => profile.identityStatus === "identity_ready").length,
    identityFailedCount: profiles.filter((profile) => profile.identityStatus === "identity_failed").length,
    activeJob: activeJob ? jobView(activeJob) : null,
    directives: directiveProgress,
    profiles: profiles.map(profileView)
  };
}

export async function buildDirectiveProgress(directiveId: string) {
  const directive = await prisma.audienceSamplingDirective.findUniqueOrThrow({ where: { id: directiveId } });
  const profiles = await prisma.audienceProfile.findMany({ where: { samplingDirectiveId: directiveId } });
  return directiveProgressView(directive, profiles);
}

export async function buildProviderPlanView(planId: string): Promise<AudienceSamplingPlanViewForProvider> {
  const view = await buildAudienceSamplingPlanViewById(planId);
  return {
    planId: view.planId,
    runId: view.runId,
    totalCount: view.totalCount,
    status: view.status,
    planMarkdown: view.planMarkdown,
    dimensions: view.dimensions,
    directives: view.directives.map((directive) => ({
      id: directive.id,
      sortOrder: directive.sortOrder,
      name: directive.name,
      description: directive.description,
      quantity: directive.quantity,
      diversityAxes: directive.diversityAxes,
      rationale: directive.rationale,
      expansionStatus: directive.expansionStatus,
      expansionError: directive.expansionError
    }))
  };
}

// ── Low-level normalizers (leaf helpers) ──
// These are imported by runImageAssets.ts and audiencePlanHelpers.ts.
// Keeping them here avoids circular imports.

export function jsonStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeDemographics(value: unknown): AudienceProfileView["demographicsJson"] {
  const record = objectRecord(value);
  return {
    gender: isString(record.gender) ? record.gender : "不限定",
    ageRange: isString(record.ageRange) ? record.ageRange : "不限定",
    cityTier: isString(record.cityTier) ? record.cityTier : "不限定",
    lifeStage: isString(record.lifeStage) ? record.lifeStage : "不限定",
    role: isString(record.role) ? record.role : "不限定",
    spendingPower: isString(record.spendingPower) ? record.spendingPower : "不限定"
  };
}
