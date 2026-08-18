import { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, getRequestId, jsonData, jsonError } from "@/server/api";
import { assertCsrf, authenticatePilot } from "@/server/auth";
import { getPrisma } from "@/server/prisma";
import { deletePrivateEvidence, putPrivateEvidence, validateProcessedJpeg } from "@/server/storage";
import { releaseUpload, reserveUpload } from "@/server/upload-quotas";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  let reservationId: string | null = null;
  try {
    assertSameOrigin(request);
    const pilot = await authenticatePilot(request);
    await assertCsrf(request, pilot.csrfToken);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 10 * 1024 * 1024 + 64 * 1024) {
      throw new ApiError("IMAGE_TOO_LARGE", "图片不能超过 10 MiB", 413);
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError("INVALID_IMAGE", "请上传图片文件", 422);
    }
    const value = form.get("file");
    if (!(value instanceof File)) {
      throw new ApiError("INVALID_IMAGE", "请上传图片文件", 422);
    }
    if (value.type !== "image/jpeg") {
      throw new ApiError("INVALID_IMAGE", "只允许上传处理后的 JPEG 图片", 422);
    }
    const bytes = new Uint8Array(await value.arrayBuffer());
    reservationId = await reserveUpload(getPrisma(), pilot.id, bytes.byteLength);
    const metadata = await validateProcessedJpeg(bytes);
    const storageBytes = metadata.storageBytes ?? bytes;
    const storageByteSize = metadata.storageByteSize ?? metadata.byteSize;
    const storageSha256 = metadata.storageSha256 ?? metadata.sha256;
    const objectKey = await putPrivateEvidence(storageBytes, storageSha256);
    let image;
    try {
      image = await getPrisma().evidenceImage.create({
        data: {
          pilotId: pilot.id,
          objectKey,
          mimeType: "image/jpeg",
          width: metadata.width,
          height: metadata.height,
          byteSize: storageByteSize,
          sha256: storageSha256,
          status: "orphaned",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    } catch (error) {
      await deletePrivateEvidence(objectKey).catch(() => undefined);
      throw error;
    }
    if (reservationId) await releaseUpload(getPrisma(), reservationId);
    return jsonData(
      {
        id: image.id,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        byteSize: image.byteSize,
        sha256: image.sha256,
        status: image.status,
        pilotId: pilot.id,
      },
      requestId,
      201,
    );
  } catch (error) {
    if (reservationId) await releaseUpload(getPrisma(), reservationId).catch(() => undefined);
    return jsonError(error, requestId);
  }
}
