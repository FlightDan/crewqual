import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getRuntimeStorageConfig, type RuntimeStorageConfig } from "@/server/runtime-storage";

export type ObjectStorageHealth = "ok" | "unconfigured" | "unavailable";

type StorageClientConfig = Pick<
  RuntimeStorageConfig,
  | "S3_ENDPOINT"
  | "S3_REGION"
  | "S3_BUCKET"
  | "S3_ACCESS_KEY_ID"
  | "S3_SECRET_ACCESS_KEY"
  | "S3_FORCE_PATH_STYLE"
>;

function storageClient(config: StorageClientConfig) {
  return new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
}

export async function checkObjectStorage(
  providedConfig?: StorageClientConfig,
): Promise<ObjectStorageHealth> {
  const config = providedConfig ?? (await getRuntimeStorageConfig());
  if (!config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) return "unconfigured";
  try {
    await storageClient(config).send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
    return "ok";
  } catch {
    return "unavailable";
  }
}

export async function probeObjectStorage(config: RuntimeStorageConfig) {
  if (!config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
    throw new Error("Object storage credentials are not configured");
  }
  const client = storageClient(config);
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
    );
    created = true;
    const downloaded = await client.send(
      new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
    );
    if (!downloaded.Body) throw new Error("Object storage returned an empty probe body");
    const bytes = await downloaded.Body.transformToByteArray();
    if (Buffer.compare(Buffer.from(bytes), Buffer.from(payload)) !== 0) {
      throw new Error("Object storage probe content did not match");
    }
    await client.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
    created = false;
    return { ok: true as const, message: "对象存储读、写、删除测试通过" };
  } finally {
    if (created) {
      await client
        .send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }))
        .catch(() => undefined);
    }
  }
}
