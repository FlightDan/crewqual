import * as React from "react";
import { cn } from "@/lib/utils";

const badgeStyles = {
  neutral: "bg-slate-100 text-secondary",
  success: "bg-emerald-50 text-success",
  warning: "bg-orange-50 text-warning",
  danger: "bg-red-50 text-danger",
  info: "bg-blue-50 text-info",
  purple: "bg-violet-50 text-violet-600",
} as const;

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: keyof typeof badgeStyles;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-1 text-xs font-semibold",
        badgeStyles[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({
  status,
  children,
}: {
  status: keyof typeof badgeStyles;
  children: React.ReactNode;
}) {
  return <Badge tone={status}>{children}</Badge>;
}
