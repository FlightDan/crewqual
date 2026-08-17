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

  React.useEffect(() => {
    if (!remoteMode) {
      setPositions([
        {
          id: "pilot-preview",
          code: "PILOT",
          name: "飞行员",
          description: "中国民航飞行员资质与升级计划",
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
        if (!response.ok) throw new Error("无法读取职位");
        if (active) setPositions(body.data?.items ?? []);
      })
      .catch(() => {
        if (active) setPositions([]);
      });
    return () => {
      active = false;
    };
  }, [remoteMode, state.pilots]);

  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader
        title="成员管理"
        description="按职位进入成员列表；职位配置、资质要求与历史记录保持在同一组织边界内。"
      />
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
                  <Badge tone="neutral">{position.memberCount} 名成员</Badge>
                  {position.missingCount ? (
                    <Badge tone="danger">缺失 {position.missingCount}</Badge>
                  ) : null}
                  {position.expiredCount ? (
                    <Badge tone="danger">过期 {position.expiredCount}</Badge>
                  ) : null}
                  {position.dueCount ? (
                    <Badge tone="warning">90 天内 {position.dueCount}</Badge>
                  ) : null}
                </div>
              </Card>
            </Link>
          ))
        ) : (
          <Card className="p-8 text-sm text-muted sm:col-span-2 xl:col-span-3">
            当前组织还没有已安装的职位模板。
          </Card>
        )}
      </div>
      <Link
        href="/admin/members/positions/PILOT"
        className="inline-flex text-sm font-semibold text-brand"
      >
        查看全部成员 →
      </Link>
    </PageContainer>
  );
}
