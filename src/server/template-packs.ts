import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/server/prisma";
import { ApiError } from "@/server/api";
import {
  ocrChecksSchema,
  parameterRestrictionSchema,
  reminderRuleSchema,
  validityRuleSchema,
} from "@/lib/qualification-rules";
import { CORE_QUALIFICATION_CATALOG } from "@/types/services";

const codeSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,127}$/);
const positionCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_-]{0,63}$/);
const fieldNameSchema = z.enum([
  "credentialNumber",
  "issueDate",
  "trainingDate",
  "expiryDate",
  "issuingAuthority",
  "levelOrParameter",
]);

export const templatePackSchema = z.object({
  schemaVersion: z.literal(1),
  code: codeSchema,
  version: z.number().int().positive(),
  industryCode: codeSchema.default("aviation"),
  name: z.string().trim().min(1).max(256),
  description: z.string().trim().max(2000).default(""),
  translations: z.record(z.string(), z.string()).default({}),
  positions: z
    .array(
      z.object({
        code: positionCodeSchema,
        name: z.string().trim().min(1).max(128),
        description: z.string().trim().max(1000).default(""),
        translations: z.record(z.string(), z.string()).default({}),
        sortOrder: z.number().int().min(0).default(0),
      }),
    )
    .min(1),
  qualificationDefinitions: z
    .array(
      z.object({
        code: codeSchema,
        name: z.string().trim().min(1).max(256),
        description: z.string().trim().max(2000).default(""),
        translations: z.record(z.string(), z.string()).default({}),
        category: z.string().trim().min(1).max(64).default("aviation"),
        active: z.boolean().default(true),
        requiresEvidence: z.boolean().default(true),
        requiresHumanReview: z.boolean().default(true),
        allowAutoApproval: z.boolean().default(false),
        fieldSchema: z
          .object({
            fields: z
              .array(
                z.object({
                  name: fieldNameSchema,
                  required: z.boolean().default(true),
                  labelKey: z.string().trim().min(1).max(128),
                }),
              )
              .default([]),
          })
          .default({ fields: [] }),
        validityRule: validityRuleSchema,
        reminders: reminderRuleSchema,
        ocrChecks: ocrChecksSchema,
        parameterRestriction: parameterRestrictionSchema,
        sortOrder: z.number().int().min(0).default(0),
      }),
    )
    .min(1),
  requirements: z.array(
    z.object({
      positionCode: positionCodeSchema,
      qualificationCode: codeSchema,
      required: z.boolean().default(true),
      upgradePrerequisite: z.boolean().default(false),
      active: z.boolean().default(true),
      sortOrder: z.number().int().min(0).default(0),
    }),
  ),
  organizationDefaults: z.record(z.string(), z.unknown()).optional(),
});

export type TemplatePackInput = z.input<typeof templatePackSchema>;
export type TemplatePack = z.output<typeof templatePackSchema>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

export function templatePackChecksum(pack: TemplatePack) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(pack)))
    .digest("hex");
}

