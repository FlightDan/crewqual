"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "@/types/admin-settings";

export type SettingsFeedback = (
  tone: "info" | "success" | "warning" | "danger",
  title: string,
  description?: string,
) => void;

export function formatSettingsDate(value: string | null) {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const config = {
    connected: { tone: "success" as const, label: "正常" },
    error: { tone: "danger" as const, label: "异常" },
    unconfigured: { tone: "neutral" as const, label: "未配置" },
  }[status];
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

export function SettingsSectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-primary">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-secondary">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function SettingsEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-slate-50 p-8 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]" aria-label="正在加载系统设置">
      <div className="h-72 animate-pulse rounded-lg bg-slate-200" />
      <div className="space-y-4">
        <div className="h-20 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-64 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-48 animate-pulse rounded-lg bg-slate-200" />
      </div>
    </div>
  );
}

export function FieldGrid({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid gap-4 md:grid-cols-2", className)}>{children}</div>;
}
