import { createHash, randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import { getServerConfig } from "@/server/config";
import { ApiError } from "@/server/api-error";
import { getRuntimeStorageConfig, type RuntimeStorageConfig } from "@/server/runtime-storage";
import { createPinnedS3Client } from "@/server/s3-client";

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const MAX_EVIDENCE_DIMENSION = 2560;

async function getS3(config: RuntimeStorageConfig) {
  return createPinnedS3Client(config);
}

export async function putPrivateObjectAtKey(
  objectKey: string,
  bytes: Uint8Array,
  contentType: "image/jpeg" | "image/avif",
  sha256: string,
  providedConfig?: RuntimeStorageConfig,
) {
  assertStorageAccess();
  const config = providedConfig ?? (await getRuntimeStorageConfig());
  await (
    await getS3(config)
  ).send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: objectKey,
      Body: bytes,
      ContentType: contentType,
      Metadata: { sha256 },
      ...(config.S3_SSE_KMS_KEY_ID
        ? { ServerSideEncryption: "aws:kms" as const, SSEKMSKeyId: config.S3_SSE_KMS_KEY_ID }
        : {}),
      CacheControl: "private, max-age=0, no-store",
    }),
  );
}

function assertStorageAccess() {
  if (getServerConfig().SERVICE_MODE === "mock") {
    throw new Error("Object storage access is disabled in mock mode");
  }
}

function readJpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new ApiError("INVALID_IMAGE", "只允许上传处理后的 JPEG 图片", 422);
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = (bytes[offset] << 8) + bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xc3;
    if (
      isStartOfFrame ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      const height = (bytes[offset + 3] << 8) + bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) + bytes[offset + 6];
      return { width, height };
    }
    offset += segmentLength;
  }
  throw new ApiError("INVALID_IMAGE", "JPEG 无法解码或缺少尺寸信息", 422);
}

export async function validateProcessedJpeg(bytes: Uint8Array) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_EVIDENCE_BYTES) {
    throw new ApiError("IMAGE_TOO_LARGE", "图片不能超过 10 MiB", 422);
  }
  const parsed = readJpegDimensions(bytes);
  const metadata = await sharp(Buffer.from(bytes))
    .metadata()
    .catch(() => null);
  if (!metadata || metadata.format !== "jpeg" || !metadata.width || !metadata.height) {
    throw new ApiError("INVALID_IMAGE", "JPEG 无法解码或缺少尺寸信息", 422);
  }
  const width = metadata.width || parsed.width;
  const height = metadata.height || parsed.height;
  if (width > MAX_EVIDENCE_DIMENSION || height > MAX_EVIDENCE_DIMENSION) {
    throw new ApiError("IMAGE_DIMENSIONS_TOO_LARGE", "图片最长边不能超过 2560px", 422);
  }
  const last = bytes.length - 2;
  if (bytes[last] !== 0xff || bytes[last + 1] !== 0xd9) {
    throw new ApiError("INVALID_IMAGE", "JPEG 文件不完整", 422);
  }
  // Never trust the client-side re-encoding as the canonical stored object.
  // Re-encode on the server to strip EXIF/GPS/comments and any non-image
  // payload while retaining the original values for backwards-compatible
  // validation callers.
  const sanitized = await sharp(Buffer.from(bytes)).rotate().jpeg({ quality: 90 }).toBuffer();
  const sanitizedMetadata = await sharp(sanitized).metadata();
  if (!sanitizedMetadata.width || !sanitizedMetadata.height) {
    throw new ApiError("INVALID_IMAGE", "JPEG 无法生成安全副本", 422);
  }
  return {
    width: sanitizedMetadata.width,
    height: sanitizedMetadata.height,
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    storageBytes: new Uint8Array(sanitized),
    storageByteSize: sanitized.byteLength,
    storageSha256: createHash("sha256").update(sanitized).digest("hex"),
  };
}

export async function putPrivateEvidence(bytes: Uint8Array, sha256: string) {
  return putPrivateObject(bytes, sha256, "image/jpeg", "jpg");
}

export async function putPrivateObject(
  bytes: Uint8Array,
  sha256: string,
  contentType: "image/jpeg" | "image/avif",
  extension: "jpg" | "avif",
) {
  assertStorageAccess();
  const config = await getRuntimeStorageConfig();
  const objectKey = `evidence/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
  await (
    await getS3(config)
  ).send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: objectKey,
      Body: bytes,
      ContentType: contentType,
      Metadata: { sha256 },
      ...(config.S3_SSE_KMS_KEY_ID
        ? { ServerSideEncryption: "aws:kms" as const, SSEKMSKeyId: config.S3_SSE_KMS_KEY_ID }
        : {}),
      CacheControl: "private, max-age=0, no-store",
    }),
  );
  return objectKey;
}

export async function convertJpegToLosslessAvif(bytes: Uint8Array) {
  const source = await sharp(Buffer.from(bytes)).raw().toBuffer({ resolveWithObject: true });
  const encoded = await sharp(Buffer.from(bytes)).avif({ lossless: true }).toBuffer();
  const decoded = await sharp(encoded).raw().toBuffer({ resolveWithObject: true });
  if (
    source.info.width !== decoded.info.width ||
    source.info.height !== decoded.info.height ||
    createHash("sha256").update(source.data).digest("hex") !==
      createHash("sha256").update(decoded.data).digest("hex")
  ) {
    throw new ApiError("IMAGE_CONVERSION_FAILED", "AVIF 像素校验未通过", 422);
  }
  const metadata = await sharp(encoded).metadata();
  if (!metadata.width || !metadata.height || !["avif", "heif"].includes(metadata.format ?? "")) {
    throw new ApiError("IMAGE_CONVERSION_FAILED", "AVIF 无法生成安全副本", 422);
  }
  return {
    storageBytes: new Uint8Array(encoded),
    width: metadata.width,
    height: metadata.height,
    byteSize: encoded.byteLength,
    sha256: createHash("sha256").update(encoded).digest("hex"),
  };
}

export async function getPrivateEvidenceUrl(objectKey: string, expiresIn = 300) {
  assertStorageAccess();
  const config = await getRuntimeStorageConfig();
  return getSignedUrl(
    await getS3(config),
    new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }),
    { expiresIn },
  );
}

export async function readPrivateEvidence(objectKey: string) {
  assertStorageAccess();
  const config = await getRuntimeStorageConfig();
  const result = await (
    await getS3(config)
  ).send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }));
  if (!result.Body) throw new Error("Evidence object has no body");
  return new Uint8Array(await result.Body.transformToByteArray());
}

export async function deletePrivateEvidence(objectKey: string) {
  assertStorageAccess();
  const config = await getRuntimeStorageConfig();
  await (
    await getS3(config)
  ).send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }));
}
