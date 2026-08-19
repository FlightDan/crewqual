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
import { useI18n } from "@/components/i18n-provider";
import { localizedQualificationText } from "@/lib/messages";

export function PilotDetailView({
  pilotId,
  memberMode = false,
}: {
  pilotId: string;
  memberMode?: boolean;
}) {
  const state = useAdminState();
  const { pilotDirectory } = useApplicationServices();
  const { t } = useI18n();
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
          title={memberMode ? t("pilotDetail.memberNotFound") : t("pilotDetail.pilotNotFound")}
          description={
            memberMode ? t("pilotDetail.orgDescription") : t("pilotDetail.squadronDescription")
          }
          action={
            <Link
              href={memberMode ? "/admin/members" : "/admin/pilots"}
              className="font-semibold text-brand"
            >
              {t("pilotDetail.backList", {
                type: memberMode ? t("members.name") : t("portal.pilot"),
              })}
            </Link>
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader
        title={memberMode ? t("pilotDetail.memberTitle") : t("pilotDetail.pilotTitle")}
        description={
          memberMode ? t("pilotDetail.memberDescription") : t("pilotDetail.pilotDescription")
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
              {t("pilotDetail.backList", {
                type: memberMode ? t("members.name") : t("portal.pilot"),
              })}
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
                {pilot.active ? t("members.active") : t("members.inactive")}
              </Badge>
              <PilotHealthBadge health={pilot.health} />
            </div>
            <p className="mt-1 text-xs text-secondary">
              {t("pilotDetail.employee", { value: pilot.employeeNumber, unit: pilot.unit })}
            </p>
            <p className="mt-1 text-xs text-secondary">
              {t("pilotDetail.currentRole", {
                role: pilot.role,
                aircraft: pilot.aircraftType,
                rank: pilot.rankCode,
              })}
            </p>
            <p className="mt-1 text-xs text-secondary">
              {t("pilotDetail.mobile", { mobile: pilot.mobile, unit: pilot.unitCode })}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-md border border-border px-3 py-2">
              <p className="text-muted">{t("pilotDetail.health")}</p>
              <p className="mt-1 font-bold">
                {pilot.health === "normal"
                  ? t("pilotDetail.normalHealth")
                  : t("pilotDetail.healthSummary", {
                      expired: pilot.expiredCount,
                      expiring: pilot.expiringCount,
                    })}
              </p>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              <p className="text-muted">{t("pilotDetail.activePlan")}</p>
              <p className="mt-1 max-w-36 truncate font-bold text-brand">
                {pilot.activeUpgradeTitle ?? t("pilotDetail.none")}
              </p>
            </div>
          </div>
        </div>
      </Card>

      <div className="md:hidden">
        <Tabs defaultValue="qualifications">
          <TabsList className="grid w-full grid-cols-4 overflow-x-auto rounded-none border-b border-border bg-transparent p-0">
            <TabsTrigger value="qualifications" className="px-1 text-xs">
              {t("pilotDetail.coreTab")}
            </TabsTrigger>
            <TabsTrigger value="upgrade" className="px-1 text-xs">
              {t("pilotDetail.upgradeTab")}
            </TabsTrigger>
            <TabsTrigger value="reviews" className="px-1 text-xs">
              {t("pilotDetail.reviewTab")}
            </TabsTrigger>
            <TabsTrigger value="files" className="px-1 text-xs">
              {t("pilotDetail.filesTab")}
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
          <h3 className="mb-3 text-sm font-bold">{t("pilotDetail.coreTitle")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs text-secondary">
                <tr>
                  {[
                    t("pilotDetail.qualificationName"),
                    t("pilotDetail.level"),
                    t("pilotDetail.expiry"),
                    t("pilotDetail.remaining"),
                    t("pilotDetail.status"),
                    t("pilotDetail.verified"),
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
                      {qualification.parameter ?? t("pilotDetail.qualified")}
                    </td>
                    <td className="px-3 py-3">{qualification.expiresOn}</td>
                    <td className="px-3 py-3 text-secondary">
                      {localizedQualificationText(qualification.remainingLabel, t)}
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-semibold">
                        {localizedQualificationText(qualification.statusLabel, t)}
                      </span>
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
            <h3 className="mb-3 text-sm font-bold">{t("pilotDetail.reviewRecords")}</h3>
            <PilotReviewRecords pilot={pilot} />
          </section>
          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-bold">{t("pilotDetail.files")}</h3>
            <ElectronicFiles pilot={pilot} />
          </section>
        </div>
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-bold">{t("pilotDetail.audit")}</h3>
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
            <p className="text-sm text-muted">{t("pilotDetail.noAudit")}</p>
          )}
        </section>
      </div>
    </PageContainer>
  );
}

function PilotReviewRecords({ pilot }: { pilot: AdminPilotDetail }) {
  const { t } = useI18n();
  if (!pilot.reviews.length)
    return (
      <EmptyState
        title={t("pilotDetail.noReviews")}
        description={t("pilotDetail.noReviewsDescription")}
      />
    );
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
  const { t } = useI18n();
  if (!pilot.electronicFiles.length)
    return (
      <EmptyState
        title={t("pilotDetail.noFiles")}
        description={t("pilotDetail.noFilesDescription")}
      />
    );
  return (
    <div className="space-y-2">
      {pilot.electronicFiles.map((file) => (
        <div key={file.id} className="flex items-center gap-3 rounded-md border border-border p-3">
          <FileText aria-hidden="true" className="size-5 text-brand" />
          <div>
            <p className="text-sm font-semibold">{file.name}</p>
            <p className="mt-1 text-[11px] text-muted">
              {t("pilotDetail.archivedAt", { date: file.addedAt })}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
