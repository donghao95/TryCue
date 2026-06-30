import { Prisma } from "@trycue/db";

/**
 * Audience profile snapshot helpers.
 *
 * Migrated from runService.ts module-level functions.
 *
 * These are pure JSON/snapshot transforms used when persisting audience
 * profiles and platform accounts during identity generation. They don't
 * touch the database and have no internal dependencies.
 */
export function profileSnapshot(profile: {
  id: string;
  samplingPlanId: string | null;
  samplingDirectiveId: string | null;
  samplingLabel: string;
  demographicsJson: unknown;
}) {
  return {
    profileId: profile.id,
    samplingPlanId: profile.samplingPlanId,
    samplingDirectiveId: profile.samplingDirectiveId,
    samplingLabel: profile.samplingLabel,
    demographicsJson: profile.demographicsJson
  };
}

export function platformAccountSnapshot(platformAccount: { id: string; platform: string }) {
  return {
    platformAccountId: platformAccount.id,
    platform: platformAccount.platform
  };
}

export function jsonInputOrEmpty(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) return {};
  return value as Prisma.InputJsonValue;
}
