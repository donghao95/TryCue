import { ALLOWED_IMAGE_TYPES, MAX_POST_IMAGES, MAX_UPLOAD_IMAGE_BYTES, MAX_UPLOAD_IMAGE_EDGE } from "../constants.js";
import i18n from "../i18n.js";

export function normalizeImageUrls(imageUrls?: string[] | null, coverImageUrl?: string | null) {
  const urls = [...(imageUrls ?? []), coverImageUrl]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(urls)].slice(0, MAX_POST_IMAGES);
}

export async function prepareImageForUpload(file: File) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error(i18n.t("imageError.unsupportedType"));
  }

  const image = await loadImage(file);
  const maxEdge = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(1, MAX_UPLOAD_IMAGE_EDGE / maxEdge);
  const shouldResize = scale < 1 || file.size > MAX_UPLOAD_IMAGE_BYTES;
  if (!shouldResize) return file;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error(i18n.t("imageError.canvasUnsupported"));
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const outputType = file.type === "image/webp" ? "image/webp" : "image/jpeg";
  const output = await compressCanvasToUploadLimit(canvas, outputType);
  if (output.size > MAX_UPLOAD_IMAGE_BYTES) {
    throw new Error(i18n.t("imageError.tooLarge", { size: formatBytes(MAX_UPLOAD_IMAGE_BYTES) }));
  }
  return new File([output], replaceImageExtension(file.name, outputType), { type: outputType });
}

async function compressCanvasToUploadLimit(canvas: HTMLCanvasElement, outputType: string) {
  const qualities = [0.9, 0.82, 0.74, 0.66, 0.58];
  let workingCanvas = canvas;
  let best: Blob | null = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    for (const quality of qualities) {
      const output = await canvasToBlob(workingCanvas, outputType, quality);
      if (!best || output.size < best.size) best = output;
      if (output.size <= MAX_UPLOAD_IMAGE_BYTES) return output;
    }
    workingCanvas = resizeCanvas(workingCanvas, 0.85);
  }

  return best ?? canvasToBlob(canvas, outputType, qualities[qualities.length - 1]!);
}

function resizeCanvas(source: HTMLCanvasElement, scale: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error(i18n.t("imageError.canvasUnsupported"));
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(i18n.t("imageError.unreadable")));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(i18n.t("imageError.compressFailed")));
    }, mimeType, quality);
  });
}

function replaceImageExtension(filename: string, mimeType: string) {
  const ext = mimeType === "image/webp" ? ".webp" : ".jpg";
  const basename = filename.replace(/\.[^.]+$/, "");
  return `${basename || "image"}${ext}`;
}

export function formatBytes(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}
