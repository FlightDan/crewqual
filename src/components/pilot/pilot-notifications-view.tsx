"use client";

import * as React from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { PilotShell } from "@/components/layout/pilot-shell";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import type { PilotNotificationItem } from "@/types/services";

type InboxResponse = {
  items: PilotNotificationItem[];
  total: number;
  unreadCount: number;
};

function csrfToken() {
  const name = "crewqual_pilot_session_csrf=";
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name))
    ?.slice(name.length);
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.method === "PATCH" && csrfToken()
        ? { "x-csrf-token": decodeURIComponent(csrfToken()!) }
        : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json()) as { data?: T; error?: { message?: string } };
  if (!response.ok || !body.data) throw new Error(body.error?.message ?? "通知请求失败");
  return body.data;
}

export function PilotNotificationsView({ portal = "pilot" }: { portal?: "pilot" | "member" }) {
  const portalPath = portal === "member" ? "/member" : "/pilot";
  const [data, setData] = React.useState<InboxResponse | null>(null);
  const [error, setError] = React.useState("");
  const [marking, setMarking] = React.useState("");

  const load = React.useCallback(async () => {
    setError("");
    try {
      setData(
        await readJson<InboxResponse>(
          `/api/${portal === "member" ? "member" : "pilot"}/notifications?pageSize=100`,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "通知加载失败");
    }
  }, [portal]);

  React.useEffect(() => void load(), [load]);

  const markRead = async (id: string) => {
    setMarking(id);
    setError("");
    try {
      await readJson<{ id: string; read: true }>(
        `/api/${portal === "member" ? "member" : "pilot"}/notifications/${id}`,
        {
          method: "PATCH",
          body: "{}",
        },
      );
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "标记已读失败");
    } finally {
      setMarking("");
    }
  };

  return (
    <PilotShell title="消息通知" showBack portal={portal} variant="page" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-primary">消息通知</h1>
          <p className="mt-1 text-xs text-secondary">未读 {data?.unreadCount ?? 0} 条</p>
        </div>
        <Link
          href={`${portalPath}/qualifications`}
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
        >
          我的资质
        </Link>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!data && !error ? (
        <div aria-label="正在加载通知" className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : null}
      {data && !data.items.length ? (
        <EmptyState title="暂无通知" description="审核和资质提醒会显示在这里。" />
      ) : null}
      <div className="space-y-3">
        {data?.items.map((item) => (
          <Card
            key={item.id}
            className={cn(
              "space-y-2 p-4 shadow-none",
              !item.readAt && "border-brand bg-blue-50/40",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-bold text-primary">{item.summary}</h2>
              {!item.readAt ? (
                <span className="mt-1 size-2 shrink-0 rounded-full bg-brand" aria-label="未读" />
              ) : null}
            </div>
            <p className="text-sm leading-6 text-secondary">{item.message}</p>
            <div className="flex items-center justify-between gap-3">
              <time className="text-[11px] text-muted" dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString("zh-CN")}
              </time>
              {!item.readAt ? (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={marking === item.id}
                  onClick={() => void markRead(item.id)}
                >
                  <Check aria-hidden="true" className="size-4" />
                  标记已读
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </PilotShell>
  );
}
