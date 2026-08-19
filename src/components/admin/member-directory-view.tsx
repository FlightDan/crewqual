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
import { useI18n } from "@/components/i18n-provider";

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

const healthTones = {
  missing: "danger",
  expired: "danger",
  due: "warning",
  valid: "success",
} as const;

export function MemberDirectoryView({ positionCode }: { positionCode: string }) {
  const state = useAdminState();
  const { t } = useI18n();
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
              primaryPosition: { code: "PILOT", name: t("portal.pilot") },
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
  }, [positionCode, query, remoteMode, revision, state, status, t]);

  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader
        title={t("members.positionMembersTitle", {
          position: positionCode === "PILOT" ? t("portal.pilot") : positionCode,
        })}
        description={t("members.positionDescription")}
        action={<PilotManagementActions onCompleted={() => setRevision((value) => value + 1)} />}
      />
      <Card className="grid gap-3 p-3 shadow-none md:grid-cols-[minmax(0,1fr)_180px]">
        <Input
          aria-label={t("members.search")}
          placeholder={t("members.searchPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          aria-label={t("members.status")}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={[
            { label: t("members.allStatus"), value: "all" },
            { label: t("members.active"), value: "active" },
            { label: t("members.inactive"), value: "inactive" },
          ]}
        />
      </Card>
      {!items ? (
        <Skeleton className="h-72" />
      ) : !items.length ? (
        <EmptyState title={t("members.noMembers")} description={t("members.addOrImport")} />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-card lg:block">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-secondary">
                <tr>
                  {[
                    t("members.employeeNumber"),
                    t("members.name"),
                    t("members.primaryPosition"),
                    t("members.status"),
                    t("members.health"),
                    t("members.missingShort"),
                    t("members.expiredShort"),
                    t("members.dueShort"),
                    t("members.actions"),
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
                        {member.active ? t("members.active") : t("members.inactive")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={healthTones[member.health]}>
                        {t(`members.health.${member.health}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">{member.qualificationCounts.missing}</td>
                    <td className="px-4 py-3">{member.qualificationCounts.expired}</td>
                    <td className="px-4 py-3">{member.qualificationCounts.due}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/members/${member.id}`}
                        className="font-semibold text-brand"
                      >
                        {t("members.viewDetails")}
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
                    <Badge tone={healthTones[member.health]}>
                      {t(`members.health.${member.health}`)}
                    </Badge>
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
