"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useAdminState } from "@/services/admin-state-provider";
import { isRemoteServiceMode } from "@/lib/service-mode";
import { pilotRoleLabel } from "@/lib/domain-i18n";
import { useI18n } from "@/components/i18n-provider";

type Member = {
  id: string;
  employeeNumber: string;
  displayName: string;
  initials: string;
  mobile: string;
  active: boolean;
  primaryPosition: { code: string; name: string } | null;
  positions: Array<{
    code: string;
    name: string;
    isPrimary: boolean;
    effectiveFrom: string | null;
  }>;
  pilotProfile: { aircraftType: string; dutyLabel: string; rankLabel: string } | null;
  qualifications: Array<{
    code: string;
    name: string;
    positionCode: string | null;
    source: string;
    status: "missing" | "expired" | "due" | "valid";
    record: { expiryDate: string | null } | null;
  }>;
};

function mockMember(
  id: string,
  state: ReturnType<typeof useAdminState>,
  pilotLabel: string,
): Member | null {
  const pilot = state.pilots.find((item) => item.id === id);
  if (!pilot) return null;
  return {
    id: pilot.id,
    employeeNumber: pilot.employeeNumber,
    displayName: pilot.displayName,
    initials: pilot.initials,
    mobile: pilot.mobile,
    active: pilot.active,
    primaryPosition: { code: "PILOT", name: pilotLabel },
    positions: [{ code: "PILOT", name: pilotLabel, isPrimary: true, effectiveFrom: null }],
    pilotProfile: {
      aircraftType: pilot.aircraftType,
      dutyLabel: pilotRoleLabel(pilot.roleCode),
      rankLabel: pilot.rankLabel,
    },
    qualifications: pilot.qualifications.map((item) => {
      const expiry = item.expiryDate ? new Date(item.expiryDate).getTime() : null;
      const status = !expiry
        ? "valid"
        : expiry < Date.now()
          ? "expired"
          : expiry <= Date.now() + 90 * 24 * 60 * 60 * 1000
            ? "due"
            : "valid";
      return {
        code: item.id,
        name: item.name,
        positionCode: "PILOT",
        source: "LEGACY_RECORD",
        status,
        record: { expiryDate: item.expiryDate },
      };
    }),
  };
}

const statusTones = {
  missing: "danger",
  expired: "danger",
  due: "warning",
  valid: "success",
} as const;

export function MemberDetailView({ memberId }: { memberId: string }) {
  const state = useAdminState();
  const { t } = useI18n();
  const remoteMode = isRemoteServiceMode();
  const [member, setMember] = React.useState<Member | null | undefined>(undefined);
  React.useEffect(() => {
    if (!remoteMode) {
      setMember(mockMember(memberId, state, t("portal.pilot")));
      return;
    }
    let active = true;
    void fetch(`/api/admin/members/${memberId}`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { data?: Member };
        if (active) setMember(response.ok ? (body.data ?? null) : null);
      })
      .catch(() => {
        if (active) setMember(null);
      });
    return () => {
      active = false;
    };
  }, [memberId, remoteMode, state, t]);

  if (member === undefined)
    return (
      <PageContainer>
        <Skeleton className="h-64" />
      </PageContainer>
    );
  if (!member) {
    return (
      <PageContainer>
        <EmptyState
          title={t("memberDetail.notFound")}
          description={t("memberDetail.notFoundDescription")}
        />
      </PageContainer>
    );
  }
  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader
        title={t("memberDetail.title")}
        description={t("memberDetail.description")}
        action={
          <Link
            href="/admin/members"
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand"
          >
            <ArrowLeft className="size-4" />
            {t("memberDetail.back")}
          </Link>
        }
      />
      <Card className="p-5 shadow-none">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-blue-50 text-lg font-bold text-brand">
            {member.initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold">{member.displayName}</h2>
              <Badge tone={member.active ? "success" : "neutral"}>
                {member.active ? t("members.active") : t("members.inactive")}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-secondary">
              {member.employeeNumber} · {member.mobile}
            </p>
          </div>
          {member.primaryPosition ? (
            <Badge tone="info">
              {t("memberDetail.primary", { name: member.primaryPosition.name })}
            </Badge>
          ) : null}
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-xs">
          {member.positions.map((position) => (
            <Badge key={`${position.code}-${position.effectiveFrom}`} tone="neutral">
              {position.isPrimary
                ? t("memberDetail.primaryShort")
                : t("memberDetail.secondaryShort")}
              {position.name}
            </Badge>
          ))}
        </div>
        {member.pilotProfile ? (
          <p className="mt-4 text-sm text-secondary">
            {t("memberDetail.aircraft", { value: member.pilotProfile.aircraftType })} ·{" "}
            {t("memberDetail.duty", { value: member.pilotProfile.dutyLabel })} ·{" "}
            {t("memberDetail.rank", { value: member.pilotProfile.rankLabel })}
          </p>
        ) : null}
      </Card>
      <Card className="overflow-hidden shadow-none">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-bold">{t("memberDetail.qualifications")}</h2>
          <p className="mt-1 text-xs text-secondary">{t("memberDetail.requirementDescription")}</p>
        </div>
        <div className="divide-y divide-border">
          {member.qualifications.map((qualification) => (
            <div key={qualification.code} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{qualification.name}</p>
                <p className="mt-1 text-xs text-muted">
                  {qualification.positionCode ?? t("memberDetail.orgLevel")} ·{" "}
                  {t("memberDetail.source", { value: qualification.source })}
                </p>
              </div>
              <Badge tone={statusTones[qualification.status]}>
                {t(`members.health.${qualification.status}`)}
              </Badge>
              <span className="text-xs text-secondary">
                {qualification.record?.expiryDate
                  ? t("memberDetail.expiry", { date: qualification.record.expiryDate })
                  : t("memberDetail.noRecord")}
              </span>
            </div>
          ))}
          {!member.qualifications.length ? (
            <p className="p-5 text-sm text-muted">{t("memberDetail.noQualifications")}</p>
          ) : null}
        </div>
      </Card>
      {member.primaryPosition?.code === "PILOT" ? (
        <Link href={`/admin/pilots/${member.id}`} className="text-sm font-semibold text-brand">
          {t("memberDetail.openPilot")}
        </Link>
      ) : null}
    </PageContainer>
  );
}
