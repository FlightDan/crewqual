import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { createPinnedLookup } from "@/server/external-endpoint-safety";
import { assertRuntimeStorageEndpoint } from "@/server/runtime-storage";

export type S3ConnectionConfig = {
  mode?: "builtin" | "s3" | "environment";
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_FORCE_PATH_STYLE: boolean;
};

export async function createPinnedS3Client(config: S3ConnectionConfig, signal?: AbortSignal) {
  const resolved = await assertRuntimeStorageEndpoint(config, signal);
  const lookup = createPinnedLookup(resolved.address);
  return new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials:
      config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: config.S3_ACCESS_KEY_ID,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
    requestHandler: new NodeHttpHandler({
      httpAgent: new HttpAgent({ lookup }),
      httpsAgent: new HttpsAgent({ lookup }),
    }),
  });
}
