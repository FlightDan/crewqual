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
        if (active) setError(reason instanceof Error ? reason.message : "通知日志加载失败");
      });
    return () => {
      active = false;
    };
  }, [channel, from, notifications, page, q, state, status, to, type]);
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
        if (active) setError(reason instanceof Error ? reason.message : "通知详情加载失败");
      });
    return () => {
      active = false;
    };
  }, [notifications, selectedId, state, update]);
  const retry = async () => {
    if (!selected || loading) return;
    setLoading(true);
    setError("");
    try {
      await notifications.retry(selected.id, selected.version);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "通知重发失败");
    } finally {
      setLoading(false);
    }
  };
  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader
        title="通知与预警记录日志"
        description="记录来自数据库；外部渠道按当前适配器配置发送"
      />
      <Alert tone="info">
        “已发送”表示对应渠道适配器已确认发送；失败和重试过程会保留在审计记录中。
      </Alert>
      {!summary ? (
        <Skeleton className="h-28" />
      ) : (
        <section className="grid grid-cols-3 gap-3">
          <DashboardStatCard
            label="今日已发送"
            value={summary.sentToday}
            note={mockMode ? "Mock 演示" : "数据库实时记录"}
            tone="success"
          />
          <DashboardStatCard
            label="今日失败"
            value={summary.failedToday}
            note={mockMode ? "可 Mock 重发" : "支持按版本重试"}
            tone="danger"
          />
          <DashboardStatCard
            label="待发送队列"
            value={summary.queued}
            note="含规则派生提醒"
            tone="warning"
          />
        </section>
      )}
      <Card className="grid gap-3 p-3 shadow-none md:grid-cols-2 xl:grid-cols-6">
        <Input
          label="搜索"
          placeholder="消息摘要、飞行员或员工号"
          value={q}
          onChange={(event) => update({ q: event.target.value })}
        />
        <Select
          label="通知类型"
          value={type}
          options={[
            { label: "全部类型", value: "all" },
            ...Object.entries(notificationTypeLabels).map(([value, label]) => ({ value, label })),
          ]}
          onChange={(event) => update({ type: event.target.value })}
        />
        <Select
          label="渠道"
          value={channel}
          options={[
            { label: "全部渠道", value: "all" },
            ...Object.entries(channelLabels).map(([value, label]) => ({ value, label })),
          ]}
          onChange={(event) => update({ channel: event.target.value })}
        />
        <Select
          label="状态"
          value={status}
          options={[
            { label: "全部状态", value: "all" },
            ...Object.entries(deliveryLabels).map(([value, label]) => ({ value, label })),
          ]}
          onChange={(event) => update({ status: event.target.value })}
        />
        <DateField
          label="发送起始"
          value={from}
          onChange={(event) => update({ from: event.target.value })}
        />
        <DateField
          label="发送结束"
          value={to}
          onChange={(event) => update({ to: event.target.value })}
        />
      </Card>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!result ? (
        <Skeleton className="h-96" />
      ) : !result.items.length ? (
        <EmptyState title="没有符合条件的通知日志" description="请调整筛选条件。" />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-card lg:block">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-secondary">
                <tr>
                  {[
                    "创建/发送时间",
                    "通知类型",
                    "渠道",
                    "目标人员",
                    "消息摘要",
                    "状态",
                    "操作",
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
                    <td className="px-3 py-3 font-semibold">{notificationTypeLabels[log.type]}</td>
                    <td className="px-3 py-3">
                      <Badge tone="info">{channelLabels[log.channel]}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      {log.pilotName}
                      <span className="block text-[11px] text-muted">{log.employeeNumber}</span>
                    </td>
                    <td className="max-w-md truncate px-3 py-3 text-secondary">{log.summary}</td>
                    <td className="px-3 py-3">
                      <Badge tone={tone(log.status)}>{deliveryLabels[log.status]}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => update({ notification: log.id })}
                        className="font-semibold text-brand"
                      >
                        详情
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
                  <Badge tone={tone(log.status)}>{deliveryLabels[log.status]}</Badge>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <p className="font-bold">{log.pilotName}</p>
                  <Badge tone="info">{notificationTypeLabels[log.type]}</Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-secondary">{log.summary}</p>
                <p className="mt-2 text-[11px] text-muted">{channelLabels[log.channel]}</p>
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
            <DialogTitle className="text-lg font-bold">通知日志详情</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted">
              完整脱敏消息与不可覆盖的尝试历史
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
            <DrawerTitle className="text-base font-bold">通知日志详情</DrawerTitle>
            <DrawerDescription className="mt-1 text-xs text-muted">
              完整详情与尝试历史
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
  return (
    <div className="mt-5 space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Badge tone="info">{notificationTypeLabels[log.type]}</Badge>
        <Badge tone={tone(log.status)}>{deliveryLabels[log.status]}</Badge>
        <Badge tone="neutral">{channelLabels[log.channel]}</Badge>
      </div>
      <dl className="grid grid-cols-[88px_1fr] gap-3 text-sm">
        <dt className="text-muted">目标</dt>
        <dd>{log.target}</dd>
        <dt className="text-muted">创建时间</dt>
        <dd>{log.createdAt}</dd>
        <dt className="text-muted">发送时间</dt>
        <dd>{log.sentAt ?? "尚未发送"}</dd>
        <dt className="text-muted">消息摘要</dt>
        <dd className="font-semibold">{log.summary}</dd>
      </dl>
      <div className="rounded-md bg-slate-50 p-3 text-sm leading-6">{log.message}</div>
      <div>
        <h4 className="text-sm font-bold">尝试历史（{log.attempts.length}）</h4>
        {log.attempts.length ? (
          <ol className="mt-2 space-y-2">
            {log.attempts.map((attempt) => (
              <li key={attempt.id} className="border-l-2 border-blue-100 pl-3 text-xs">
                <p className="font-semibold">{deliveryLabels[attempt.status]}</p>
                <p className="mt-1 text-muted">
                  {attempt.attemptedAt} · {attempt.detail}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-xs text-muted">尚无发送尝试</p>
        )}
      </div>
      {log.status === "failed" && canRetry ? (
        <Button loading={loading} onClick={onRetry}>
          <RotateCcw className="size-4" />
          {isRemoteServiceMode() ? "重新发送" : "Mock 重新发送"}
        </Button>
      ) : null}
    </div>
  );
}
