import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getServerConfig } from "@/server/config";
import { getPrisma } from "@/server/prisma";
import { getRequestId, jsonData, jsonError, ApiError } from "@/server/api";

const receiptSchema = z.object({
  providerMessageId: z.string().trim().min(1).max(256),
  status: z.enum(["delivered", "failed", "unknown"]),
  detail: z.string().trim().max(1000).optional(),
});

function validSignature(body: string, timestamp: string, signature: string, secret: string) {
  const timestampNumber = Number(timestamp);
  if (
    !secret ||
    !Number.isInteger(timestampNumber) ||
    Math.abs(Date.now() / 1000 - timestampNumber) > 300
  ) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const supplied = signature.replace(/^sha256=/, "");
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const body = await request.text();
    const config = getServerConfig();
    if (
      !validSignature(
        body,
        request.headers.get("x-receipt-timestamp") ?? "",
        request.headers.get("x-receipt-signature") ?? "",
        config.SMS_RECEIPT_WEBHOOK_SECRET,
      )
    ) {
      throw new ApiError("INVALID_RECEIPT_SIGNATURE", "回执签名无效", 401);
    }
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      throw new ApiError("INVALID_RECEIPT", "回执不是合法 JSON", 422);
    }
    const input = receiptSchema.parse(parsedBody);
    const status =
      input.status === "delivered" ? "DELIVERED" : input.status === "failed" ? "FAILED" : "UNKNOWN";
    const updated = await getPrisma().notificationDelivery.updateMany({
      where: { providerMessageId: input.providerMessageId, channel: "SMS" },
      data: {
        status,
        finalFailureReason: status === "FAILED" ? (input.detail ?? "SMS provider failed") : null,
      },
    });
    return jsonData({ accepted: updated.count === 1 }, requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
