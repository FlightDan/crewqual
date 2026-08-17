"use client";

import * as React from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

const toneConfig = {
  info: { icon: Info, className: "border-blue-200", iconClassName: "text-info" },
  success: { icon: CircleCheck, className: "border-emerald-200", iconClassName: "text-success" },
  warning: { icon: TriangleAlert, className: "border-orange-200", iconClassName: "text-warning" },
  danger: { icon: CircleAlert, className: "border-red-200", iconClassName: "text-danger" },
} as const;

export function Toast({
  open,
  title,
  children,
  onClose,
  tone = "info",
}: {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  onClose: () => void;
  tone?: keyof typeof toneConfig;
}) {
  if (!open) return null;
  const config = toneConfig[tone];
  const Icon = config.icon;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "fixed inset-x-4 bottom-20 z-[var(--z-toast)] flex max-w-sm items-start gap-3 rounded-lg border bg-card p-4 shadow-popover lg:inset-x-auto lg:bottom-5 lg:right-5",
        config.className,
      )}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-5 shrink-0", config.iconClassName)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-primary">{title}</p>
        {children ? <p className="mt-1 text-xs leading-5 text-secondary">{children}</p> : null}
      </div>
      <button
        type="button"
        className="rounded p-1 text-muted hover:bg-slate-100"
        onClick={onClose}
        aria-label="关闭提示"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
