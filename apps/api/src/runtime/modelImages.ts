import { readFile } from "node:fs/promises";
import { basename, join, normalize, sep } from "node:path";

export function localStorageKeyFromUrl(url: string) {
  if (!url.startsWith("/uploads/")) return null;
  const key = basename(url);
  return key ? key : null;
}

export function localAssetPathForStorageKey(uploadDir: string, storageKey: string) {
  const target = normalize(join(uploadDir, storageKey));
  const root = normalize(uploadDir);
  return target.startsWith(`${root}${sep}`) ? target : null;
}

export async function prepareModelImageUrls(imageUrls: string[], uploadDir: string) {
  return Promise.all(imageUrls.map(async (url) => {
    if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
    const key = localStorageKeyFromUrl(url);
    if (!key) return url;
    const filePath = localAssetPathForStorageKey(uploadDir, key);
    if (!filePath) return url;
    try {
      const bytes = await readFile(filePath);
      return `data:${mimeTypeFromFilename(key)};base64,${bytes.toString("base64")}`;
    } catch {
      return url;
    }
  }));
}

function mimeTypeFromFilename(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}
