import type { Prisma } from "@/generated/prisma/client";
import type { Clock, PilotHealth, Qualification, QualificationDateState } from "@/types/services";
import {
  fixedClock,
  evaluateStoredQualification,
  systemClock,
} from "@/lib/qualification-date-status";
import { databaseDateOnly } from "@/lib/date-only";
import { pilotQualificationTimezone } from "@/lib/qualification-timezone";
import { parameterRestrictionSchema, validityRuleSchema } from "@/lib/qualification-rules";
import { getPrisma } from "@/server/prisma";
import {
  qualificationPersonInclude,
  qualificationUnitSelect,
  resolveMemberQualifications,
} from "@/server/member-qualifications";
import { memberQualificationStatus, summarizeMemberQualifications } from "@/lib/member-health";

export const pilotQualificationInclude = {
  unit: { select: qualificationUnitSelect },
  person: { include: qualificationPersonInclude },
  qualifications: {
    where: { status: "ACTIVE" },
    include: { qualificationType: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  },
} as const satisfies Prisma.PilotInclude;

export type QualificationPilot = Prisma.PilotGetPayload<{
  include: typeof pilotQualificationInclude;
}>;

export function pilotOwnsLegacyQualification(
  pilot: Pick<QualificationPilot, "id" | "personId">,
  record: { pilotId: string; personId: string | null },
) {
  return record.pilotId === pilot.id && (!record.personId || record.personId === pilot.personId);
}

export function pilotQualificationStates(pilot: QualificationPilot, clock: Clock = systemClock) {
  const capturedClock = fixedClock(clock);
  const timezone = pilotQualificationTimezone(pilot);
  const resolved = pilot.person ? resolveMemberQualifications(pilot.person, capturedClock) : null;
  type Item = {
    code: string;
    name: string;
    translations: unknown;
    required: boolean;
    assigned: boolean;
    record: Prisma.QualificationRecordGetPayload<Record<string, never>> | null;
    state: QualificationDateState;
  };
  const items: Item[] = (resolved?.items ?? []).map((item) => ({
    code: item.definition.code,
    name: item.definition.name,
    translations: item.definition.translations,
    required: item.required,
    assigned: true,
    record: item.record,
    state: item.state,
  }));
  for (const record of pilot.qualifications) {
    if (!pilotOwnsLegacyQualification(pilot, record)) continue;
    if (
      items.some(
        (item) => item.record?.id === record.id || item.code === record.qualificationType.code,
      )
    )
      continue;
    items.push({
      code: record.qualificationType.code,
      name: record.qualificationType.name,
      translations: record.qualificationType.translations,
      required: false,
      assigned: false,
      record,
      state: evaluateStoredQualification(record, capturedClock, timezone),
    });
  }
  const summary = summarizeMemberQualifications(
    items
      .filter((item) => item.assigned)
      .map((item) => ({
        required: item.required,
        status: memberQualificationStatus(item.state.status),
      })),
  );
  const health: PilotHealth =
    summary.health === "valid" ? "normal" : summary.health === "due" ? "expiring" : summary.health;
  return { ...summary, health, items, timezone, evaluatedAt: capturedClock.now().toISOString() };
}

export function qualificationTranslations(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** Includes assigned-but-missing credentials; unassigned legacy records remain visible as optional. */
export async function listPilotQualifications(
  pilotId: string,
  clock: Clock = systemClock,
): Promise<Qualification[]> {
  const db = getPrisma();
  const capturedClock = fixedClock(clock);
  const pilot = await db.pilot.findUnique({
    where: { id: pilotId },
    include: pilotQualificationInclude,
  });
  if (!pilot) return [];
  const timezone = pilotQualificationTimezone(pilot);
  const resolved = pilot.person ? resolveMemberQualifications(pilot.person, capturedClock) : null;
  const definitions = resolved?.items.map((item) => item.definition) ?? [];
  const types = definitions.length
    ? await db.qualificationType.findMany({
        where: {
          OR: [
            {
              id: {
                in: definitions.flatMap((item) =>
                  item.legacyQualificationTypeId ? [item.legacyQualificationTypeId] : [],
                ),
              },
            },
            { code: { in: definitions.map((item) => item.code) } },
          ],
        },
      })
    : [];
  const results: Qualification[] = [];
  const representedRecordIds = new Set<string>();
  const representedTypeIds = new Set<string>();
  for (const item of resolved?.items ?? []) {
    const type =
      types.find((entry) => entry.id === item.definition.legacyQualificationTypeId) ??
      types.find((entry) => entry.code === item.definition.code);
    const currentRule = validityRuleSchema.safeParse(
      type?.validityRule ?? item.definition.validityRule,
    );
    const restriction = parameterRestrictionSchema.safeParse(
      type?.parameterRestriction ?? item.definition.parameterRestriction,
    );
    if (item.record) representedRecordIds.add(item.record.id);
    if (type) representedTypeIds.add(type.id);
    results.push({
      id: item.definition.code,
      name: item.definition.name,
      translations: qualificationTranslations(item.definition.translations),
      ...item.state,
      expiresOn: databaseDateOnly(item.record?.expiryDate) ?? "",
      parameter: item.record?.levelOrParameter,
      timezone,
      required: item.required,
      recordExists: Boolean(item.record),
      submissionSupported: Boolean(type?.active && currentRule.success && restriction.success),
      validityRule: currentRule.success ? currentRule.data : undefined,
      parameterRestriction: restriction.success ? restriction.data : undefined,
      ruleVersion: type?.version ?? item.definition.version,
      cycleMonths:
        currentRule.success && currentRule.data.kind === "fixed_months"
          ? currentRule.data.months
          : undefined,
    });
  }
  for (const record of pilot.qualifications) {
    if (!pilotOwnsLegacyQualification(pilot, record)) continue;
    if (representedRecordIds.has(record.id) || representedTypeIds.has(record.qualificationTypeId))
      continue;
    representedTypeIds.add(record.qualificationTypeId);
    const type = record.qualificationType;
    const currentRule = validityRuleSchema.safeParse(type.validityRule);
    const restriction = parameterRestrictionSchema.safeParse(type.parameterRestriction);
    results.push({
      id: type.code,
      name: type.name,
      translations: qualificationTranslations(type.translations),
      ...evaluateStoredQualification(record, capturedClock, timezone),
      expiresOn: databaseDateOnly(record.expiryDate) ?? "",
      parameter: record.levelOrParameter,
      timezone,
      required: false,
      recordExists: true,
      submissionSupported: type.active && currentRule.success && restriction.success,
      validityRule: currentRule.success ? currentRule.data : undefined,
      parameterRestriction: restriction.success ? restriction.data : undefined,
      ruleVersion: type.version,
      cycleMonths:
        currentRule.success && currentRule.data.kind === "fixed_months"
          ? currentRule.data.months
          : undefined,
    });
  }
  return results;
}
