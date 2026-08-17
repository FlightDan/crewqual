"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ApprovalDialog } from "@/components/admin/review-dialogs";
import { DashboardStatCard } from "@/components/admin/dashboard-stat-card";
import { ResponsiveReviewList } from "@/components/admin/responsive-review-list";
import { UpgradeStageBadge } from "@/components/admin/status-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageContainer } from "@/components/layout/page-container";
import { Skeleton } from "@/components/ui/misc";
import { useAdminState } from "@/services/admin-state-provider";
import { useApplicationServices } from "@/services/application-services-provider";
import type { AdminDashboardSummary, QualificationReview } from "@/types/services";
import { useAdminSession } from "@/services/admin-session-provider";

export function AdminDashboardView() {
  const state = useAdminState();
  const { adminDashboard } = useApplicationServices();
  const { hasPermission } = useAdminSession();
  const canDecide = hasPermission("reviews.decide");
  const [summary, setSummary] = React.useState<AdminDashboardSummary | null>(null);
  const [quickApproval, setQuickApproval] = React.useState<QualificationReview | null>(null);

  React.useEffect(() => {
    let active = true;
    void adminDashboard.getSummary().then((result) => {
      if (active) setSummary(result.data);
    });
    return () => {
      active = false;
    };
  }, [adminDashboard, state]);

  if (!summary) {
    return (
      <PageContainer className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-32" />
          ))}
        </div>
      </PageContainer>
    );
  }

  const stats = [
    ["已过期资质", summary.expiredCount, "需立即处理", "danger"],
    ["7 日内到期", summary.dueIn7DaysCount, "亟需更新复训", "warning"],
    ["30 日内到期", summary.dueIn30DaysCount, "正常跟进计划", "warning"],
    ["待审核更新", summary.pendingReviewCount, "AI 仅供人工参考", "info"],
    ["本周升级节点", summary.weeklyUpgradeCount, "重点复审训练", "success"],
    ["已延期节点", summary.delayedUpgradeCount, "计划异常跟进", "purple"],
  ] as const;

  return (
    <PageContainer className="space-y-6">
      <AdminPageHeader
        title="待处理资质事项"
        description="中队范围内需要紧急关注和人工审核的任务"
      />
      <section
        aria-label="管理员统计"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
      >
        {stats.map(([label, value, note, tone]) => (
          <DashboardStatCard
            key={label}
            testId={`dashboard-stat-${label}`}
            label={label}
            value={value}
            note={note}
            tone={tone}
          />
        ))}
      </section>

      <section aria-labelledby="dashboard-reviews-title" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 id="dashboard-reviews-title" className="text-base font-bold">
              待审核资质更新申请（{summary.pendingReviewCount}）
            </h3>
            <p className="mt-1 text-xs text-muted">所有审批均须由管理员确认，AI 不会自动审批</p>
          </div>
          <Link
            href="/admin/reviews"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand"
          >
            进入工作台 <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <ResponsiveReviewList
          reviews={summary.pendingReviews.slice(0, 4)}
          showQuickApprove={canDecide}
          onQuickApprove={setQuickApproval}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <div>
              <h3 className="text-sm font-bold">
                临期与过期资质预警（{summary.qualificationAlerts.length}）
              </h3>
              <p className="mt-1 text-xs text-muted">状态与剩余天数由共享时钟实时计算</p>
            </div>
            <Link href="/admin/pilots" className="text-xs font-semibold text-brand">
              查看全部
            </Link>
          </CardHeader>
          <CardContent className="divide-y divide-border pt-3">
            {summary.qualificationAlerts.slice(0, 6).map((alert) => (
              <Link
                key={`${alert.pilotId}-${alert.qualification.id}`}
                href={`/admin/pilots/${alert.pilotId}`}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{alert.pilotName}</p>
                  <p className="mt-0.5 truncate text-xs text-secondary">
                    {alert.qualification.name}
                  </p>
                </div>
                <Badge
                  tone={alert.qualification.status === "expired" ? "danger" : "warning"}
                  className="shrink-0"
                >
                  {alert.qualification.statusLabel}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <div>
              <h3 className="text-sm font-bold">本周计划内升级节点监督</h3>
              <p className="mt-1 text-xs text-muted">第三批仅提供只读摘要</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            {summary.weeklyUpgrades.length ? (
              summary.weeklyUpgrades.map((item) => (
                <div
                  key={`${item.pilotId}-${item.stage.name}`}
                  className="rounded-md border border-border p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">
                        {item.pilotName}（{item.role}）
                      </p>
                      <p className="mt-1 text-xs text-secondary">
                        {item.stage.name} · {item.planTitle}
                      </p>
                      <p className="mt-1 text-[11px] text-muted">
                        计划日期：{item.stage.plannedStart}
                      </p>
                    </div>
                    <UpgradeStageBadge status={item.stage.status} />
                  </div>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-sm text-muted">本周暂无升级节点</p>
            )}
          </CardContent>
        </Card>
      </div>

      {canDecide && quickApproval ? (
        <ApprovalDialog
          review={quickApproval}
          open
          onOpenChange={(open) => {
            if (!open) setQuickApproval(null);
          }}
          onCompleted={() => setQuickApproval(null)}
        />
      ) : null}
    </PageContainer>
  );
}
