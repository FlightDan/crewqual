import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getRuntimeStorageConfig, type RuntimeStorageConfig } from "@/server/runtime-storage";
import { createPinnedS3Client } from "@/server/s3-client";

export type ObjectStorageHealth = "ok" | "unconfigured" | "unavailable";

const HEALTH_TIMEOUT_MS = 3_500;
const SETUP_PROBE_TIMEOUT_MS = 10_000;
const CLEANUP_TIMEOUT_MS = 2_000;

type StorageClientConfig = Pick<
  RuntimeStorageConfig,
  | "S3_ENDPOINT"
  | "S3_REGION"
  | "S3_BUCKET"
  | "S3_ACCESS_KEY_ID"
  | "S3_SECRET_ACCESS_KEY"
  | "S3_FORCE_PATH_STYLE"
>;

async function storageClient(config: StorageClientConfig, signal: AbortSignal) {
  return createPinnedS3Client(config, signal);
}

export async function checkObjectStorage(
  providedConfig?: StorageClientConfig,
): Promise<ObjectStorageHealth> {
  const config = providedConfig ?? (await getRuntimeStorageConfig());
  if (!config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) return "unconfigured";
  try {
    const deadline = AbortSignal.timeout(HEALTH_TIMEOUT_MS);
    await (
      await storageClient(config, deadline)
    ).send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }), {
      abortSignal: deadline,
    });
    return "ok";
  } catch {
    return "unavailable";
  }
}

export async function probeObjectStorage(config: RuntimeStorageConfig) {
  if (!config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
    throw new Error("Object storage credentials are not configured");
  }
  const deadline = AbortSignal.timeout(SETUP_PROBE_TIMEOUT_MS);
  const client = await storageClient(config, deadline);
  const key = `system/setup-probes/${randomUUID()}.txt`;
  const payload = new TextEncoder().encode(`crewqual-storage-probe:${randomUUID()}`);
  let created = false;
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
        Body: payload,
        ContentType: "text/plain",
      }),
      { abortSignal: deadline },
    );
    created = true;
    const downloaded = await client.send(
      new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
      {
        abortSignal: deadline,
      },
    );
    if (!downloaded.Body) throw new Error("Object storage returned an empty probe body");
    const bytes = await downloaded.Body.transformToByteArray();
    if (Buffer.compare(Buffer.from(bytes), Buffer.from(payload)) !== 0) {
      throw new Error("Object storage probe content did not match");
    }
    await client.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), {
      abortSignal: deadline,
    });
    created = false;
    return { ok: true as const, message: "对象存储读、写、删除测试通过" };
  } finally {
    if (created) {
      await client
        .send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), {
          abortSignal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS),
        })
        .catch(() => undefined);
    }
  }
}
