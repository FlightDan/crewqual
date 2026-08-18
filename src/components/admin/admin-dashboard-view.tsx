"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ApprovalDialog } from "@/components/admin/review-dialogs";
import { DashboardStatCard } from "@/components/admin/dashboard-stat-card";
import { ResponsiveReviewList } from "@/components/admin/responsive-review-list";
import { AiResultBadge, UpgradeStageBadge } from "@/components/admin/status-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { PageContainer } from "@/components/layout/page-container";
import { Skeleton } from "@/components/ui/misc";
import { useAdminState } from "@/services/admin-state-provider";
import { useApplicationServices } from "@/services/application-services-provider";
import type { AdminDashboardSummary, QualificationReview } from "@/types/services";
import { useAdminSession } from "@/services/admin-session-provider";

type DashboardMetricKey =
  "expired" | "due-7" | "due-30" | "pending-review" | "weekly-upgrade" | "delayed-upgrade";

export function AdminDashboardView() {
  const state = useAdminState();
  const { adminDashboard } = useApplicationServices();
  const { hasPermission } = useAdminSession();
  const canDecide = hasPermission("reviews.decide");
  const [summary, setSummary] = React.useState<AdminDashboardSummary | null>(null);
  const [quickApproval, setQuickApproval] = React.useState<QualificationReview | null>(null);
  const [selectedMetric, setSelectedMetric] = React.useState<DashboardMetricKey | null>(null);

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
    {
      key: "expired",
      label: "已过期资质",
      value: summary.expiredCount,
      note: "需立即处理",
      tone: "danger",
    },
    {
      key: "due-7",
      label: "7 日内到期",
      value: summary.dueIn7DaysCount,
      note: "亟需更新复训",
      tone: "warning",
    },
    {
      key: "due-30",
      label: "30 日内到期",
      value: summary.dueIn30DaysCount,
      note: "正常跟进计划",
      tone: "warning",
    },
    {
      key: "pending-review",
      label: "待审核更新",
      value: summary.pendingReviewCount,
      note: "AI 仅供人工参考",
      tone: "info",
    },
    {
      key: "weekly-upgrade",
      label: "本周升级节点",
      value: summary.weeklyUpgradeCount,
      note: "重点复审训练",
      tone: "success",
    },
    {
      key: "delayed-upgrade",
      label: "已延期节点",
      value: summary.delayedUpgradeCount,
      note: "计划异常跟进",
      tone: "purple",
    },
  ] as const;
  const selectedStat = stats.find((stat) => stat.key === selectedMetric);

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
        {stats.map((stat) => (
          <DashboardStatCard
            key={stat.key}
            testId={`dashboard-stat-${stat.label}`}
            label={stat.label}
            value={stat.value}
            note={stat.note}
            tone={stat.tone}
            expanded={selectedMetric === stat.key}
            onClick={() => setSelectedMetric(stat.key)}
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

      <Drawer
        open={Boolean(selectedMetric)}
        onOpenChange={(open) => {
          if (!open) setSelectedMetric(null);
        }}
      >
        <DrawerContent
          side="right"
          className="flex w-[min(29rem,calc(100vw-1rem))] flex-col overflow-hidden"
        >
          <div className="flex items-start gap-4 border-b border-border p-5">
            <div className="min-w-0 flex-1">
              <DrawerTitle className="text-lg font-bold text-primary">
                {selectedStat?.label ?? "待处理事项"}明细
              </DrawerTitle>
              <DrawerDescription className="mt-1 text-sm text-secondary">
                {selectedStat
                  ? `${selectedStat.note}，共 ${selectedStat.value} 项。选择事项进入对应处理页面。`
                  : "选择事项进入对应处理页面。"}
              </DrawerDescription>
            </div>
            <button
              type="button"
              aria-label="关闭待处理事项明细"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-secondary transition hover:bg-slate-50 hover:text-primary"
              onClick={() => setSelectedMetric(null)}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {selectedMetric ? (
              <DashboardMetricDetails metric={selectedMetric} summary={summary} />
            ) : null}
          </div>
        </DrawerContent>
      </Drawer>
    </PageContainer>
  );
}

function DashboardMetricDetails({
  metric,
  summary,
}: {
  metric: DashboardMetricKey;
  summary: AdminDashboardSummary;
}) {
  if (metric === "expired" || metric === "due-7" || metric === "due-30") {
    const alerts = summary.qualificationAlerts.filter((alert) => {
      if (metric === "expired") return alert.daysRemaining < 0;
      if (metric === "due-7") return alert.daysRemaining >= 0 && alert.daysRemaining <= 7;
      return alert.daysRemaining >= 0 && alert.daysRemaining <= 30;
    });
    return alerts.length ? (
      <div className="space-y-3">
        {alerts.map((alert) => (
          <Link
            key={`${alert.pilotId}-${alert.qualification.id}`}
            href={`/admin/pilots/${alert.pilotId}`}
            className="group block rounded-lg border border-border p-4 transition hover:border-brand/40 hover:bg-blue-50/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-primary">{alert.pilotName}</p>
                <p className="mt-1 truncate text-xs text-secondary">{alert.qualification.name}</p>
                <p className="mt-2 text-[11px] text-muted">
                  到期日期：{alert.qualification.expiresOn}
                </p>
              </div>
              <Badge tone={alert.daysRemaining < 0 ? "danger" : "warning"} className="shrink-0">
                {alert.qualification.remainingLabel}
              </Badge>
            </div>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand">
              查看成员档案
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </span>
          </Link>
        ))}
      </div>
    ) : (
      <DashboardMetricEmpty />
    );
  }

  if (metric === "pending-review") {
    return summary.pendingReviews.length ? (
      <div className="space-y-3">
        {summary.pendingReviews.map((review) => (
          <Link
            key={review.id}
            href={`/admin/reviews/${review.id}`}
            className="group block rounded-lg border border-border p-4 transition hover:border-brand/40 hover:bg-blue-50/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-primary">{review.pilotName}</p>
                <p className="mt-1 truncate text-xs text-secondary">{review.qualificationName}</p>
                <p className="mt-2 text-[11px] text-muted">提交时间：{review.submittedAt}</p>
              </div>
              <AiResultBadge status={review.aiStatus} />
            </div>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand">
              进入人工审核
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </span>
          </Link>
        ))}
      </div>
    ) : (
      <DashboardMetricEmpty />
    );
  }

  const upgrades = metric === "weekly-upgrade" ? summary.weeklyUpgrades : summary.delayedUpgrades;
  return upgrades.length ? (
    <div className="space-y-3">
      {upgrades.map((item) => (
        <Link
          key={`${item.planId}-${item.stage.id}`}
          href={`/admin/upgrade-plans/${item.planId}`}
          className="group block rounded-lg border border-border p-4 transition hover:border-brand/40 hover:bg-blue-50/40"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-primary">
                {item.pilotName}（{item.role}）
              </p>
              <p className="mt-1 truncate text-xs text-secondary">
                {item.stage.name} · {item.planTitle}
              </p>
              <p className="mt-2 text-[11px] text-muted">
                计划日期：{item.stage.plannedStart} 至 {item.stage.plannedEnd}
              </p>
            </div>
            <UpgradeStageBadge status={item.stage.status} />
          </div>
          <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand">
            查看升级计划
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </span>
        </Link>
      ))}
    </div>
  ) : (
    <DashboardMetricEmpty />
  );
}

function DashboardMetricEmpty() {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center">
      <p className="text-sm font-semibold text-primary">当前没有需要处理的事项</p>
      <p className="mt-1 text-xs text-muted">数据变化后会自动出现在这里</p>
    </div>
  );
}
