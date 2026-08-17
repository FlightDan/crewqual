export const SOURCE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
]);

export const CHROME_HEIC_MESSAGE = "Chrome 不支持 HEIC/HEIF，请转换为 JPEG/PNG 后上传";
export const SAFARI_HEIC_MESSAGE = "Safari 无法读取该 HEIC/HEIF，请转换为 JPEG/PNG 后上传";

export type CropPixels = { x: number; y: number; width: number; height: number };

export function isSafari() {
  if (typeof navigator === "undefined") return false;
  return /Safari/i.test(navigator.userAgent) && !/Chrome|CriOS|Android/i.test(navigator.userAgent);
}

export function validateSourceImage(file: Pick<File, "type">) {
  if (!SOURCE_IMAGE_TYPES.has(file.type)) return "仅支持 JPEG、PNG、WebP、AVIF、GIF 图片";
  if ((file.type === "image/heic" || file.type === "image/heif") && !isSafari())
    return CHROME_HEIC_MESSAGE;
  return null;
}

async function decodeImage(file: Blob) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image decode failed"));
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasFor(width: number, height: number) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("Canvas is not available");
}

export async function processImageToJpeg(file: Blob, crop: CropPixels): Promise<Blob> {
  const image = await decodeImage(file);
  const imageWidth = "naturalWidth" in image ? image.naturalWidth : image.width;
  const imageHeight = "naturalHeight" in image ? image.naturalHeight : image.height;
  const x = Math.min(imageWidth - 1, Math.max(0, Math.floor(crop.x)));
  const y = Math.min(imageHeight - 1, Math.max(0, Math.floor(crop.y)));
  const source = {
    x,
    y,
    width: Math.min(imageWidth - x, Math.max(1, Math.floor(crop.width))),
    height: Math.min(imageHeight - y, Math.max(1, Math.floor(crop.height))),
  };
  const scale = Math.min(1, 2560 / Math.max(source.width, source.height));
  const outputWidth = Math.max(1, Math.round(source.width * scale));
  const outputHeight = Math.max(1, Math.round(source.height * scale));
  const canvas = canvasFor(outputWidth, outputHeight);
  const context = canvas.getContext("2d") as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error("Canvas context is not available");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, outputWidth, outputHeight);
  context.drawImage(
    image as CanvasImageSource,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    outputWidth,
    outputHeight,
  );
  if ("close" in image && typeof image.close === "function") image.close();
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas)
    return canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  return new Promise<Blob>((resolve, reject) =>
    (canvas as HTMLCanvasElement).toBlob(
      (blob: Blob | null) => (blob ? resolve(blob) : reject(new Error("JPEG encoding failed"))),
      "image/jpeg",
      0.9,
    ),
  );
}

export async function readImageSize(file: Blob) {
  const image = await decodeImage(file);
  const size = {
    width: "naturalWidth" in image ? image.naturalWidth : image.width,
    height: "naturalHeight" in image ? image.naturalHeight : image.height,
  };
  if ("close" in image && typeof image.close === "function") image.close();
  return size;
}
