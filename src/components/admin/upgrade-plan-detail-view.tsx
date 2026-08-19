"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Pause, Play, XCircle } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { UpgradeStageBadge } from "@/components/admin/status-badges";
import { PageContainer } from "@/components/layout/page-container";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DateField, Textarea } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { localizeError } from "@/lib/error-i18n";
import {
  upgradeStageCompletionSchema,
  upgradeStageRescheduleSchema,
} from "@/lib/admin-operations-validation";
import { deriveQualificationDateState, systemClock } from "@/lib/qualification-date-status";
import { useAdminState } from "@/services/admin-state-provider";
import { useApplicationServices } from "@/services/application-services-provider";
import type { UpgradePlanRecord, UpgradePlanStageRecord } from "@/types/services";
import { useAdminSession } from "@/services/admin-session-provider";
import { useI18n } from "@/components/i18n-provider";

export function UpgradePlanDetailView({ planId }: { planId: string }) {
  const { t } = useI18n();
  const state = useAdminState();
  const { upgradePlans } = useApplicationServices();
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission("operations.write");
  const [plan, setPlan] = React.useState<UpgradePlanRecord | null | undefined>(undefined);
  const [confirmAction, setConfirmAction] = React.useState<
    "start" | "pause" | "resume" | "cancel" | null
  >(null);
  const [selectedStage, setSelectedStage] = React.useState<UpgradePlanStageRecord | null>(null);
  const [stageAction, setStageAction] = React.useState<"reschedule" | "complete" | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [completedOn, setCompletedOn] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [error, setError] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    void upgradePlans.getById(planId).then((result) => {
      if (active) setPlan(result.data);
    });
    return () => {
      active = false;
    };
  }, [planId, state, upgradePlans]);
  if (plan === undefined)
    return (
      <PageContainer>
        <Skeleton className="h-96" />
      </PageContainer>
    );
  if (plan === null)
    return (
      <PageContainer>
        <EmptyState
          title={t("upgradeDetail.notFoundTitle")}
          description={t("upgradeDetail.notFoundDescription")}
          action={
            <Link href="/admin/upgrade-plans" className="font-semibold text-brand">
              {t("upgradeDetail.backList")}
            </Link>
          }
        />
      </PageContainer>
    );
  const pilot = state.pilots.find((item) => item.id === plan.pilotId);
  const completeCount = plan.stages.filter((stage) => stage.status === "completed").length;
  const progress = Math.round((completeCount / 6) * 100);
  const current =
    plan.stages.find((stage) => stage.status === "in_progress" || stage.status === "delayed") ??
    plan.stages.find((stage) => stage.status === "scheduled");
  const currentIndex = current ? plan.stages.indexOf(current) : -1;
  const next = plan.stages
    .slice(Math.max(currentIndex + 1, 0))
    .find((stage) => stage.status !== "completed");
  const delayDays = plan.stages.reduce((sum, stage) => sum + (stage.delayDays ?? 0), 0);
  const readonly =
    !canWrite || plan.lifecycleStatus === "completed" || plan.lifecycleStatus === "cancelled";
  const runLifecycleAction = async () => {
    if (!confirmAction || loading) return;
    setLoading(true);
    setError("");
    try {
      if (confirmAction === "start") await upgradePlans.start(plan.id, plan.version);
      if (confirmAction === "pause") await upgradePlans.pause(plan.id, plan.version);
      if (confirmAction === "resume") await upgradePlans.resume(plan.id, plan.version);
      if (confirmAction === "cancel")
        await upgradePlans.cancel(plan.id, { reason: cancelReason, expectedVersion: plan.version });
      setConfirmAction(null);
      setCancelReason("");
    } catch (reason) {
      setError(localizeError(reason, t, "upgradeDetail.actionError"));
    } finally {
      setLoading(false);
    }
  };
  const openStage = (stage: UpgradePlanStageRecord, action: "reschedule" | "complete") => {
    setSelectedStage(stage);
    setStageAction(action);
    setStart(stage.plannedStart);
    setEnd(stage.plannedEnd);
    setCompletedOn(stage.plannedEnd);
    setSummary("");
    setError("");
    setFieldErrors({});
  };
  const saveStage = async () => {
    if (!selectedStage || !stageAction || loading) return;
    setError("");
    setFieldErrors({});
    const validation =
      stageAction === "reschedule"
        ? upgradeStageRescheduleSchema.safeParse({ plannedStart: start, plannedEnd: end })
        : upgradeStageCompletionSchema.safeParse({
            completedOn,
            resultSummary: summary,
          });
    if (!validation.success) {
      setFieldErrors(
        Object.fromEntries(
          validation.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      setError(validation.error.issues[0]?.message ?? t("upgradeDetail.validationError"));
      return;
    }
    setLoading(true);
    try {
      if (stageAction === "reschedule")
        await upgradePlans.rescheduleStage(plan.id, selectedStage.id, {
          plannedStart: start,
          plannedEnd: end,
          expectedVersion: plan.version,
        });
      else
        await upgradePlans.completeStage(plan.id, selectedStage.id, {
          completedOn,
          resultSummary: summary,
          expectedVersion: plan.version,
        });
      setStageAction(null);
      setSelectedStage(null);
    } catch (reason) {
      const message = localizeError(reason, t, "upgradeDetail.saveError");
      setError(message);
      if (stageAction === "reschedule") {
        setFieldErrors({ plannedStart: message, plannedEnd: message });
      }
    } finally {
      setLoading(false);
    }
  };
  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader
        title={t("upgradeDetail.title")}
        description={t("upgradeDetail.description")}
        action={
          <Link
            href="/admin/upgrade-plans"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand"
          >
            <ArrowLeft className="size-4" />
            {t("upgradeDetail.backList")}
          </Link>
        }
      />
      <Card className="p-4 shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{t(`upgradePlans.type.${plan.type}`)}</Badge>
              <Badge
                tone={
                  plan.lifecycleStatus === "completed"
                    ? "success"
                    : plan.lifecycleStatus === "cancelled"
                      ? "danger"
                      : plan.lifecycleStatus === "paused"
                        ? "warning"
                        : "info"
                }
              >
                {t(`upgradePlans.lifecycle.${plan.lifecycleStatus}`)}
                {delayDays > 0 && plan.lifecycleStatus === "active"
                  ? ` (${t("status.upgrade.delayed")})`
                  : ""}
              </Badge>
            </div>
            <h2 className="mt-3 text-xl font-bold">
              {pilot?.displayName}（{pilot?.employeeNumber}）· {plan.title}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {plan.planNumber} · {plan.startDate} {t("common.to")} {plan.endDate}
            </p>
          </div>
          <div className="min-w-56">
            {canWrite && ["draft", "not_started"].includes(plan.lifecycleStatus) ? (
              <Link
                href={`/admin/upgrade-plans/${plan.id}/edit`}
                className="mb-3 inline-flex min-h-9 items-center text-sm font-semibold text-brand"
              >
                {t("upgradeDetail.edit")}
              </Link>
            ) : null}
            <div className="flex justify-between text-xs">
              <span>{t("upgradeDetail.overallProgress")}</span>
              <b className="text-brand">{progress}%</b>
            </div>
            <div className="mt-2 h-2 rounded-full bg-blue-50">
              <div className="h-full rounded-full bg-brand" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted">{t("upgradeDetail.currentStage")}</p>
            <p className="mt-1 font-bold">{current?.name ?? t("upgradeDetail.none")}</p>
          </div>
          <div>
            <p className="text-xs text-muted">{t("upgradeDetail.nextStage")}</p>
            <p className="mt-1 font-bold">{next?.name ?? t("upgradeDetail.none")}</p>
          </div>
          <div>
            <p className="text-xs text-muted">{t("upgradeDetail.owner")}</p>
            <p className="mt-1 font-bold">{plan.overallOwner}</p>
          </div>
        </div>
      </Card>
      {plan.lifecycleStatus === "cancelled" ? (
        <Alert tone="danger">
          {t("upgradeDetail.cancelled", {
            reason: plan.cancellationReason ?? t("upgradeDetail.none"),
          })}
        </Alert>
      ) : null}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="shadow-none">
          <CardHeader>
            <div>
              <h3 className="text-base font-bold">{t("upgradeDetail.stageMonitor")}</h3>
              <p className="mt-1 text-xs text-muted">{t("upgradeDetail.stageDescription")}</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {plan.stages.map((stage, index) => {
              const priorComplete = plan.stages
                .slice(0, index)
                .every((item) => item.status === "completed");
              return (
                <article
                  key={stage.id}
                  className={`rounded-lg border p-4 ${stage.status === "delayed" ? "border-red-200 bg-red-50/40" : "border-border"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h4 className="font-bold">
                      {index + 1}. {t(`upgrade.stage.${stage.code}`)}
                    </h4>
                    <UpgradeStageBadge status={stage.status} />
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                    <div>
                      <dt className="text-muted">{t("upgradeDetail.stagePeriod")}</dt>
                      <dd className="mt-1 font-semibold">
                        {stage.plannedStart} {t("common.to")} {stage.plannedEnd}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">{t("upgradeDetail.completedOn")}</dt>
                      <dd className="mt-1 font-semibold">{stage.completedOn ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">{t("upgradeDetail.stageOwner")}</dt>
                      <dd className="mt-1 font-semibold">{stage.owner}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 rounded-md bg-slate-50 p-2 text-xs text-secondary">
                    {(stage.resultSummary ?? stage.notes) || t("upgradeDetail.noNotes")}
                  </p>
                  {stage.inspectionItems?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {stage.inspectionItems.map((item) => (
                        <Badge
                          key={item.id}
                          tone={item.status === "completed" ? "success" : "info"}
                        >
                          {item.name} · v{item.ruleVersion}
                          {item.completedOn ? ` · ${item.completedOn}` : ""}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {!readonly ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openStage(stage, "reschedule")}
                      >
                        {t("upgradeDetail.reschedule")}
                      </Button>
                      <Button
                        size="sm"
                        disabled={
                          plan.lifecycleStatus !== "active" ||
                          stage.status === "completed" ||
                          !priorComplete ||
                          !["scheduled", "in_progress", "delayed"].includes(stage.status)
                        }
                        onClick={() => openStage(stage, "complete")}
                      >
                        {t("upgradeDetail.complete")}
                      </Button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </CardContent>
        </Card>
        <aside className="space-y-4 xl:sticky xl:top-20">
          <Card className="shadow-none">
            <CardHeader>
              <h3 className="text-sm font-bold">{t("upgradeDetail.controlPanel")}</h3>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">{t("upgradeDetail.department")}</dt>
                  <dd className="text-right font-semibold">{plan.leadDepartment}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">{t("upgradeDetail.prerequisite")}</dt>
                  <dd className="text-right font-semibold">
                    {pilot?.qualifications.some(
                      (item) =>
                        deriveQualificationDateState(item.expiresOn, systemClock).status ===
                        "expired",
                    )
                      ? t("upgradeDetail.qualificationExpired")
                      : t("upgradeDetail.qualificationNormal")}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">{t("upgradeDetail.completedStages")}</dt>
                  <dd className="font-semibold">{completeCount} / 6</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">{t("upgradeDetail.totalDelay")}</dt>
                  <dd className="font-semibold text-danger">
                    {delayDays} {t("upgradeDetail.days")}
                  </dd>
                </div>
              </dl>
              <div className="mt-5 space-y-2">
                {canWrite && ["draft", "not_started"].includes(plan.lifecycleStatus) ? (
                  <Button
                    className="w-full"
                    onClick={() => {
                      setError("");
                      setConfirmAction("start");
                    }}
                  >
                    <Play className="size-4" />
                    {t("upgradeDetail.start")}
                  </Button>
                ) : null}
                {canWrite && plan.lifecycleStatus === "active" ? (
                  <Button
                    className="w-full"
                    variant="secondary"
                    onClick={() => {
                      setError("");
                      setConfirmAction("pause");
                    }}
                  >
                    <Pause className="size-4" />
                    {t("upgradeDetail.pause")}
                  </Button>
                ) : null}
                {canWrite && plan.lifecycleStatus === "paused" ? (
                  <Button
                    className="w-full"
                    onClick={() => {
                      setError("");
                      setConfirmAction("resume");
                    }}
                  >
                    <Play className="size-4" />
                    {t("upgradeDetail.resume")}
                  </Button>
                ) : null}
                {canWrite && ["not_started", "active", "paused"].includes(plan.lifecycleStatus) ? (
                  <Button
                    className="w-full"
                    variant="danger"
                    onClick={() => {
                      setError("");
                      setConfirmAction("cancel");
                    }}
                  >
                    <XCircle className="size-4" />
                    {t("upgradeDetail.cancel")}
                  </Button>
                ) : null}
                {readonly ? (
                  <p className="rounded-md bg-slate-100 p-3 text-center text-xs text-muted">
                    {!canWrite
                      ? t("upgradeDetail.readonlyRole")
                      : t("upgradeDetail.readonlyCompleted")}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
          <Card className="p-4 shadow-none">
            <h3 className="text-sm font-bold">{t("upgradeDetail.inspectionSnapshot")}</h3>
            <ul className="mt-2 space-y-2 text-xs text-secondary">
              {plan.inspectionItems.map((item) => (
                <li key={item.id} className="rounded-md bg-slate-50 p-2">
                  {item.name} · {t("upgradeDetail.rule")} v{item.ruleVersion} ·{" "}
                  {item.status === "completed"
                    ? t("upgradeDetail.done")
                    : t("upgradeDetail.pending")}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-4 shadow-none">
            <h3 className="text-sm font-bold">{t("upgradeDetail.supplemental")}</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-secondary">
              {plan.supplementalRequirements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted">{t("upgradeDetail.supplementalNote")}</p>
          </Card>
        </aside>
      </div>
      <Dialog
        open={Boolean(confirmAction)}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <DialogContent>
          <DialogTitle className="text-lg font-bold">
            {t("upgradeDetail.confirm")}{" "}
            {confirmAction === "start"
              ? t("upgradeDetail.confirmStart")
              : confirmAction === "pause"
                ? t("upgradeDetail.confirmPause")
                : confirmAction === "resume"
                  ? t("upgradeDetail.confirmResume")
                  : t("upgradeDetail.confirmCancel")}{" "}
            {t("upgradeDetail.confirmSuffix")}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted">
            {t("upgradeDetail.confirmDescription")}
          </DialogDescription>
          <div className="mt-4 space-y-3">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {confirmAction === "cancel" ? (
              <Textarea
                label={t("upgradeDetail.cancelReason")}
                required
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                error={error || undefined}
                placeholder={t("upgradeDetail.cancelPlaceholder")}
              />
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmAction(null)}>
                {t("upgradeDetail.back")}
              </Button>
              <Button
                variant={confirmAction === "cancel" ? "danger" : "primary"}
                loading={loading}
                onClick={() => void runLifecycleAction()}
              >
                {t("upgradeDetail.confirmAction")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(stageAction)} onOpenChange={(open) => !open && setStageAction(null)}>
        <DialogContent>
          <DialogTitle className="text-lg font-bold">
            {stageAction === "complete"
              ? t("upgradeDetail.completeTitle")
              : t("upgradeDetail.rescheduleTitle")}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted">
            {t("upgradeDetail.stageDialogDescription", {
              stage: selectedStage?.name ?? t("upgradeDetail.none"),
            })}
          </DialogDescription>
          <div className="mt-4 space-y-3">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {stageAction === "reschedule" ? (
              <>
                <DateField
                  label={t("upgradeDetail.plannedStart")}
                  required
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  error={fieldErrors.plannedStart}
                />
                <DateField
                  label={t("upgradeDetail.plannedEnd")}
                  required
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  error={fieldErrors.plannedEnd}
                />
              </>
            ) : (
              <>
                <DateField
                  label={t("upgradeDetail.completionDate")}
                  required
                  value={completedOn}
                  onChange={(event) => setCompletedOn(event.target.value)}
                  error={fieldErrors.completedOn}
                />
                <Textarea
                  label={t("upgradeDetail.resultSummary")}
                  required
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  error={fieldErrors.resultSummary}
                />
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setStageAction(null)}>
                {t("upgradeDetail.cancelAction")}
              </Button>
              <Button loading={loading} onClick={() => void saveStage()}>
                {t("upgradeDetail.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
