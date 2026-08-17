import { z } from "zod";

export const returnReasonSchema = z.string().trim().min(5, "退回原因至少需要 5 个字符");

const reviewIsoDate = z.string().date("请输入有效日期，格式为 YYYY-MM-DD");

/**
 * The review API receives the complete final field set. Keeping this schema
 * beside the UI schema prevents a client-only validation gap when a caller
 * talks to the route directly.
 */
export const reviewCredentialFieldsSchema = z
  .object({
    credentialNumber: z.string().trim().min(1).max(128),
    issueDate: reviewIsoDate,
    trainingDate: z.union([reviewIsoDate, z.literal("")]).default(""),
    expiryDate: z.union([reviewIsoDate, z.literal("")]),
    issuingAuthority: z.string().trim().min(1).max(256),
    levelOrParameter: z.string().trim().min(1).max(256),
  })
  .superRefine((value, context) => {
    if (value.expiryDate && value.expiryDate < value.issueDate) {
      context.addIssue({
        code: "custom",
        path: ["expiryDate"],
        message: "到期日期不得早于签发日期",
      });
    }
  });

export type ReviewCredentialFieldsInput = z.infer<typeof reviewCredentialFieldsSchema>;
