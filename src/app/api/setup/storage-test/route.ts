import { NextRequest } from "next/server";
import { ApiError, getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { probeObjectStorage } from "@/server/health";
import { resolveSetupStorage, setupStorageSchema } from "@/server/runtime-storage";
import { assertSetupOpen } from "@/server/setup";
import { guardSetupMutation } from "@/server/setup-request";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await guardSetupMutation(request, "storage-test", 10);
    await assertSetupOpen();
    const input = await parseJson(request, setupStorageSchema);
    try {
      return jsonData(await probeObjectStorage(resolveSetupStorage(input)), requestId);
    } catch (error) {
      throw new ApiError(
        "OBJECT_STORAGE_UNAVAILABLE",
        error instanceof Error ? error.message : "对象存储连接测试失败",
        422,
      );
    }
  } catch (error) {
    return jsonError(error, requestId);
  }
}
