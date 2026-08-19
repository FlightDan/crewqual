"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DateField, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/misc";
import { upgradeTypeLabels } from "@/lib/admin-labels";
import { upgradePlanDraftSchema } from "@/lib/admin-operations-validation";
import { localizeError } from "@/lib/error-i18n";
import { useI18n } from "@/components/i18n-provider";
import { useAdminState } from "@/services/admin-state-provider";
import { useApplicationServices } from "@/services/application-services-provider";
import { upgradePlanDraftRepository } from "@/services/session-repository";
import {
  UPGRADE_STAGE_CODES,
  UPGRADE_STAGE_NAMES,
  type InspectionItem,
  type UpgradePlanDraft,
} from "@/types/services";

const defaultStages: UpgradePlanDraft["stages"] = UPGRADE_STAGE_NAMES.map((name, index) => {
  const dates = [
    ["2026-09-01", "2026-09-10"],
    ["2026-09-11", "2026-09-20"],
    ["2026-09-21", "2026-09-30"],
    ["2026-10-01", "2026-10-15"],
    ["2026-10-16", "2026-11-30"],
    ["2026-12-01", "2026-12-15"],
  ][index]!;
  return {
    id: `draft-stage-${index + 1}`,
    code: UPGRADE_STAGE_CODES[index]!,
    name,
    status: "not_started",
    plannedStart: dates[0],
    plannedEnd: dates[1],
    owner:
      index === 0
        ? "张教员"
        : index === 1
          ? "中队评估委员会"
          : index === 2
            ? "大队评估委员会"
            : index === 3
              ? "林教员（模拟机）"
              : index === 4
                ? "顾教员（航线）"
                : "总飞行师",
    notes: index === 5 ? "待航线检查完成后安排" : "",
  };
});

const defaults: UpgradePlanDraft = {
  pilotId: "pilot-demo-05",
  title: "机长升级计划",
  type: "captain_upgrade",
  startDate: "2026-09-01",
  endDate: "2026-12-31",
  overallOwner: "中队评估委员会",
  leadDepartment: "一大队一中队升级评估委员会",
  stages: defaultStages,
  inspectionItemSelections: [],
  supplementalRequirements: ["应急生存特情训练（补充要求）"],
};

type WizardStep = "basic" | "stages" | "confirm";

