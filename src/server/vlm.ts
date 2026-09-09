import { z } from "zod";
import sharp from "sharp";
import { readVerifiedEvidence } from "@/server/storage";
import {
  assertEvidenceProvenance,
  evidenceUnavailable,
  type EvidenceProvenance,
} from "@/server/evidence-provenance";
import { getRuntimeIntegration } from "@/server/runtime-settings";
import { getServerConfig } from "@/server/config";
import { fetchExternalEndpoint } from "@/server/external-endpoint-safety";

export const extractionResultSchema = z.object({
  available: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  summary: z.string().max(1000),
  fields: z.record(z.string(), z.string().nullable()).default({}),
  fieldConfidence: z.record(z.string(), z.number().min(0).max(1)).default({}),
  evidence: z.record(z.string(), z.string().max(1000)).default({}),
  provider: z.string().max(128),
});

export type VlmRecognition = z.infer<typeof extractionResultSchema>;

export async function recognizeEvidence(
  objectKey: string,
  evidence?: EvidenceProvenance,
): Promise<VlmRecognition> {
  if (process.env.CREWQUAL_TEST_NO_EXTERNAL === "1") {
    return {
      available: false,
      summary: "VLM disabled in test environment",
      fields: {},
      fieldConfidence: {},
      evidence: {},
      provider: "disabled",
    };
  }
  if (getServerConfig().SERVICE_MODE === "mock") {
    return {
      available: false,
      summary: "VLM disabled in mock mode",
      fields: {},
      fieldConfidence: {},
      evidence: {},
      provider: "disabled",
    };
  }
  const config = await getRuntimeIntegration("vlm");
  if (!config.enabled || config.adapter === "disabled")
    return {
      available: false,
      summary: "VLM adapter disabled",
      fields: {},
      fieldConfidence: {},
      evidence: {},
      provider: "disabled",
    };
  assertEvidenceProvenance(evidence);
  if (evidence.objectKey !== objectKey) throw evidenceUnavailable();
  let bytes = await readVerifiedEvidence(evidence);
  let mimeType = evidence.mimeType;
  if (mimeType === "image/avif") {
    // Keep the gallery lossless while allowing providers that only accept JPEG
    // data URLs to continue recognizing older evidence.
    bytes = new Uint8Array(await sharp(Buffer.from(bytes)).jpeg({ quality: 95 }).toBuffer());
    mimeType = "image/jpeg";
  }
  const serverConfig = getServerConfig();
  const response = await fetchExternalEndpoint(
    `${config.endpoint.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.secret ? { authorization: `Bearer ${config.secret}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你只负责从证照图片提取字段，不进行匹配、审核或批准。只输出 JSON：available、confidence、summary、fields、fieldConfidence、evidence。",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "请提取 credentialNumber、holderName、issueDate、trainingDate、expiryDate、issuingAuthority、sealDetected，并为每个字段返回置信度和证据说明。",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
                },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(config.timeoutSeconds * 1000),
    },
    serverConfig.NODE_ENV === "production",
    {
      allowedHosts: serverConfig.OUTBOUND_ALLOWED_HOSTS,
      allowedCidrs: serverConfig.OUTBOUND_ALLOWED_CIDRS,
    },
  );
  if (!response.ok)
    return {
      available: false,
      summary: `Qwen HTTP ${response.status}`,
      fields: {},
      fieldConfidence: {},
      evidence: {},
      provider: config.model,
    };
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content)
    return {
      available: false,
      summary: "Qwen returned no content",
      fields: {},
      fieldConfidence: {},
      evidence: {},
      provider: config.model,
    };
  try {
    return extractionResultSchema.parse({ ...JSON.parse(content), provider: config.model });
  } catch {
    return {
      available: false,
      summary: "模型响应未通过结构校验",
      fields: {},
      fieldConfidence: {},
      evidence: {},
      provider: config.model,
    };
  }
}
