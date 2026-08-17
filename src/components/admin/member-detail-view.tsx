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

function mockMember(id: string, state: ReturnType<typeof useAdminState>): Member | null {
  const pilot = state.pilots.find((item) => item.id === id);
  if (!pilot) return null;
  return {
    id: pilot.id,
    employeeNumber: pilot.employeeNumber,
    displayName: pilot.displayName,
    initials: pilot.initials,
    mobile: pilot.mobile,
    active: pilot.active,
    primaryPosition: { code: "PILOT", name: "飞行员" },
    positions: [{ code: "PILOT", name: "飞行员", isPrimary: true, effectiveFrom: null }],
    pilotProfile: {
      aircraftType: pilot.aircraftType,
      dutyLabel: pilot.role,
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

const statusLabels = {
  missing: "缺失",
  expired: "已过期",
  due: "90天内到期",
  valid: "有效",
} as const;
const statusTones = {
  missing: "danger",
  expired: "danger",
  due: "warning",
  valid: "success",
} as const;

export function MemberDetailView({ memberId }: { memberId: string }) {
  const state = useAdminState();
  const remoteMode = isRemoteServiceMode();
  const [member, setMember] = React.useState<Member | null | undefined>(undefined);
  React.useEffect(() => {
    if (!remoteMode) {
      setMember(mockMember(memberId, state));
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
  }, [memberId, remoteMode, state]);

  if (member === undefined)
    return (
      <PageContainer>
        <Skeleton className="h-64" />
      </PageContainer>
    );
  if (!member) {
    return (
      <PageContainer>
        <EmptyState title="未找到成员档案" description="该 ID 不存在或不属于当前组织。" />
      </PageContainer>
    );
  }
  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader
        title="成员详情档案"
        description="通用人员资料、职位任职、资质要求与记录状态"
        action={
          <Link
            href="/admin/members"
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand"
          >
            <ArrowLeft className="size-4" />
            返回成员管理
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
                {member.active ? "启用" : "停用"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-secondary">
              {member.employeeNumber} · {member.mobile}
            </p>
          </div>
          {member.primaryPosition ? (
            <Badge tone="info">主职：{member.primaryPosition.name}</Badge>
          ) : null}
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-xs">
          {member.positions.map((position) => (
            <Badge key={`${position.code}-${position.effectiveFrom}`} tone="neutral">
              {position.isPrimary ? "主职 · " : "兼任 · "}
              {position.name}
            </Badge>
          ))}
        </div>
        {member.pilotProfile ? (
          <p className="mt-4 text-sm text-secondary">
            机型：{member.pilotProfile.aircraftType} · 职务：{member.pilotProfile.dutyLabel} ·
            级别：{member.pilotProfile.rankLabel}
          </p>
        ) : null}
      </Card>
      <Card className="overflow-hidden shadow-none">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-bold">职位要求与资质记录</h2>
          <p className="mt-1 text-xs text-secondary">
            项目由职位 requirement 生成；没有正式记录的必需项目仍会显示。
          </p>
        </div>
        <div className="divide-y divide-border">
          {member.qualifications.map((qualification) => (
            <div key={qualification.code} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{qualification.name}</p>
                <p className="mt-1 text-xs text-muted">
                  {qualification.positionCode ?? "组织级"} · 来源 {qualification.source}
                </p>
              </div>
              <Badge tone={statusTones[qualification.status]}>
                {statusLabels[qualification.status]}
              </Badge>
              <span className="text-xs text-secondary">
                {qualification.record?.expiryDate
                  ? `到期 ${qualification.record.expiryDate}`
                  : "尚无有效记录"}
              </span>
            </div>
          ))}
          {!member.qualifications.length ? (
            <p className="p-5 text-sm text-muted">当前没有已分配的资质要求。</p>
          ) : null}
        </div>
      </Card>
      {member.primaryPosition?.code === "PILOT" ? (
        <Link href={`/admin/pilots/${member.id}`} className="text-sm font-semibold text-brand">
          打开飞行员兼容工作台 →
        </Link>
      ) : null}
    </PageContainer>
  );
}