export function UpgradePlanForm({ planId }: { planId?: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const state = useAdminState();
  const { upgradePlans } = useApplicationServices();
  const rawStep = params.get("step");
  const step: WizardStep = rawStep === "stages" || rawStep === "confirm" ? rawStep : "basic";
  const [hydrated, setHydrated] = React.useState(false);
  const [serviceError, setServiceError] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [inspectionItems, setInspectionItems] = React.useState<InspectionItem[]>([]);
  const [existingVersion, setExistingVersion] = React.useState<number | null>(null);
  const {
    register,
    reset,
    setValue,
    getValues,
    watch,
    trigger,
    formState: { errors },
  } = useForm<UpgradePlanDraft>({
    resolver: zodResolver(upgradePlanDraftSchema),
    defaultValues: defaults,
  });
  React.useEffect(() => {
    let active = true;
    const key = planId ?? "new";
    const draft = upgradePlanDraftRepository.get(key);
    if (draft) {
      reset(draft);
      setHydrated(true);
      return () => {
        active = false;
      };
    }
    if (!planId) {
      reset(defaults);
      setHydrated(true);
      return () => {
        active = false;
      };
    }
    void upgradePlans.getById(planId).then((result) => {
      if (!active) return;
      if (!result.data) {
        setServiceError(t("upgradeForm.notFound"));
        setHydrated(true);
        return;
      }
      const plan = result.data;
      setExistingVersion(plan.version ?? 1);
      reset({
        pilotId: plan.pilotId,
        title: plan.title,
        type: plan.type,
        startDate: plan.startDate,
        endDate: plan.endDate,
        overallOwner: plan.overallOwner,
        leadDepartment: plan.leadDepartment,
        stages: plan.stages,
        supplementalRequirements: plan.supplementalRequirements,
        inspectionItemSelections: plan.inspectionItems.map((item) => ({
          inspectionItemId: item.inspectionItemId,
          stageOrder: item.stageOrder,
        })),
      });
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, [planId, reset, t, upgradePlans]);
  React.useEffect(() => {
    let active = true;
    void upgradePlans.listInspectionItems().then((result) => {
      if (!active) return;
      setInspectionItems(result.data);
      if (hydrated && !getValues("inspectionItemSelections").length && result.data[0]) {
        setValue(
          "inspectionItemSelections",
          [{ inspectionItemId: result.data[0].id, stageOrder: 0 }],
          { shouldValidate: true },
        );
      }
    });
    return () => {
      active = false;
    };
  }, [getValues, hydrated, setValue, upgradePlans]);
  React.useEffect(() => {
    if (!hydrated || !state.pilots.length) return;
    const currentPilotId = getValues("pilotId");
    if (!state.pilots.some((pilot) => pilot.id === currentPilotId)) {
      setValue("pilotId", state.pilots[0]!.id, { shouldValidate: true });
    }
  }, [getValues, hydrated, setValue, state.pilots]);
  React.useEffect(() => {
    if (!rawStep || ["basic", "stages", "confirm"].includes(rawStep)) return;
    const next = new URLSearchParams(params.toString());
    next.delete("step");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
  }, [params, pathname, rawStep, router]);
  React.useEffect(() => {
    if (!hydrated) return;
    const subscription = watch((value) =>
      upgradePlanDraftRepository.set(planId ?? "new", value as UpgradePlanDraft),
    );
    return () => subscription.unsubscribe();
  }, [hydrated, planId, watch]);
  const values = watch();
  const pilot = state.pilots.find((item) => item.id === values.pilotId);
  const conflict = state.upgradePlans.find(
    (plan) =>
      plan.pilotId === values.pilotId &&
      plan.id !== planId &&
      ["active", "paused", "not_started"].includes(plan.lifecycleStatus),
  );
  const setStep = (nextStep: WizardStep) => {
    const next = new URLSearchParams(params.toString());
    if (nextStep === "basic") next.delete("step");
    else next.set("step", nextStep);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
  };
  const nextStep = async (next: WizardStep) => {
    setServiceError("");
    const valid =
      next === "stages"
        ? await trigger([
            "pilotId",
            "title",
            "type",
            "startDate",
            "endDate",
            "overallOwner",
            "leadDepartment",
          ])
        : await trigger();
    if (valid) setStep(next);
  };
  const create = async (mode: "draft" | "start") => {
    const valid = await trigger();
    if (!valid || submitting) return;
    setSubmitting(true);
    setServiceError("");
    try {
      const response = planId
        ? await upgradePlans.update(planId, {
            ...getValues(),
            expectedVersion: existingVersion ?? 0,
          })
        : mode === "draft"
          ? await upgradePlans.saveDraft(getValues())
          : await upgradePlans.createAndStart(getValues());
      upgradePlanDraftRepository.remove(planId ?? "new");
      setConfirmOpen(false);
      router.push(`/admin/upgrade-plans/${response.data.id}`);
    } catch (reason) {
      setServiceError(localizeError(reason, t, "upgradeForm.createError"));
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };
  if (!hydrated) {
    return (
      <PageContainer>
        <Skeleton className="h-96" />
      </PageContainer>
    );
  }
  return (
    <PageContainer className="space-y-5 pb-40 lg:pb-6">
      <AdminPageHeader
        title={planId ? t("upgradeForm.editTitle") : t("upgradeForm.newTitle")}
        description={t("upgradeForm.description")}
      />
      <WizardHeader step={step} />
      {serviceError ? <Alert tone="danger">{serviceError}</Alert> : null}
      {conflict ? (
        <Alert tone="warning">{t("upgradeForm.conflict", { plan: conflict.planNumber })}</Alert>
      ) : null}
      <section className={step === "basic" ? "block" : "hidden lg:block"}>
        <Card className="p-4 shadow-none">
          <h3 className="text-base font-bold">{t("upgradeForm.basicSection")}</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Select
              label={t("upgradeForm.pilot")}
              required
              options={state.pilots.map((item) => ({
                value: item.id,
                label: `${item.displayName}（${item.employeeNumber}）`,
              }))}
              error={errors.pilotId?.message}
              {...register("pilotId")}
            />
            <Input
              label={t("upgradeForm.planName")}
              required
              helperText={t("upgradeForm.planNameHelp")}
              error={errors.title?.message}
              {...register("title")}
            />
            <Select
              label={t("upgradeForm.planType")}
              required
              options={Object.keys(upgradeTypeLabels).map((value) => ({
                value,
                label: t(`upgradePlans.type.${value}`),
              }))}
              error={errors.type?.message}
              {...register("type")}
            />
            <DateField
              label={t("upgradeForm.expectedStart")}
              required
              error={errors.startDate?.message}
              {...register("startDate")}
            />
            <DateField
              label={t("upgradeForm.expectedEnd")}
              required
              error={errors.endDate?.message}
              {...register("endDate")}
            />
            <Input
              label={t("upgradeForm.owner")}
              required
              error={errors.overallOwner?.message}
              {...register("overallOwner")}
            />
            <Input
              label={t("upgradeForm.department")}
              required
              error={errors.leadDepartment?.message}
              {...register("leadDepartment")}
              className="xl:col-span-2"
            />
          </div>
        </Card>
      </section>
      <section className={step === "stages" ? "block" : "hidden lg:block"}>
        <Card className="mb-4 p-4 shadow-none">
          <h3 className="text-base font-bold">{t("upgradeForm.inspection")}</h3>
          <p className="mt-1 text-xs text-muted">{t("upgradeForm.inspectionDescription")}</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {inspectionItems.map((item) => {
              const selection = values.inspectionItemSelections?.find(
                (selected) => selected.inspectionItemId === item.id,
              );
              return (
                <div key={item.id} className="rounded-lg border border-border p-3">
                  <label className="flex items-start gap-3 text-sm font-semibold">
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={Boolean(selection)}
                      onChange={(event) => {
                        const current = getValues("inspectionItemSelections");
                        setValue(
                          "inspectionItemSelections",
                          event.target.checked
                            ? [...current, { inspectionItemId: item.id, stageOrder: 0 }]
                            : current.filter((selected) => selected.inspectionItemId !== item.id),
                          { shouldValidate: true, shouldDirty: true },
                        );
                      }}
                    />
                    <span>
                      {item.name}
                      <span className="mt-1 block text-xs font-normal text-muted">
                        {item.description || `${t("common.ruleVersion")} v${item.ruleVersion}`}
                      </span>
                    </span>
                  </label>
                  {selection ? (
                    <Select
                      className="mt-3"
                      label={t("upgradeForm.stageAssignment")}
                      value={String(selection.stageOrder)}
                      options={UPGRADE_STAGE_CODES.map((code, index) => ({
                        value: String(index),
                        label: `${index + 1}. ${t(`upgrade.stage.${code}`)}`,
                      }))}
                      onChange={(event) =>
                        setValue(
                          "inspectionItemSelections",
                          getValues("inspectionItemSelections").map((selected) =>
                            selected.inspectionItemId === item.id
                              ? { ...selected, stageOrder: Number(event.target.value) }
                              : selected,
                          ),
                          { shouldValidate: true, shouldDirty: true },
                        )
                      }
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          {errors.inspectionItemSelections?.message ? (
            <p className="mt-2 text-xs text-danger">{errors.inspectionItemSelections.message}</p>
          ) : null}
        </Card>
        <Card className="p-4 shadow-none">
          <div>
            <h3 className="text-base font-bold">{t("upgradeForm.stageSection")}</h3>
            <p className="mt-1 text-xs text-muted">{t("upgradeForm.stageDescription")}</p>
          </div>
          <div className="mt-4 space-y-3">
            {UPGRADE_STAGE_CODES.map((code, index) => (
              <div key={code} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-bold">
                    <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-blue-50 text-xs text-brand">
                      {index + 1}
                    </span>
                    {t(`upgrade.stage.${code}`)}
                  </h4>
                  <Badge tone="info">{t("upgradeForm.standardStage")}</Badge>
                </div>
                <input type="hidden" {...register(`stages.${index}.id`)} />
                <input type="hidden" {...register(`stages.${index}.code`)} />
                <input type="hidden" {...register(`stages.${index}.name`)} />
                <input type="hidden" {...register(`stages.${index}.status`)} />
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <DateField
                    label={t("upgradeForm.plannedStart")}
                    required
                    error={errors.stages?.[index]?.plannedStart?.message}
                    {...register(`stages.${index}.plannedStart`)}
                  />
                  <DateField
                    label={t("upgradeForm.plannedEnd")}
                    required
                    error={errors.stages?.[index]?.plannedEnd?.message}
                    {...register(`stages.${index}.plannedEnd`)}
                  />
                  <Input
                    label={t("upgradeForm.stageOwner")}
                    required
                    error={errors.stages?.[index]?.owner?.message}
                    {...register(`stages.${index}.owner`)}
                    className="xl:col-span-1"
                  />
                  <Textarea
                    label={t("upgradeForm.notes")}
                    error={errors.stages?.[index]?.notes?.message}
                    {...register(`stages.${index}.notes`)}
                    className="min-h-11 xl:col-span-2"
                  />
                </div>
              </div>
            ))}
          </div>
          <Alert tone="info" className="mt-4">
            {t("upgradeForm.startNotice")}
          </Alert>
        </Card>
      </section>
      <section className={step === "confirm" ? "block" : "hidden lg:block"}>
        <Card className="p-4 shadow-none">
          <h3 className="text-base font-bold">{t("upgradeForm.confirmSection")}</h3>
          <div className="mt-4 grid gap-5 xl:grid-cols-2">
            <dl className="grid grid-cols-[100px_1fr] gap-3 text-sm">
              <dt className="text-muted">{t("upgradeForm.pendingPilot")}</dt>
              <dd className="font-semibold">
                {pilot?.displayName}（{pilot?.employeeNumber}）
              </dd>
              <dt className="text-muted">{t("upgradeForm.planName")}</dt>
              <dd className="font-semibold">{values.title}</dd>
              <dt className="text-muted">{t("upgradeForm.planType")}</dt>
              <dd>{values.type ? t(`upgradePlans.type.${values.type}`) : "—"}</dd>
              <dt className="text-muted">{t("upgradeForm.expectedDates")}</dt>
              <dd>
                {values.startDate} {t("common.to")} {values.endDate}
              </dd>
              <dt className="text-muted">{t("upgradeForm.assessmentOwner")}</dt>
              <dd>{values.overallOwner}</dd>
              <dt className="text-muted">{t("upgradeForm.inspection")}</dt>
              <dd>
                {values.inspectionItemSelections
                  ?.map(
                    (selection) =>
                      inspectionItems.find((item) => item.id === selection.inspectionItemId)?.name,
                  )
                  .filter(Boolean)
                  .join(locale === "zh-CN" ? "、" : ", ") || t("upgradeForm.notSelected")}
              </dd>
            </dl>
            <ol className="divide-y divide-border">
              {values.stages?.map((stage, index) => (
                <li key={stage.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <div>
                    <p className="font-bold">
                      {index + 1}. {t(`upgrade.stage.${stage.code}`)}
                    </p>
                    <p className="mt-1 text-muted">
                      {t("upgradeForm.stageOwnerSummary", { owner: stage.owner })}
                    </p>
                  </div>
                  <span className="text-brand">
                    {stage.plannedStart} {t("common.to")} {stage.plannedEnd}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </Card>
      </section>
      <div className="hidden items-center justify-between gap-3 lg:flex">
        <Link
          href="/admin/upgrade-plans"
          className="inline-flex min-h-11 items-center font-semibold text-secondary"
        >
          {t("upgradeForm.backList")}
        </Link>
        <div className="flex gap-2">
          {planId ? (
            <Button loading={submitting} onClick={() => void create("draft")}>
              {t("upgradeForm.saveChanges")}
            </Button>
          ) : (
            <>
              <Button variant="secondary" loading={submitting} onClick={() => void create("draft")}>
                {t("upgradeForm.saveDraftOnly")}
              </Button>
              <Button disabled={Boolean(conflict)} onClick={() => setConfirmOpen(true)}>
                {t("upgradeForm.createAndNotify")}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-[61px] z-20 flex gap-3 border-t border-border bg-card p-3 pb-safe-bottom lg:hidden">
        {step !== "basic" ? (
          <Button
            className="flex-1"
            variant="secondary"
            onClick={() => setStep(step === "confirm" ? "stages" : "basic")}
          >
            {t("upgradeForm.previous")}
          </Button>
        ) : null}
        {step === "basic" ? (
          <Button className="flex-1" onClick={() => void nextStep("stages")}>
            {t("upgradeForm.nextStages")}
          </Button>
        ) : step === "stages" ? (
          <Button className="flex-1" onClick={() => void nextStep("confirm")}>
            {t("upgradeForm.nextConfirm")}
          </Button>
        ) : (
          <>
            <Button
              className="flex-1"
              variant="secondary"
              loading={submitting}
              onClick={() => void create("draft")}
            >
              {t("upgradeForm.saveDraft")}
            </Button>
            <Button
              className="flex-1"
              disabled={Boolean(conflict)}
              onClick={() => setConfirmOpen(true)}
            >
              {t("upgradeForm.confirmCreate")}
            </Button>
          </>
        )}
      </div>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogTitle className="text-lg font-bold">{t("upgradeForm.finalConfirm")}</DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-6 text-muted">
            {t("upgradeForm.finalDescription")}
          </DialogDescription>
          {serviceError ? (
            <Alert tone="danger" className="mt-4">
              {serviceError}
            </Alert>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              {t("upgradeForm.backCheck")}
            </Button>
            <Button loading={submitting} onClick={() => void create("start")}>
              {t("upgradeForm.confirmStart")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function WizardHeader({ step }: { step: WizardStep }) {
  const { t } = useI18n();
  const steps: Array<[WizardStep, string]> = [
    ["basic", t("upgradeForm.step.basic")],
    ["stages", t("upgradeForm.step.stages")],
    ["confirm", t("upgradeForm.step.confirm")],
  ];
  const active = steps.findIndex(([value]) => value === step);
  return (
    <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-card p-3 lg:mb-1">
      {steps.map(([value, label], index) => (
        <div
          key={value}
          className={`flex items-center gap-2 text-xs font-semibold ${index === active ? "text-brand" : index < active ? "text-success" : "text-muted"}`}
        >
          <span
            className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full ${index === active ? "bg-brand text-white" : index < active ? "bg-emerald-50" : "bg-slate-200"}`}
          >
            {index + 1}
          </span>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
