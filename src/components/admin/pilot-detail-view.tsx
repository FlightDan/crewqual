"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  PilotEditAction,
  PilotQualificationCreateAction,
} from "@/components/admin/pilot-management-dialogs";
import { QualificationHealthList } from "@/components/admin/qualification-health-list";
import { PilotHealthBadge, ReviewStatusBadge } from "@/components/admin/status-badges";
import { UpgradeStageTimeline } from "@/components/admin/upgrade-stage-timeline";
import { PageContainer } from "@/components/layout/page-container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdminState } from "@/services/admin-state-provider";
import { useApplicationServices } from "@/services/application-services-provider";
import type { AdminPilotDetail } from "@/types/services";

export function PilotDetailView({
  pilotId,
  memberMode = false,
}: {
  pilotId: string;
  memberMode?: boolean;
}) {
  const state = useAdminState();
  const { pilotDirectory } = useApplicationServices();
  const [pilot, setPilot] = React.useState<AdminPilotDetail | null | undefined>(undefined);
  const [refreshVersion, setRefreshVersion] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    void pilotDirectory.getById(pilotId).then((result) => {
      if (active) setPilot(result.data);
    });
    return () => {
      active = false;
    };
  }, [pilotDirectory, pilotId, refreshVersion, state]);

  if (pilot === undefined) {
    return (
      <PageContainer>
        <Skeleton className="h-40 w-full" />
      </PageContainer>
    );
  }
  if (pilot === null) {
    return (
      <PageContainer>
        <EmptyState
          title={memberMode ? "未找到成员档案" : "未找到飞行员档案"}
          description={
            memberMode ? "该 ID 不存在或不属于当前组织。" : "该 ID 不存在或不属于当前中队。"
          }
          action={
            <Link
              href={memberMode ? "/admin/members" : "/admin/pilots"}
              className="font-semibold text-brand"
            >
              返回{memberMode ? "成员" : "飞行员"}列表
            </Link>
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader
        title={memberMode ? "成员个人资质与升级档案" : "飞行员个人资质与升级档案"}
        description={
          memberMode
            ? "通用人员资料、职位任职、资质记录、升级节点与更新申请"
            : "六项核心资质、升级节点与更新申请共用同一领域记录"
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <PilotEditAction pilot={pilot} onCompleted={setPilot} />
            <PilotQualificationCreateAction
              pilot={pilot}
              onCompleted={() => setRefreshVersion((value) => value + 1)}
            />
            <Link
              href={memberMode ? "/admin/members" : "/admin/pilots"}
              className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand"
            >
              <ArrowLeft className="size-4" />
              返回{memberMode ? "成员" : "飞行员"}列表
            </Link>
          </div>
        }
      />
      <Card className="p-4 shadow-none">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-blue-50 text-lg font-bold text-brand">
            {pilot.initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold">{pilot.displayName}</h3>
              <Badge tone={pilot.active ? "success" : "neutral"}>
                {pilot.active ? "启用" : "已停用"}
              </Badge>
              <PilotHealthBadge health={pilot.health} />
            </div>
            <p className="mt-1 text-xs text-secondary">
              员工号：{pilot.employeeNumber} · {pilot.unit}
            </p>
            <p className="mt-1 text-xs text-secondary">
              当前职务：{pilot.role}（{pilot.aircraftType}） · 级别代码：{pilot.rankCode}
            </p>
            <p className="mt-1 text-xs text-secondary">
              手机号：{pilot.mobile} · 单位代码：{pilot.unitCode}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-md border border-border px-3 py-2">
              <p className="text-muted">资质健康度</p>
              <p className="mt-1 font-bold">
                {pilot.health === "normal"
                  ? "100% 正常"
                  : `${pilot.expiredCount} 过期 / ${pilot.expiringCount} 临期`}
              </p>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              <p className="text-muted">进行中计划</p>
              <p className="mt-1 max-w-36 truncate font-bold text-brand">
                {pilot.activeUpgradeTitle ?? "无"}
              </p>
            </div>
          </div>
        </div>
      </Card>

      <div className="md:hidden">
        <Tabs defaultValue="qualifications">
          <TabsList className="grid w-full grid-cols-4 overflow-x-auto rounded-none border-b border-border bg-transparent p-0">
            <TabsTrigger value="qualifications" className="px-1 text-xs">
              核心资质
            </TabsTrigger>
            <TabsTrigger value="upgrade" className="px-1 text-xs">
              升级计划
            </TabsTrigger>
            <TabsTrigger value="reviews" className="px-1 text-xs">
              更新记录
            </TabsTrigger>
            <TabsTrigger value="files" className="px-1 text-xs">
              电子档案
            </TabsTrigger>
          </TabsList>
          <TabsContent value="qualifications">
            <QualificationHealthList qualifications={pilot.qualifications} />
          </TabsContent>
          <TabsContent value="upgrade">
            <UpgradeStageTimeline plan={pilot.upgradePlan} />
          </TabsContent>
          <TabsContent value="reviews">
            <PilotReviewRecords pilot={pilot} />
          </TabsContent>
          <TabsContent value="files">
            <ElectronicFiles pilot={pilot} />
          </TabsContent>
        </Tabs>
      </div>

      <div data-testid="pilot-detail-desktop" className="hidden space-y-5 md:block">
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-bold">核心资质清单监视（6 项核心资质）</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs text-secondary">
                <tr>
                  {[
                    "资质项目名称",
                    "持有等级/参数",
                    "到期日期",
                    "剩余有效期",
                    "状态",
                    "最近校验日期",
                  ].map((heading) => (
                    <th key={heading} scope="col" className="px-3 py-2 font-semibold">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pilot.qualifications.map((qualification, index) => (
                  <tr key={qualification.id} className="border-t border-border">
                    <td className="px-3 py-3 font-semibold">
                      {index + 1}. {qualification.name}
                    </td>
                    <td className="px-3 py-3 text-secondary">
                      {qualification.parameter ?? "合格"}
                    </td>
                    <td className="px-3 py-3">{qualification.expiresOn}</td>
                    <td className="px-3 py-3 text-secondary">{qualification.remainingLabel}</td>
                    <td className="px-3 py-3">
                      <span className="font-semibold">{qualification.statusLabel}</span>
                    </td>
                    <td className="px-3 py-3 text-muted">
                      {
                        pilot.qualificationRecords.find((item) => item.id === qualification.id)
                          ?.lastVerifiedOn
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="rounded-lg border border-border bg-card p-4">
          <UpgradeStageTimeline plan={pilot.upgradePlan} />
        </section>
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-bold">更新申请记录</h3>
            <PilotReviewRecords pilot={pilot} />
          </section>
          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-bold">电子档案</h3>
            <ElectronicFiles pilot={pilot} />
          </section>
        </div>
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-bold">系统操作审计</h3>
          {pilot.systemAudit.length ? (
            <ol className="space-y-3">
              {pilot.systemAudit.map((event) => (
                <li key={event.id} className="border-l-2 border-blue-100 pl-3 text-xs">
                  <p className="font-semibold">{event.detail}</p>
                  <p className="mt-1 text-muted">
                    {event.actor} · {event.occurredAt}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">暂无系统审计记录</p>
          )}
        </section>
      </div>
    </PageContainer>
  );
}

function PilotReviewRecords({ pilot }: { pilot: AdminPilotDetail }) {
  if (!pilot.reviews.length)
    return <EmptyState title="暂无更新申请" description="当前飞行员还没有提交资质更新。" />;
  return (
    <div className="space-y-2">
      {pilot.reviews.map((review) => (
        <Link
          key={review.id}
          href={`/admin/reviews/${review.id}`}
          className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{review.qualificationName}</p>
            <p className="mt-1 text-[11px] text-muted">
              {review.submittedAt} · {review.id}
            </p>
          </div>
          <ReviewStatusBadge status={review.humanStatus} />
        </Link>
      ))}
    </div>
  );
}

function ElectronicFiles({ pilot }: { pilot: AdminPilotDetail }) {
  if (!pilot.electronicFiles.length)
    return <EmptyState title="暂无电子档案" description="当前飞行员没有归档文件。" />;
  return (
    <div className="space-y-2">
      {pilot.electronicFiles.map((file) => (
        <div key={file.id} className="flex items-center gap-3 rounded-md border border-border p-3">
          <FileText aria-hidden="true" className="size-5 text-brand" />
          <div>
            <p className="text-sm font-semibold">{file.name}</p>
            <p className="mt-1 text-[11px] text-muted">归档日期：{file.addedAt}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
