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
import { useI18n } from "@/components/i18n-provider";
import { localizeError } from "@/lib/error-i18n";

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
  if (!response.ok || !body.data) throw new Error(body.error?.message ?? "");
  return body.data;
}

export function PilotNotificationsView({ portal = "pilot" }: { portal?: "pilot" | "member" }) {
  const portalPath = portal === "member" ? "/member" : "/pilot";
  const [data, setData] = React.useState<InboxResponse | null>(null);
  const [error, setError] = React.useState("");
  const [marking, setMarking] = React.useState("");
  const { locale, t } = useI18n();

  const load = React.useCallback(async () => {
    setError("");
    try {
      setData(
        await readJson<InboxResponse>(
          `/api/${portal === "member" ? "member" : "pilot"}/notifications?pageSize=100`,
        ),
      );
    } catch (reason) {
      setError(localizeError(reason, t, "notifications.loadFailed"));
    }
  }, [portal, t]);

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
      setError(localizeError(reason, t, "notifications.markReadFailed"));
    } finally {
      setMarking("");
    }
  };

  return (
    <PilotShell
      title={t("notifications.title")}
      showBack
      portal={portal}
      variant="page"
      className="space-y-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-primary">{t("notifications.title")}</h1>
          <p className="mt-1 text-xs text-secondary">
            {t("notifications.unread", { count: data?.unreadCount ?? 0 })}
          </p>
        </div>
        <Link
          href={`${portalPath}/qualifications`}
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
        >
          {t("notifications.myQualifications")}
        </Link>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!data && !error ? (
        <div aria-label={t("notifications.loading")} className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : null}
      {data && !data.items.length ? (
        <EmptyState
          title={t("notifications.empty")}
          description={t("notifications.emptyDescription")}
        />
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
                <span
                  className="mt-1 size-2 shrink-0 rounded-full bg-brand"
                  aria-label={t("notifications.unreadLabel")}
                />
              ) : null}
            </div>
            <p className="text-sm leading-6 text-secondary">{item.message}</p>
            <div className="flex items-center justify-between gap-3">
              <time className="text-[11px] text-muted" dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString(locale)}
              </time>
              {!item.readAt ? (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={marking === item.id}
                  onClick={() => void markRead(item.id)}
                >
                  <Check aria-hidden="true" className="size-4" />
                  {t("notifications.markRead")}
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </PilotShell>
  );
}
