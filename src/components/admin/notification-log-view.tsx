"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { DashboardStatCard } from "@/components/admin/dashboard-stat-card";
import { Pagination } from "@/components/admin/pagination";
import { PageContainer } from "@/components/layout/page-container";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { DateField, Input } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { channelLabels, deliveryLabels, notificationTypeLabels } from "@/lib/admin-labels";
import { validIsoDate } from "@/lib/calendar-utils";
import { isRemoteServiceMode } from "@/lib/service-mode";
import { useAdminState } from "@/services/admin-state-provider";
import { useApplicationServices } from "@/services/application-services-provider";
import type {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationLog,
  NotificationSummary,
  NotificationType,
  PaginatedResult,
} from "@/types/services";
import { useAdminSession } from "@/services/admin-session-provider";
import { useI18n } from "@/components/i18n-provider";

function tone(status: NotificationDeliveryStatus) {
  return status === "sent"
    ? ("success" as const)
    : status === "failed"
      ? ("danger" as const)
      : ("warning" as const);
}

function useMobile() {
  const [mobile, setMobile] = React.useState(false);
  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function NotificationLogView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const state = useAdminState();
  const mobile = useMobile();
  const { notifications } = useApplicationServices();
  const { hasPermission } = useAdminSession();
  const { t } = useI18n();
  const typeLabel = (value: string) => t(`notification.type.${value}`);
  const channelLabel = (value: string) => t(`notification.channel.${value}`);
  const deliveryLabel = (value: string) => t(`notification.delivery.${value}`);
  const canRetry = hasPermission("notifications.retry");
  const mockMode =
    process.env.NEXT_PUBLIC_SERVICE_MODE !== "remote" && process.env.NODE_ENV !== "production";
  const [summary, setSummary] = React.useState<NotificationSummary | null>(null);
  const [result, setResult] = React.useState<PaginatedResult<NotificationLog> | null>(null);
  const [selected, setSelected] = React.useState<NotificationLog | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const q = params.get("q") ?? "";
  const rawType = params.get("type");
  const type = rawType && rawType in notificationTypeLabels ? rawType : "all";
  const rawChannel = params.get("channel");
  const channel = rawChannel && rawChannel in channelLabels ? rawChannel : "all";
  const rawStatus = params.get("status");
  const status = rawStatus && rawStatus in deliveryLabels ? rawStatus : "all";
  const rawFrom = params.get("from");
  const rawTo = params.get("to");
  const from = rawFrom && validIsoDate(rawFrom, "") === rawFrom ? rawFrom : "";
  const to = rawTo && validIsoDate(rawTo, "") === rawTo ? rawTo : "";
  const rawPage = Number(params.get("page") ?? "1");
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const selectedId = params.get("notification");
  const update = React.useCallback(
    (values: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      Object.entries(values).forEach(([key, value]) => {
        if (!value || value === "all" || (key === "page" && value === "1")) next.delete(key);
        else next.set(key, value);
      });
      if (!("page" in values) && !("notification" in values)) next.delete("page");
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
    },
    [params, pathname, router],
  );
  React.useEffect(() => {
    let active = true;
    void Promise.all([
      notifications.getSummary(),
      notifications.list({
        q,
        type: type as "all" | NotificationType,
        channel: channel as "all" | NotificationChannel,
        status: status as "all" | NotificationDeliveryStatus,
        from: from || undefined,
        to: to || undefined,
        page,
        pageSize: 7,
      }),
    ])
      .then(([summaryResponse, listResponse]) => {
        if (active) {
          setSummary(summaryResponse.data);
          setResult(listResponse.data);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : t("common.systemError"));
      });
    return () => {
      active = false;
    };
  }, [channel, from, notifications, page, q, state, status, t, to, type]);
  React.useEffect(() => {
    let active = true;
    if (!selectedId) {
      setSelected(null);
      return;
    }
    void notifications
      .getById(selectedId)
      .then((response) => {
        if (!active) return;
        setSelected(response.data);
        if (!response.data) update({ notification: null });
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : t("common.systemError"));
      });
    return () => {
      active = false;
    };
  }, [notifications, selectedId, state, t, update]);
  const retry = async () => {
    if (!selected || loading) return;
    setLoading(true);
    setError("");
    try {
      await notifications.retry(selected.id, selected.version);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("common.systemError"));
    } finally {
      setLoading(false);
    }
  };
  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader
        title={t("notification.title")}
        description={t("notification.description")}
      />
      <Alert tone="info">{t("notification.sentInfo")}</Alert>
      {!summary ? (
        <Skeleton className="h-28" />
      ) : (
        <section className="grid grid-cols-3 gap-3">
          <DashboardStatCard
            label={t("notification.sentToday")}
            value={summary.sentToday}
            note={mockMode ? t("notification.mockDemo") : t("notification.databaseLive")}
            tone="success"
          />
          <DashboardStatCard
            label={t("notification.failedToday")}
            value={summary.failedToday}
            note={mockMode ? t("notification.mockRetry") : t("notification.versionRetry")}
            tone="danger"
          />
          <DashboardStatCard
            label={t("notification.queued")}
            value={summary.queued}
            note={t("notification.derivedReminder")}
            tone="warning"
          />
        </section>
      )}
      <Card className="grid gap-3 p-3 shadow-none md:grid-cols-2 xl:grid-cols-6">
        <Input
          label={t("notification.search")}
          placeholder={t("notification.searchPlaceholder")}
          value={q}
          onChange={(event) => update({ q: event.target.value })}
        />
        <Select
          label={t("notification.type")}
          value={type}
          options={[
            { label: t("notification.allTypes"), value: "all" },
            ...Object.keys(notificationTypeLabels).map((value) => ({
              value,
              label: typeLabel(value),
            })),
          ]}
          onChange={(event) => update({ type: event.target.value })}
        />
        <Select
          label={t("notification.channel")}
          value={channel}
          options={[
            { label: t("notification.allChannels"), value: "all" },
            ...Object.keys(channelLabels).map((value) => ({ value, label: channelLabel(value) })),
          ]}
          onChange={(event) => update({ channel: event.target.value })}
        />
        <Select
          label={t("notification.status")}
          value={status}
          options={[
            { label: t("notification.allStatuses"), value: "all" },
            ...Object.keys(deliveryLabels).map((value) => ({ value, label: deliveryLabel(value) })),
          ]}
          onChange={(event) => update({ status: event.target.value })}
        />
        <DateField
          label={t("notification.from")}
          value={from}
          onChange={(event) => update({ from: event.target.value })}
        />
        <DateField
          label={t("notification.to")}
          value={to}
          onChange={(event) => update({ to: event.target.value })}
        />
      </Card>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!result ? (
        <Skeleton className="h-96" />
      ) : !result.items.length ? (
        <EmptyState
          title={t("notification.noLogs")}
          description={t("notification.adjustFilters")}
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-card lg:block">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-secondary">
                <tr>
                  {[
                    t("notification.createdSentAt"),
                    t("notification.type"),
                    t("notification.channel"),
                    t("notification.targetPerson"),
                    t("notification.summary"),
                    t("notification.status"),
                    t("notification.actions"),
                  ].map((heading) => (
                    <th key={heading} scope="col" className="px-3 py-3 font-semibold">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.items.map((log) => (
                  <tr key={log.id} className="border-t border-border">
                    <td className="px-3 py-3 text-xs">{log.sentAt ?? log.createdAt}</td>
                    <td className="px-3 py-3 font-semibold">{typeLabel(log.type)}</td>
                    <td className="px-3 py-3">
                      <Badge tone="info">{channelLabel(log.channel)}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      {log.pilotName}
                      <span className="block text-[11px] text-muted">{log.employeeNumber}</span>
                    </td>
                    <td className="max-w-md truncate px-3 py-3 text-secondary">{log.summary}</td>
                    <td className="px-3 py-3">
                      <Badge tone={tone(log.status)}>{deliveryLabel(log.status)}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => update({ notification: log.id })}
                        className="font-semibold text-brand"
                      >
                        {t("notification.details")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 lg:hidden">
            {result.items.map((log) => (
              <button
                type="button"
                key={log.id}
                onClick={() => update({ notification: log.id })}
                className="w-full rounded-xl border border-border bg-card p-4 text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs text-muted">{log.sentAt ?? log.createdAt}</span>
                  <Badge tone={tone(log.status)}>{deliveryLabel(log.status)}</Badge>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <p className="font-bold">{log.pilotName}</p>
                  <Badge tone="info">{typeLabel(log.type)}</Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-secondary">{log.summary}</p>
                <p className="mt-2 text-[11px] text-muted">{channelLabel(log.channel)}</p>
              </button>
            ))}
          </div>
          <Pagination
            page={result.page}
            total={result.total}
            totalPages={result.totalPages}
            onPageChange={(next) => update({ page: String(next) })}
          />
        </>
      )}
      {!mobile ? (
        <Dialog
          open={Boolean(selected)}
          onOpenChange={(open) => !open && update({ notification: null })}
        >
          <DialogContent className="max-w-2xl">
            <DialogTitle className="text-lg font-bold">
              {t("notification.detailsTitle")}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted">
              {t("notification.detailsDescription")}
            </DialogDescription>
            {selected ? (
              <NotificationDetail
                log={selected}
                error={error}
                loading={loading}
                onRetry={() => void retry()}
                canRetry={canRetry}
              />
            ) : null}
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer
          open={Boolean(selected)}
          onOpenChange={(open) => !open && update({ notification: null })}
        >
          <DrawerContent
            side="right"
            className="w-[min(24rem,calc(100vw-1rem))] overflow-y-auto p-4"
          >
            <DrawerTitle className="text-base font-bold">
              {t("notification.detailsTitle")}
            </DrawerTitle>
            <DrawerDescription className="mt-1 text-xs text-muted">
              {t("notification.detailsShort")}
            </DrawerDescription>
            {selected ? (
              <NotificationDetail
                log={selected}
                error={error}
                loading={loading}
                onRetry={() => void retry()}
                canRetry={canRetry}
              />
            ) : null}
          </DrawerContent>
        </Drawer>
      )}
    </PageContainer>
  );
}

function NotificationDetail({
  log,
  error,
  loading,
  onRetry,
  canRetry,
}: {
  log: NotificationLog;
  error: string;
  loading: boolean;
  onRetry: () => void;
  canRetry: boolean;
}) {
  const { t } = useI18n();
  const typeLabel = (value: string) => t(`notification.type.${value}`);
  const channelLabel = (value: string) => t(`notification.channel.${value}`);
  const deliveryLabel = (value: string) => t(`notification.delivery.${value}`);
  return (
    <div className="mt-5 space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Badge tone="info">{typeLabel(log.type)}</Badge>
        <Badge tone={tone(log.status)}>{deliveryLabel(log.status)}</Badge>
        <Badge tone="neutral">{channelLabel(log.channel)}</Badge>
      </div>
      <dl className="grid grid-cols-[88px_1fr] gap-3 text-sm">
        <dt className="text-muted">{t("notification.target")}</dt>
        <dd>{log.target}</dd>
        <dt className="text-muted">{t("notification.createdAt")}</dt>
        <dd>{log.createdAt}</dd>
        <dt className="text-muted">{t("notification.sentAt")}</dt>
        <dd>{log.sentAt ?? t("notification.notSent")}</dd>
        <dt className="text-muted">{t("notification.summary")}</dt>
        <dd className="font-semibold">{log.summary}</dd>
      </dl>
      <div className="rounded-md bg-slate-50 p-3 text-sm leading-6">{log.message}</div>
      <div>
        <h4 className="text-sm font-bold">
          {t("notification.attemptHistory", { count: log.attempts.length })}
        </h4>
        {log.attempts.length ? (
          <ol className="mt-2 space-y-2">
            {log.attempts.map((attempt) => (
              <li key={attempt.id} className="border-l-2 border-blue-100 pl-3 text-xs">
                <p className="font-semibold">{deliveryLabel(attempt.status)}</p>
                <p className="mt-1 text-muted">
                  {attempt.attemptedAt} · {attempt.detail}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-xs text-muted">{t("notification.noAttempts")}</p>
        )}
      </div>
      {log.status === "failed" && canRetry ? (
        <Button loading={loading} onClick={onRetry}>
          <RotateCcw className="size-4" />
          {isRemoteServiceMode() ? t("notification.resend") : t("notification.mockResend")}
        </Button>
      ) : null}
    </div>
  );
}
