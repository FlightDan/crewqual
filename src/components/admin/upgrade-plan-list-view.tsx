"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Pagination } from "@/components/admin/pagination";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateField, Input } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { lifecycleLabels, upgradeTypeLabels } from "@/lib/admin-labels";
import { validIsoDate } from "@/lib/calendar-utils";
import { cn } from "@/lib/utils";
import { useAdminState } from "@/services/admin-state-provider";
import { useApplicationServices } from "@/services/application-services-provider";
import type {
  PaginatedResult,
  UpgradePlanLifecycleStatus,
  UpgradePlanRecord,
  UpgradePlanType,
} from "@/types/services";
import { useAdminSession } from "@/services/admin-session-provider";
import { useI18n } from "@/components/i18n-provider";

function statusTone(status: UpgradePlanLifecycleStatus) {
  if (status === "completed") return "success" as const;
  if (status === "cancelled") return "danger" as const;
  if (status === "paused") return "warning" as const;
  if (status === "active") return "info" as const;
  return "neutral" as const;
}

function progress(plan: UpgradePlanRecord) {
  return Math.round((plan.stages.filter((stage) => stage.status === "completed").length / 6) * 100);
}

export function UpgradePlanListView() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const state = useAdminState();
  const { upgradePlans } = useApplicationServices();
  const { hasPermission } = useAdminSession();
  const { t } = useI18n();
  const canWrite = hasPermission("operations.write");
  const [result, setResult] = React.useState<PaginatedResult<UpgradePlanRecord> | null>(null);
  const q = params.get("q") ?? "";
  const rawType = params.get("type");
  const type = rawType && rawType in upgradeTypeLabels ? rawType : "all";
  const rawStatus = params.get("status");
  const status = rawStatus && rawStatus in lifecycleLabels ? rawStatus : "all";
  const owners = [...new Set(state.upgradePlans.map((plan) => plan.overallOwner))];
  const positions = [
    ...new Set(state.upgradePlans.map((plan) => plan.positionCode ?? "PILOT").filter(Boolean)),
  ];
  const rawPosition = params.get("positions");
  const position = rawPosition ?? "";
  const positionOptions =
    rawPosition && !positions.includes(rawPosition) ? [rawPosition, ...positions] : positions;
  const rawOwner = params.get("owner");
  const owner = rawOwner && owners.includes(rawOwner) ? rawOwner : "";
  const rawFrom = params.get("from");
  const rawTo = params.get("to");
  const from = rawFrom && validIsoDate(rawFrom, "") === rawFrom ? rawFrom : "";
  const to = rawTo && validIsoDate(rawTo, "") === rawTo ? rawTo : "";
  const rawPage = Number(params.get("page") ?? "1");
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const update = (values: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    Object.entries(values).forEach(([key, value]) => {
      if (!value || value === "all" || (key === "page" && value === "1")) next.delete(key);
      else next.set(key, value);
    });
    if (!("page" in values)) next.delete("page");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
  };
  React.useEffect(() => {
    let active = true;
    void upgradePlans
      .list({
        q,
        type: type as "all" | UpgradePlanType,
        status: status as "all" | UpgradePlanLifecycleStatus,
        owner: owner || undefined,
        positions: position || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        pageSize: 6,
      })
      .then((response) => {
        if (active) setResult(response.data);
      });
    return () => {
      active = false;
    };
  }, [from, owner, page, position, q, state, status, to, type, upgradePlans]);
  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader
        title={t("upgradePlans.title")}
        description={t("upgradePlans.description")}
        action={
          canWrite ? (
            <Link
              href="/admin/upgrade-plans/new"
              className={cn(buttonVariants(), "hidden lg:inline-flex")}
            >
              <Plus className="size-4" />
              {t("upgradePlans.new")}
            </Link>
          ) : undefined
        }
      />
      <Card className="grid gap-3 p-3 shadow-none md:grid-cols-2 xl:grid-cols-7">
        <Input
          label={t("upgradePlans.search")}
          placeholder={t("upgradePlans.searchPlaceholder")}
          value={q}
          onChange={(event) => update({ q: event.target.value })}
          className="xl:col-span-2"
        />
        <Select
          label={t("upgradePlans.type")}
          value={type}
          options={[
            { label: t("upgradePlans.allTypes"), value: "all" },
            ...Object.keys(upgradeTypeLabels).map((value) => ({
              value,
              label: t(`upgradePlans.type.${value}`),
            })),
          ]}
          onChange={(event) => update({ type: event.target.value })}
        />
        <Select
          label={t("upgradePlans.position")}
          value={position}
          options={[
            { label: t("upgradePlans.allPositions"), value: "" },
            ...positionOptions.map((value) => ({
              value,
              label: value === "PILOT" ? t("portal.pilot") : value,
            })),
          ]}
          onChange={(event) => update({ positions: event.target.value })}
        />
        <Select
          label={t("upgradePlans.lifecycle")}
          value={status}
          options={[
            { label: t("upgradePlans.allStatuses"), value: "all" },
            ...Object.keys(lifecycleLabels).map((value) => ({
              value,
              label: t(`upgradePlans.lifecycle.${value}`),
            })),
          ]}
          onChange={(event) => update({ status: event.target.value })}
        />
        <Select
          label={t("upgradePlans.owner")}
          value={owner}
          options={[
            { label: t("upgradePlans.allOwners"), value: "" },
            ...owners.map((value) => ({ value, label: value })),
          ]}
          onChange={(event) => update({ owner: event.target.value })}
        />
        <div className="grid grid-cols-2 gap-2">
          <DateField
            label={t("upgradePlans.start")}
            value={from}
            onChange={(event) => update({ from: event.target.value })}
          />
          <DateField
            label={t("upgradePlans.end")}
            value={to}
            onChange={(event) => update({ to: event.target.value })}
          />
        </div>
      </Card>
      {!result ? (
        <Skeleton className="h-96" />
      ) : !result.items.length ? (
        <EmptyState title={t("upgradePlans.empty")} description={t("upgradePlans.adjust")} />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-card lg:block">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-secondary">
                <tr>
                  {[
                    t("upgradePlans.number"),
                    t("upgradePlans.pilot"),
                    t("upgradePlans.position"),
                    t("upgradePlans.planName"),
                    t("upgradePlans.planType"),
                    t("upgradePlans.currentStage"),
                    t("upgradePlans.nextStage"),
                    t("upgradePlans.period"),
                    t("upgradePlans.status"),
                    t("upgradePlans.actions"),
                  ].map((heading) => (
                    <th key={heading} scope="col" className="px-3 py-3 font-semibold">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.items.map((plan) => {
                  const pilot = state.pilots.find((item) => item.id === plan.pilotId);
                  const current =
                    plan.stages.find(
                      (item) => item.status === "in_progress" || item.status === "delayed",
                    ) ?? plan.stages.find((item) => item.status === "scheduled");
                  const currentIndex = current ? plan.stages.indexOf(current) : -1;
                  const next = plan.stages
                    .slice(currentIndex + 1)
                    .find((item) => item.status !== "completed");
                  const hasDelay = plan.stages.some(
                    (item) => item.status === "delayed" || (item.delayDays ?? 0) > 0,
                  );
                  return (
                    <tr key={plan.id} className="border-t border-border">
                      <td className="px-3 py-3 font-semibold">{plan.planNumber}</td>
                      <td className="px-3 py-3">
                        {pilot?.displayName}
                        <span className="block text-[11px] text-muted">
                          {pilot?.employeeNumber}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone="neutral">
                          {plan.positionName ??
                            (plan.positionCode === "PILOT"
                              ? t("portal.pilot")
                              : (plan.positionCode ?? t("portal.pilot")))}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">{plan.title}</td>
                      <td className="px-3 py-3 text-secondary">
                        {t(`upgradePlans.type.${plan.type}`)}
                      </td>
                      <td className="px-3 py-3">{current?.name ?? "—"}</td>
                      <td className="px-3 py-3 text-secondary">{next?.name ?? "—"}</td>
                      <td className="px-3 py-3 text-xs">
                        {plan.startDate}
                        <br />
                        {plan.endDate}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={statusTone(plan.lifecycleStatus)}>
                          {t(`upgradePlans.lifecycle.${plan.lifecycleStatus}`)}
                          {hasDelay && plan.lifecycleStatus === "active"
                            ? `（${t("upgradePlans.delayed")}）`
                            : ""}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          className="font-semibold text-brand"
                          href={`/admin/upgrade-plans/${plan.id}`}
                        >
                          {t("upgradePlans.details")}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 lg:hidden">
            {result.items.map((plan) => {
              const pilot = state.pilots.find((item) => item.id === plan.pilotId);
              const current = plan.stages.find((item) =>
                ["in_progress", "delayed", "scheduled"].includes(item.status),
              );
              const hasDelay = plan.stages.some(
                (item) => item.status === "delayed" || (item.delayDays ?? 0) > 0,
              );
              return (
                <Link
                  key={plan.id}
                  href={`/admin/upgrade-plans/${plan.id}`}
                  className="block rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-muted">
                      {plan.planNumber} · {pilot?.displayName}
                    </p>
                    <div className="flex gap-1">
                      {hasDelay ? <Badge tone="danger">{t("upgradePlans.delayed")}</Badge> : null}
                      <Badge tone={statusTone(plan.lifecycleStatus)}>
                        {t(`upgradePlans.lifecycle.${plan.lifecycleStatus}`)}
                      </Badge>
                    </div>
                  </div>
                  <h3 className="mt-2 text-base font-bold">{plan.title}</h3>
                  <p className="mt-1 text-xs text-secondary">
                    {t("upgradePlans.position")}：
                    {plan.positionName ??
                      (plan.positionCode === "PILOT"
                        ? t("portal.pilot")
                        : (plan.positionCode ?? t("portal.pilot")))}{" "}
                    · {t("upgradePlans.planType")}：{t("upgradePlans.type." + plan.type)}
                  </p>
                  <div className="mt-3 flex justify-between text-xs">
                    <span>
                      {t("upgradePlans.current", { value: current?.name ?? t("pilotDetail.none") })}
                    </span>
                    <span className="text-brand">{progress(plan)}%</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-blue-50">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${progress(plan)}%` }}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
          <Pagination
            page={result.page}
            total={result.total}
            totalPages={result.totalPages}
            onPageChange={(nextPage) => update({ page: String(nextPage) })}
          />
        </>
      )}
      {canWrite ? (
        <Link
          href="/admin/upgrade-plans/new"
          className={cn(buttonVariants(), "fixed bottom-20 right-4 z-10 shadow-popover lg:hidden")}
        >
          <Plus className="size-4" />
          {t("upgradePlans.new")}
        </Link>
      ) : null}
    </PageContainer>
  );
}
