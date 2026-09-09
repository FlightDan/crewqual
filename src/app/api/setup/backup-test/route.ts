import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { assertSetupOpen, validateSetupBackupTarget } from "@/server/setup";
import { guardSetupMutation } from "@/server/setup-request";

const schema = z.object({
  type: z.enum(["LOCAL", "SMB", "FTP", "WEBDAV", "S3"]),
  endpoint: z.string().max(2048),
  basePath: z.string().max(1024),
});

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await guardSetupMutation(request, "backup-test", 20);
    await assertSetupOpen();
    return jsonData(validateSetupBackupTarget(await parseJson(request, schema)), requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