export const PILOT_TEMPLATE_PACK: TemplatePack = {
  schemaVersion: 1,
  code: "aviation-china-airline-pilot",
  version: 1,
  industryCode: "aviation",
  name: "中国民航飞行员",
  description: "CrewQual 当前航空飞行员资质与升级计划模板。",
  translations: { "zh-CN": "中国民航飞行员" },
  positions: [
    {
      code: "PILOT",
      name: "飞行员",
      description: "承担飞行运行与飞行员资质管理职责的成员。",
      translations: { "zh-CN": "飞行员" },
      sortOrder: 0,
    },
  ],
  qualificationDefinitions: CORE_QUALIFICATION_CATALOG.map((item, index) => ({
    code: item.id,
    name: item.name,
    description: "",
    translations: { "zh-CN": item.name },
    category: "aviation",
    active: true,
    requiresEvidence: true,
    requiresHumanReview: true,
    allowAutoApproval: false,
    fieldSchema: {
      fields: [
        { name: "credentialNumber", required: true, labelKey: "qualification.credentialNumber" },
        { name: "issueDate", required: true, labelKey: "qualification.issueDate" },
        ...(item.cycleMonths
          ? [
              {
                name: "trainingDate" as const,
                required: false,
                labelKey: "qualification.trainingDate",
              },
            ]
          : []),
        { name: "expiryDate", required: true, labelKey: "qualification.expiryDate" },
        { name: "issuingAuthority", required: true, labelKey: "qualification.issuingAuthority" },
        { name: "levelOrParameter", required: true, labelKey: "qualification.levelOrParameter" },
      ],
    },
    // The legacy seed stores all six pilot qualifications with a manually
    // entered expiry date. Keep that behaviour in the first template pack;
    // `cycleMonths` is catalog/display metadata and must not silently change
    // the validity semantics during migration.
    validityRule: { kind: "manual_expiry" as const },
    // Matches the current seed/runtime defaults; organizations can customize
    // the live definition after installation.
    reminders: {
      firstDays: 30,
      secondDays: 7,
      dueRecipients: ["PERSON"],
      expiredRecipients: ["PERSON"],
    },
    ocrChecks: {
      enabled: true,
      credentialNumber: true,
      holderMatch: true,
      expiryDate: true,
      issuingAuthoritySeal: false,
    },
    parameterRestriction: {
      enabled: false,
      description: "",
      version: 1,
      enforcement: { mode: "none", allowedValues: [], pattern: "" },
    },
    sortOrder: index,
  })),
  requirements: CORE_QUALIFICATION_CATALOG.map((item, index) => ({
    positionCode: "PILOT",
    qualificationCode: item.id,
    required: true,
    upgradePrerequisite: true,
    active: true,
    sortOrder: index,
  })),
};

export function parseTemplatePack(value: unknown) {
  const parsed = templatePackSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      "INVALID_TEMPLATE_PACK",
      "模板包格式无效",
      422,
      parsed.error.flatten().fieldErrors,
    );
  }
  const positionCodes = new Set(parsed.data.positions.map((item) => item.code));
  const qualificationCodes = new Set(parsed.data.qualificationDefinitions.map((item) => item.code));
  if (positionCodes.size !== parsed.data.positions.length) {
    throw new ApiError("INVALID_TEMPLATE_PACK", "模板包包含重复职位 code", 422);
  }
  if (qualificationCodes.size !== parsed.data.qualificationDefinitions.length) {
    throw new ApiError("INVALID_TEMPLATE_PACK", "模板包包含重复资质 code", 422);
  }
  for (const requirement of parsed.data.requirements) {
    if (
      !positionCodes.has(requirement.positionCode) ||
      !qualificationCodes.has(requirement.qualificationCode)
    ) {
      throw new ApiError("INVALID_TEMPLATE_PACK", "模板要求引用了不存在的职位或资质", 422);
    }
  }
  return parsed.data;
}

export async function registerTemplatePack(value: unknown) {
  const pack = parseTemplatePack(value);
  const checksum = templatePackChecksum(pack);
  const db = getPrisma();
  const existing = await db.templatePack.findUnique({
    where: { code_version: { code: pack.code, version: pack.version } },
  });
  if (existing) {
    if (existing.checksum !== checksum) {
      throw new ApiError(
        "TEMPLATE_VERSION_CONFLICT",
        "相同模板版本的内容已存在且 checksum 不同",
        409,
      );
    }
    return { pack: existing, created: false, checksum };
  }
  const created = await db.templatePack.create({
    data: {
      code: pack.code,
      version: pack.version,
      industryCode: pack.industryCode,
      name: pack.name,
      description: pack.description,
      translations: pack.translations,
      payload: pack as never,
      checksum,
    },
  });
  return { pack: created, created: true, checksum };
}

export type InstallTemplateResult = {
  installationId: string;
  status: "SUCCEEDED" | "NOOP";
  createdPositions: number;
  createdDefinitions: number;
  createdRequirements: number;
  skippedExisting: number;
};

export async function installTemplatePack(
  organizationId: string,
  templatePackId: string,
  installedBy?: string,
): Promise<InstallTemplateResult> {
  const db = getPrisma();
  return db.$transaction((tx) =>
    installTemplatePackInTransaction(tx, organizationId, templatePackId, installedBy),
  );
}

