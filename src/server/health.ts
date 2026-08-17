import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { ServerConfig } from "@/server/config";

export type ObjectStorageHealth = "ok" | "unconfigured" | "unavailable";

export async function checkObjectStorage(
  config: Pick<
    ServerConfig,
    | "S3_ENDPOINT"
    | "S3_REGION"
    | "S3_BUCKET"
    | "S3_ACCESS_KEY_ID"
    | "S3_SECRET_ACCESS_KEY"
    | "S3_FORCE_PATH_STYLE"
  >,
): Promise<ObjectStorageHealth> {
  if (!config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) return "unconfigured";
  try {
    const client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    });
    await client.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
    return "ok";
  } catch {
    return "unavailable";
  }
}
