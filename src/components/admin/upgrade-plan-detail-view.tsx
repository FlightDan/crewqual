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
import { lifecycleLabels, upgradeTypeLabels } from "@/lib/admin-labels";
import {
  upgradeStageCompletionSchema,
  upgradeStageRescheduleSchema,
} from "@/lib/admin-operations-validation";
import { deriveQualificationDateState, systemClock } from "@/lib/qualification-date-status";
import { useAdminState } from "@/services/admin-state-provider";
import { useApplicationServices } from "@/services/application-services-provider";
import type { UpgradePlanRecord, UpgradePlanStageRecord } from "@/types/services";
import { useAdminSession } from "@/services/admin-session-provider";

export function UpgradePlanDetailView({ planId }: { planId: string }) {
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
          title="未找到升级计划"
          description="该计划不存在或已被移除。"
          action={
            <Link href="/admin/upgrade-plans" className="font-semibold text-brand">
              返回计划列表
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
      setError(reason instanceof Error ? reason.message : "操作失败");
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
      setError(validation.error.issues[0]?.message ?? "请检查节点信息");
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
      const message = reason instanceof Error ? reason.message : "保存失败";
      setError(message);
      if (stageAction === "reschedule") {
        if (message.includes("整体计划周期")) {
          setFieldErrors({ plannedStart: message, plannedEnd: message });
        } else if (message.includes("前一") || message.includes("开始日期")) {
          setFieldErrors({ plannedStart: message });
        } else if (message.includes("后一") || message.includes("结束日期")) {
          setFieldErrors({ plannedEnd: message });
        }
      }
    } finally {
      setLoading(false);
    }
  };
  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader
        title="升级计划详情与控制"
        description="状态转换、节点日期和完成结果均由统一服务校验"
        action={
          <Link
            href="/admin/upgrade-plans"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand"
          >
            <ArrowLeft className="size-4" />
            返回列表
          </Link>
        }
      />
      <Card className="p-4 shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{upgradeTypeLabels[plan.type]}</Badge>
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
                {lifecycleLabels[plan.lifecycleStatus]}
                {delayDays > 0 && plan.lifecycleStatus === "active" ? "（已延期）" : ""}
              </Badge>
            </div>
            <h2 className="mt-3 text-xl font-bold">
              {pilot?.displayName}（{pilot?.employeeNumber}）· {plan.title}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {plan.planNumber} · {plan.startDate} 至 {plan.endDate}
            </p>
          </div>
          <div className="min-w-56">
            {canWrite && ["draft", "not_started"].includes(plan.lifecycleStatus) ? (
              <Link
                href={`/admin/upgrade-plans/${plan.id}/edit`}
                className="mb-3 inline-flex min-h-9 items-center text-sm font-semibold text-brand"
              >
                编辑计划整体信息
              </Link>
            ) : null}
            <div className="flex justify-between text-xs">
              <span>整体进度</span>
              <b className="text-brand">{progress}%</b>
            </div>
            <div className="mt-2 h-2 rounded-full bg-blue-50">
              <div className="h-full rounded-full bg-brand" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted">当前节点</p>
            <p className="mt-1 font-bold">{current?.name ?? "无"}</p>
          </div>
          <div>
            <p className="text-xs text-muted">下一节点</p>
            <p className="mt-1 font-bold">{next?.name ?? "无"}</p>
          </div>
          <div>
            <p className="text-xs text-muted">总责任人</p>
            <p className="mt-1 font-bold">{plan.overallOwner}</p>
          </div>
        </div>
      </Card>
      {plan.lifecycleStatus === "cancelled" ? (
        <Alert tone="danger">该计划已取消并进入只读状态。取消原因：{plan.cancellationReason}</Alert>
      ) : null}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="shadow-none">
          <CardHeader>
            <div>
              <h3 className="text-base font-bold">升级路径节点监控</h3>
              <p className="mt-1 text-xs text-muted">固定六节点，不允许改名、换序或跳过中间节点</p>
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
                      {index + 1}. {stage.name}
                    </h4>
                    <UpgradeStageBadge status={stage.status} />
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                    <div>
                      <dt className="text-muted">计划周期</dt>
                      <dd className="mt-1 font-semibold">
                        {stage.plannedStart} 至 {stage.plannedEnd}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">实际完成</dt>
                      <dd className="mt-1 font-semibold">{stage.completedOn ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">责任人</dt>
                      <dd className="mt-1 font-semibold">{stage.owner}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 rounded-md bg-slate-50 p-2 text-xs text-secondary">
                    {(stage.resultSummary ?? stage.notes) || "暂无备注"}
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
                        调整日期
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
                        登记完成
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
              <h3 className="text-sm font-bold">计划控制面板</h3>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">主导部门</dt>
                  <dd className="text-right font-semibold">{plan.leadDepartment}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">前置核心资质</dt>
                  <dd className="text-right font-semibold">
                    {pilot?.qualifications.some(
                      (item) =>
                        deriveQualificationDateState(item.expiresOn, systemClock).status ===
                        "expired",
                    )
                      ? "存在过期（启动阻断）"
                      : "六项正常/合规"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">已完成节点</dt>
                  <dd className="font-semibold">{completeCount} / 6</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">累计延期</dt>
                  <dd className="font-semibold text-danger">{delayDays} 天</dd>
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
                    启动计划
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
                    暂停计划
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
                    恢复计划
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
                    取消计划
                  </Button>
                ) : null}
                {readonly ? (
                  <p className="rounded-md bg-slate-100 p-3 text-center text-xs text-muted">
                    {!canWrite ? "当前角色为只读访问" : "已完成/已取消计划全部只读"}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
          <Card className="p-4 shadow-none">
            <h3 className="text-sm font-bold">检查项目快照</h3>
            <ul className="mt-2 space-y-2 text-xs text-secondary">
              {plan.inspectionItems.map((item) => (
                <li key={item.id} className="rounded-md bg-slate-50 p-2">
                  {item.name} · 规则 v{item.ruleVersion} ·{" "}
                  {item.status === "completed" ? "已完成" : "待完成"}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-4 shadow-none">
            <h3 className="text-sm font-bold">补充要求</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-secondary">
              {plan.supplementalRequirements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted">补充要求不计作第七个核心节点。</p>
          </Card>
        </aside>
      </div>
      <Dialog
        open={Boolean(confirmAction)}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <DialogContent>
          <DialogTitle className="text-lg font-bold">
            确认
            {confirmAction === "start"
              ? "启动"
              : confirmAction === "pause"
                ? "暂停"
                : confirmAction === "resume"
                  ? "恢复"
                  : "取消"}
            计划
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted">
            此操作将写入数据库审计记录，并按配置生成通知。
          </DialogDescription>
          <div className="mt-4 space-y-3">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {confirmAction === "cancel" ? (
              <Textarea
                label="取消原因"
                required
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                error={error || undefined}
                placeholder="至少 5 个字符"
              />
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmAction(null)}>
                返回
              </Button>
              <Button
                variant={confirmAction === "cancel" ? "danger" : "primary"}
                loading={loading}
                onClick={() => void runLifecycleAction()}
              >
                确认操作
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(stageAction)} onOpenChange={(open) => !open && setStageAction(null)}>
        <DialogContent>
          <DialogTitle className="text-lg font-bold">
            {stageAction === "complete" ? "登记完成结果" : "调整节点日期"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted">
            {selectedStage?.name} · 服务层会再次校验范围与固定顺序
          </DialogDescription>
          <div className="mt-4 space-y-3">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {stageAction === "reschedule" ? (
              <>
                <DateField
                  label="计划开始日期"
                  required
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  error={fieldErrors.plannedStart}
                />
                <DateField
                  label="计划结束日期"
                  required
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  error={fieldErrors.plannedEnd}
                />
              </>
            ) : (
              <>
                <DateField
                  label="完成日期"
                  required
                  value={completedOn}
                  onChange={(event) => setCompletedOn(event.target.value)}
                  error={fieldErrors.completedOn}
                />
                <Textarea
                  label="完成结果摘要"
                  required
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  error={fieldErrors.resultSummary}
                />
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setStageAction(null)}>
                取消
              </Button>
              <Button loading={loading} onClick={() => void saveStage()}>
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
