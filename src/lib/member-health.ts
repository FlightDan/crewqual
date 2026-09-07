import type { QualificationStatus } from "@/types/services";

export type MemberQualificationStatus = "missing" | "incomplete" | "expired" | "due" | "valid";
export type MemberHealth = MemberQualificationStatus | "unconfigured";
export type QualificationCounts = Record<MemberQualificationStatus, number>;

export function memberQualificationStatus(status: QualificationStatus): MemberQualificationStatus {
  return status === "due_30" || status === "due_90" ? "due" : status;
}

export function summarizeMemberQualifications(
  qualifications: ReadonlyArray<{ status: MemberQualificationStatus; required: boolean }>,
) {
  const qualificationCounts: QualificationCounts = {
    missing: 0,
    incomplete: 0,
    expired: 0,
    due: 0,
    valid: 0,
  };
  const requiredQualificationCounts: QualificationCounts = { ...qualificationCounts };
  for (const item of qualifications) {
    qualificationCounts[item.status] += 1;
    if (item.required) requiredQualificationCounts[item.status] += 1;
  }
  const health: MemberHealth = !qualifications.length
    ? "unconfigured"
    : requiredQualificationCounts.missing > 0
      ? "missing"
      : requiredQualificationCounts.incomplete > 0
        ? "incomplete"
        : requiredQualificationCounts.expired > 0
          ? "expired"
          : requiredQualificationCounts.due > 0
            ? "due"
            : "valid";
  return { health, qualificationCounts, requiredQualificationCounts };
}
