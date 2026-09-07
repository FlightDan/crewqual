import type { AdminStateV4, Clock, QualificationRecord } from "@/types/services";
import { mockE2EClock } from "@/mocks/test-clock";
import { DEFAULT_BUSINESS_TIMEZONE } from "@/lib/date-only";
import { evaluateQualification, fixedClock } from "@/lib/qualification-date-status";
import { memberQualificationStatus, summarizeMemberQualifications } from "@/lib/member-health";

/** Mock assignment projection stays behind the service boundary. */
export function projectMockMemberQualifications(
  pilot: AdminStateV4["pilots"][number],
  configs: AdminStateV4["qualificationConfigs"],
  clock: Clock = mockE2EClock,
) {
  const capturedClock = fixedClock(clock);
  const timezone = DEFAULT_BUSINESS_TIMEZONE;
  const assignments = new Map<string, (typeof configs)[number][]>();
  for (const config of configs.filter((item) => item.active && item.positionCode === "PILOT")) {
    const assignmentId = config.qualificationId ?? config.code;
    const existing = assignments.get(assignmentId) ?? [];
    existing.push(config);
    assignments.set(assignmentId, existing);
  }
  const qualifications = [...assignments.entries()].map(([id, sources]) => {
    const config = sources[0]!;
    const record = pilot.qualifications.find((item) => item.id === id) ?? null;
    const state = evaluateQualification({
      record: record
        ? {
            expiryDate: record.expiryDate,
            validityRule: record.validityRule ?? config.validityRule,
          }
        : null,
      timezone,
      clock: capturedClock,
    });
    return {
      code: id,
      name: config.name,
      translations: config.translations,
      positionCode: "PILOT",
      source: "MOCK_ASSIGNMENT",
      sources: sources.map((item) => ({
        positionCode: item.positionCode,
        source: "MOCK_ASSIGNMENT",
      })),
      required: sources.some((item) => item.core),
      ...state,
      status: memberQualificationStatus(state.status),
      record,
    };
  });
  return {
    qualifications,
    ...summarizeMemberQualifications(qualifications),
    timezone,
    evaluatedAt: capturedClock.now().toISOString(),
  };
}

/** Service-facing records include assignments without stored evidence. */
export function mockMemberQualificationRecords(
  pilot: AdminStateV4["pilots"][number],
  configs: AdminStateV4["qualificationConfigs"],
  clock: Clock = mockE2EClock,
): QualificationRecord[] {
  return projectMockMemberQualifications(pilot, configs, clock).qualifications.map((item) => {
    const config = configs.find(
      (candidate) => (candidate.qualificationId ?? candidate.code) === item.code,
    )!;
    return {
      ...item.record,
      id: item.code,
      name: item.name,
      translations: item.translations,
      expiresOn: item.record?.expiryDate ?? "",
      recordExists: item.record !== null,
      validityRule: item.record?.validityRule ?? config.validityRule,
      required: item.required,
      timezone: DEFAULT_BUSINESS_TIMEZONE,
    };
  });
}

export function captureMockMemberClock(): Clock {
  return fixedClock(mockE2EClock);
}