export async function installTemplatePackInTransaction(
  db: Prisma.TransactionClient,
  organizationId: string,
  templatePackId: string,
  installedBy?: string,
): Promise<InstallTemplateResult> {
  const [organization, packRow] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { id: true } }),
    db.templatePack.findUnique({ where: { id: templatePackId } }),
  ]);
  if (!organization) throw new ApiError("ORGANIZATION_NOT_FOUND", "组织不存在", 404);
  if (!packRow || !packRow.active)
    throw new ApiError("TEMPLATE_NOT_FOUND", "模板不存在或已停用", 404);
  const pack = parseTemplatePack(packRow.payload);

  const existingInstallation = await db.organizationTemplateInstallation.findUnique({
    where: { organizationId_templatePackId: { organizationId, templatePackId } },
  });
  if (existingInstallation) {
    const result = (existingInstallation.result ?? {}) as Record<string, number>;
    return {
      installationId: existingInstallation.id,
      status: "NOOP",
      createdPositions: result.createdPositions ?? 0,
      createdDefinitions: result.createdDefinitions ?? 0,
      createdRequirements: result.createdRequirements ?? 0,
      skippedExisting: result.skippedExisting ?? 0,
    };
  }

  let createdPositions = 0;
  let createdDefinitions = 0;
  let createdRequirements = 0;
  let skippedExisting = 0;
  const positions = new Map<string, { id: string }>();
  const definitions = new Map<string, { id: string }>();

  for (const position of pack.positions) {
    const existing = await db.position.findUnique({
      where: { organizationId_code: { organizationId, code: position.code } },
      select: { id: true },
    });
    if (existing) {
      positions.set(position.code, existing);
      skippedExisting += 1;
      continue;
    }
    const created = await db.position.create({
      data: {
        organizationId,
        code: position.code,
        name: position.name,
        description: position.description,
        translations: position.translations,
        sortOrder: position.sortOrder,
        sourcePackCode: pack.code,
        sourcePackVersion: pack.version,
      },
      select: { id: true },
    });
    positions.set(position.code, created);
    createdPositions += 1;
  }

  for (const definition of pack.qualificationDefinitions) {
    const existing = await db.qualificationDefinition.findUnique({
      where: { organizationId_code: { organizationId, code: definition.code } },
      select: { id: true },
    });
    if (existing) {
      definitions.set(definition.code, existing);
      skippedExisting += 1;
      continue;
    }
    const created = await db.qualificationDefinition.create({
      data: {
        organizationId,
        code: definition.code,
        name: definition.name,
        description: definition.description,
        translations: definition.translations,
        category: definition.category,
        active: definition.active,
        requiresEvidence: definition.requiresEvidence,
        requiresHumanReview: true,
        allowAutoApproval: false,
        fieldSchema: definition.fieldSchema,
        validityRule: definition.validityRule,
        reminders: definition.reminders,
        ocrChecks: definition.ocrChecks,
        parameterRestriction: definition.parameterRestriction,
        sortOrder: definition.sortOrder,
        sourcePackCode: pack.code,
        sourcePackVersion: pack.version,
      },
      select: { id: true },
    });
    definitions.set(definition.code, created);
    createdDefinitions += 1;
  }

  for (const requirement of pack.requirements) {
    const position = positions.get(requirement.positionCode);
    const definition = definitions.get(requirement.qualificationCode);
    if (!position || !definition)
      throw new ApiError("INVALID_TEMPLATE_PACK", "模板要求引用无效", 422);
    const existing = await db.qualificationRequirement.findUnique({
      where: {
        positionId_qualificationDefinitionId: {
          positionId: position.id,
          qualificationDefinitionId: definition.id,
        },
      },
      select: { id: true },
    });
    if (existing) {
      skippedExisting += 1;
      continue;
    }
    await db.qualificationRequirement.create({
      data: {
        positionId: position.id,
        qualificationDefinitionId: definition.id,
        required: requirement.required,
        upgradePrerequisite: requirement.upgradePrerequisite,
        active: requirement.active,
        sortOrder: requirement.sortOrder,
        sourcePackCode: pack.code,
        sourcePackVersion: pack.version,
      },
    });
    createdRequirements += 1;
  }

  const result = { createdPositions, createdDefinitions, createdRequirements, skippedExisting };
  const installation = await db.organizationTemplateInstallation.create({
    data: {
      organizationId,
      templatePackId,
      installedBy,
      status: "SUCCEEDED",
      result,
    },
    select: { id: true },
  });
  return { installationId: installation.id, status: "SUCCEEDED", ...result };
}
