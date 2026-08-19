"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { useAdminState } from "@/services/admin-state-provider";
import { isRemoteServiceMode } from "@/lib/service-mode";
import { useI18n } from "@/components/i18n-provider";

type PositionCard = {
  id: string;
  code: string;
  name: string;
  description: string;
  memberCount: number;
  missingCount: number;
  expiredCount: number;
  dueCount: number;
};

export function MemberHubView() {
  const state = useAdminState();
  const remoteMode = isRemoteServiceMode();
  const [positions, setPositions] = React.useState<PositionCard[] | null>(null);
  const { t } = useI18n();

  React.useEffect(() => {
    if (!remoteMode) {
      setPositions([
        {
          id: "pilot-preview",
          code: "PILOT",
          name: t("portal.pilot"),
          description: t("members.pilotDescription"),
          memberCount: state.pilots.length,
          missingCount: 0,
          expiredCount: state.pilots.reduce(
            (count, pilot) =>
              count +
              pilot.qualifications.filter(
                (qualification) =>
                  qualification.expiryDate && new Date(qualification.expiryDate) < new Date(),
              ).length,
            0,
          ),
          dueCount: state.pilots.reduce(
            (count, pilot) =>
              count +
              pilot.qualifications.filter((qualification) => {
                if (!qualification.expiryDate) return false;
                const expiry = new Date(qualification.expiryDate).getTime();
                return expiry >= Date.now() && expiry <= Date.now() + 90 * 24 * 60 * 60 * 1000;
              }).length,
            0,
          ),
        },
      ]);
      return;
    }
    let active = true;
    void fetch("/api/admin/members/positions", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          data?: { items?: PositionCard[] };
        };
        if (!response.ok) throw new Error(t("errors.remote"));
        if (active) setPositions(body.data?.items ?? []);
      })
      .catch(() => {
        if (active) setPositions([]);
      });
    return () => {
      active = false;
    };
  }, [remoteMode, state.pilots, t]);

  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader title={t("members.title")} description={t("members.description")} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {!positions ? (
          <>
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </>
        ) : positions.length ? (
          positions.map((position) => (
            <Link
              key={`${position.id}-${position.code}`}
              href={`/admin/members/positions/${position.code}`}
            >
              <Card className="h-full p-5 transition hover:border-brand hover:shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-brand">
                    <Users aria-hidden="true" className="size-5" />
                  </div>
                  <ArrowRight aria-hidden="true" className="size-5 text-muted" />
                </div>
                <h3 className="mt-4 text-lg font-bold text-primary">{position.name}</h3>
                <p className="mt-1 text-sm text-secondary">
                  {position.description || position.code}
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <Badge tone="neutral">
                    {t("members.count", { count: position.memberCount })}
                  </Badge>
                  {position.missingCount ? (
                    <Badge tone="danger">
                      {t("members.missing", { count: position.missingCount })}
                    </Badge>
                  ) : null}
                  {position.expiredCount ? (
                    <Badge tone="danger">
                      {t("members.expired", { count: position.expiredCount })}
                    </Badge>
                  ) : null}
                  {position.dueCount ? (
                    <Badge tone="warning">{t("members.due", { count: position.dueCount })}</Badge>
                  ) : null}
                </div>
              </Card>
            </Link>
          ))
        ) : (
          <Card className="p-8 text-sm text-muted sm:col-span-2 xl:col-span-3">
            {t("members.empty")}
          </Card>
        )}
      </div>
      <Link
        href="/admin/members/positions/PILOT"
        className="inline-flex text-sm font-semibold text-brand"
      >
        {t("members.viewAll")}
      </Link>
    </PageContainer>
  );
}
