import { unlink } from "node:fs/promises";
import { prisma, Prisma } from "@trycue/db";
import type { CreateRunRequest } from "@trycue/shared/run";
import { localAssetPathForStorageKey, localStorageKeyFromUrl, prepareModelImageUrls } from "./modelImages.js";
import { isString } from "./audienceGenerationViews.js";

/**
 * Run image asset helpers: URL normalization, asset upsert, and cleanup.
 *
 * Migrated from runService.ts module-level functions and private methods.
 *
 * Dependency direction: imports `isString` from audienceGenerationViews (leaf).
 *
 * `cleanupUnreferencedAssets` and `prepareAgentImageUrls` were private methods
 * on RunService that only used `this.uploadDir`; they're now standalone functions
 * that receive `uploadDir` as a parameter.
 */
export async function cleanupUnreferencedAssets(uploadDir: string, assetIds: string[]) {
  if (assetIds.length === 0) return { deletedAssets: 0, deletedLocalFiles: 0 };

  // Batch: find all referenced asset IDs in one query
  const referencedRows = await prisma.contentVersionImage.findMany({
    where: { assetId: { in: assetIds } },
    select: { assetId: true },
    distinct: ["assetId"]
  });
  const referencedIds = new Set(referencedRows.map((r) => r.assetId));
  const unreferencedIds = assetIds.filter((id) => !referencedIds.has(id));
  if (unreferencedIds.length === 0) return { deletedAssets: 0, deletedLocalFiles: 0 };

  // Batch: fetch all unreferenced assets
  const assets = await prisma.asset.findMany({ where: { id: { in: unreferencedIds } } });

  // Batch: delete all unreferenced assets
  await prisma.asset.deleteMany({ where: { id: { in: unreferencedIds } } });

  // Clean up local files
  let deletedLocalFiles = 0;
  for (const asset of assets) {
    if (asset.storage === "local" && asset.storageKey) {
      const filePath = localAssetPathForStorageKey(uploadDir, asset.storageKey);
      if (filePath) {
        const removed = await unlink(filePath).then(() => true).catch(() => false);
        if (removed) deletedLocalFiles += 1;
      }
    }
  }
  return { deletedAssets: assets.length, deletedLocalFiles };
}

export async function prepareAgentImageUrls(uploadDir: string, imageUrls: string[]) {
  return prepareModelImageUrls(imageUrls, uploadDir);
}

export async function linkContentVersionImages(tx: Prisma.TransactionClient, contentVersionId: string, imageUrls: string[]) {
  for (const [index, url] of imageUrls.entries()) {
    const asset = await ensureAssetForUrl(tx, url);
    await tx.contentVersionImage.create({
      data: {
        contentVersionId,
        assetId: asset.id,
        url,
        sortOrder: index
      }
    });
  }
}

export async function ensureAssetForUrl(tx: Prisma.TransactionClient, url: string) {
  const local = localStorageKeyFromUrl(url);
  return tx.asset.upsert({
    where: { url },
    create: {
      url,
      storage: local ? "local" : "external",
      storageKey: local
    },
    update: {}
  });
}

export function normalizeStoredImageUrls(imageUrlsJson: unknown, coverImageUrl?: string | null) {
  const urls = Array.isArray(imageUrlsJson)
    ? imageUrlsJson.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (coverImageUrl && !urls.includes(coverImageUrl)) urls.unshift(coverImageUrl);
  return [...new Set(urls)];
}

export function normalizeInputImageUrls(input: CreateRunRequest) {
  return uniqueNonEmptyStrings([input.coverImageUrl, ...(input.imageUrls ?? [])]).slice(0, 9);
}

export function contentImageUrls(imageUrlsJson: unknown, coverImageUrl: string | null) {
  const stored = Array.isArray(imageUrlsJson) ? imageUrlsJson : [];
  return uniqueNonEmptyStrings([...stored, coverImageUrl]);
}

export function uniqueNonEmptyStrings(values: unknown[]) {
  return [...new Set(values.filter(isString).map((value) => value.trim()).filter(Boolean))];
}

export function unique(values: string[]) {
  return [...new Set(values)];
}
