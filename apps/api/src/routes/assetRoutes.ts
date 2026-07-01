import { createWriteStream } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyPluginAsync } from "fastify";
import { imageSize } from "image-size";
import { prisma } from "@trycue/db";
import { ok } from "@trycue/shared/api";
import { ApiError, sendApiError } from "../errors.js";
import { log } from "../logger.js";

/**
 * Deps injected from buildApp. Only runtime config is injected; `prisma`,
 * `imageSize`, `pipeline`, etc. are imported directly.
 */
export interface AssetRoutesDeps {
  uploadDir: string;
  maxCoverImageSizeMb: number;
}

/**
 * Registers the asset upload route.
 *
 * Routes migrated from app.ts:
 * - POST /api/upload
 *
 * Error handling note: keeps the original try/catch because of the special
 * `FST_REQ_FILE_TOO_LARGE` branch that maps to a 400 with a size-specific
 * message. `wrapHandler` would lose that branch.
 *
 * Helpers `mimeToExt`, `isMultipartFileTooLarge`, `isMultipartFileStreamTruncated`
 * are migrated from app.ts module-level functions — only consumed by this route.
 */
export function assetRoutes(deps: AssetRoutesDeps): FastifyPluginAsync {
  const { uploadDir, maxCoverImageSizeMb } = deps;
  return async (app) => {
    app.post("/api/upload", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
      try {
        const file = await request.file();
        if (!file) throw new ApiError("VALIDATION_ERROR", "文件缺失", 400);
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
          throw new ApiError("VALIDATION_ERROR", "仅支持 jpg/png/webp", 400);
        }
        const ext = mimeToExt(file.mimetype);
        const assetId = `asset_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const filename = `${assetId}${ext}`;
        const target = join(uploadDir, filename);
        await pipeline(file.file, createWriteStream(target));
        if (isMultipartFileStreamTruncated(file.file)) {
          await unlink(target).catch((err) => log.debug({ err, path: target }, "Failed to unlink truncated upload"));
          throw new ApiError("VALIDATION_ERROR", `图片不能超过 ${maxCoverImageSizeMb}MB`, 400);
        }
        const fileBytes = await readFile(target);
        const dimensions = imageSize(fileBytes);
        if ((dimensions.width && dimensions.width > 4096) || (dimensions.height && dimensions.height > 4096)) {
          await unlink(target).catch((err) => log.debug({ err, path: target }, "Failed to unlink oversized upload"));
          throw new ApiError("VALIDATION_ERROR", "图片尺寸过大，请压缩到最长边 4096px 以内", 400);
        }
        const url = `/uploads/${filename}`;
        const asset = await prisma.asset.create({
          data: {
            storage: "local",
            url,
            storageKey: filename,
            originalName: file.filename,
            mimeType: file.mimetype,
            width: dimensions.width,
            height: dimensions.height,
            sizeBytes: fileBytes.byteLength
          }
        });
        return ok({
          url,
          assetId: asset.id,
          width: dimensions.width,
          height: dimensions.height,
          mimeType: file.mimetype
        });
      } catch (error) {
        if (isMultipartFileTooLarge(error)) {
          return sendApiError(reply, new ApiError("VALIDATION_ERROR", `图片不能超过 ${maxCoverImageSizeMb}MB`, 400));
        }
        return sendApiError(reply, error);
      }
    });
  };
}

/**
 * Map an accepted image MIME type to its file extension.
 * Migrated from app.ts module-level helper — only consumed by POST /api/upload.
 */
function mimeToExt(mimeType: string) {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return ".png";
}

/**
 * Detect Fastify multipart `FST_REQ_FILE_TOO_LARGE` errors.
 * Migrated from app.ts module-level helper — only consumed by POST /api/upload.
 */
function isMultipartFileTooLarge(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE";
}

/**
 * Detect whether a multipart file stream was truncated (hit the size limit mid-stream).
 * Migrated from app.ts module-level helper — only consumed by POST /api/upload.
 */
function isMultipartFileStreamTruncated(file: unknown) {
  return typeof file === "object" && file !== null && "truncated" in file && Boolean((file as { truncated?: boolean }).truncated);
}
