"use client";

import * as React from "react";
import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PilotManagementActions } from "@/components/admin/pilot-management-dialogs";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useAdminState } from "@/services/admin-state-provider";
import { isRemoteServiceMode } from "@/lib/service-mode";

type MemberListItem = {
  id: string;
  employeeNumber: string;
  displayName: string;
  initials: string;
  active: boolean;
  primaryPosition: { code: string; name: string } | null;
  qualificationCounts: { missing: number; expired: number; due: number; valid: number };
  health: "missing" | "expired" | "due" | "valid";
};

const healthLabels = {
  missing: "有缺失",
  expired: "有过期",
  due: "90天内到期",
  valid: "正常",
} as const;
const healthTones = {
  missing: "danger",
  expired: "danger",
  due: "warning",
  valid: "success",
} as const;

export function MemberDirectoryView({ positionCode }: { positionCode: string }) {
  const state = useAdminState();
  const remoteMode = isRemoteServiceMode();
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [items, setItems] = React.useState<MemberListItem[] | null>(null);
  const [revision, setRevision] = React.useState(0);

  React.useEffect(() => {
    if (!remoteMode) {
      if (positionCode !== "PILOT") {
        setItems([]);
        return;
      }
      const now = Date.now();
      setItems(
        state.pilots
          .filter(
            (pilot) =>
              !query ||
              `${pilot.displayName} ${pilot.employeeNumber}`
                .toLowerCase()
                .includes(query.toLowerCase()),
          )
          .filter(
            (pilot) => status === "all" || (status === "active" ? pilot.active : !pilot.active),
          )
          .map((pilot) => {
            const expired = pilot.qualifications.filter(
              (item) => item.expiryDate && new Date(item.expiryDate).getTime() < now,
            ).length;
            const due = pilot.qualifications.filter((item) => {
              if (!item.expiryDate) return false;
              const expiry = new Date(item.expiryDate).getTime();
              return expiry >= now && expiry <= now + 90 * 24 * 60 * 60 * 1000;
            }).length;
            const health = expired ? "expired" : due ? "due" : "valid";
            return {
              id: pilot.id,
              employeeNumber: pilot.employeeNumber,
              displayName: pilot.displayName,
              initials: pilot.initials,
              active: pilot.active,
              primaryPosition: { code: "PILOT", name: "飞行员" },
              qualificationCounts: {
                missing: 0,
                expired,
                due,
                valid: pilot.qualifications.length - expired - due,
              },
              health,
            };
          }),
      );
      return;
    }
    let active = true;
    const params = new URLSearchParams({ positions: positionCode, page: "1", pageSize: "100" });
    if (query) params.set("q", query);
    if (status !== "all") params.set("status", status);
    void fetch(`/api/admin/members?${params}`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          data?: { items?: MemberListItem[] };
        };
        if (active) setItems(response.ok ? (body.data?.items ?? []) : []);
      })
      .catch(() => {
        if (active) setItems([]);
      });
    return () => {
      active = false;
    };
  }, [positionCode, query, remoteMode, revision, state, status]);

  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader
        title={`${positionCode === "PILOT" ? "飞行员" : positionCode}成员`}
        description="新增、批量导入和筛选成员；资质状态由职位要求与正式记录计算。"
        action={<PilotManagementActions onCompleted={() => setRevision((value) => value + 1)} />}
      />
      <Card className="grid gap-3 p-3 shadow-none md:grid-cols-[minmax(0,1fr)_180px]">
        <Input
          aria-label="搜索成员"
          placeholder="搜索姓名、员工号..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          aria-label="成员状态"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={[
            { label: "全部状态", value: "all" },
            { label: "启用", value: "active" },
            { label: "停用", value: "inactive" },
          ]}
        />
      </Card>
      {!items ? (
        <Skeleton className="h-72" />
      ) : !items.length ? (
        <EmptyState title="当前职位没有成员" description="可以新增成员或导入 CSV。" />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-card lg:block">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-secondary">
                <tr>
                  {[
                    "员工号",
                    "姓名",
                    "主职",
                    "状态",
                    "资质合规",
                    "缺失",
                    "过期",
                    "90天内",
                    "操作",
                  ].map((heading) => (
                    <th key={heading} className="px-4 py-3 font-semibold">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((member) => (
                  <tr key={member.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium">{member.employeeNumber}</td>
                    <td className="px-4 py-3 font-semibold">{member.displayName}</td>
                    <td className="px-4 py-3">
                      <Badge tone="info">{member.primaryPosition?.name ?? positionCode}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={member.active ? "success" : "neutral"}>
                        {member.active ? "启用" : "停用"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={healthTones[member.health]}>{healthLabels[member.health]}</Badge>
                    </td>
                    <td className="px-4 py-3">{member.qualificationCounts.missing}</td>
                    <td className="px-4 py-3">{member.qualificationCounts.expired}</td>
                    <td className="px-4 py-3">{member.qualificationCounts.due}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/members/${member.id}`}
                        className="font-semibold text-brand"
                      >
                        查看详情
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 lg:hidden">
            {items.map((member) => (
              <Link key={member.id} href={`/admin/members/${member.id}`} className="block">
                <Card className="p-4 shadow-none">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-blue-50 font-bold text-brand">
                      {member.initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{member.displayName}</p>
                      <p className="text-xs text-secondary">
                        {member.employeeNumber} · {member.primaryPosition?.name ?? positionCode}
                      </p>
                    </div>
                    <Badge tone={healthTones[member.health]}>{healthLabels[member.health]}</Badge>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </PageContainer>
  );
}
