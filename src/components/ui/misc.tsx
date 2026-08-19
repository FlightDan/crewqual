import * as React from "react";
import { FileUp, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n-provider";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded bg-slate-200", className)} />;
}

export function Avatar({
  initials,
  label,
  className,
}: {
  initials: string;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-brand",
        className,
      )}
      aria-label={label}
    >
      {initials}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px w-full bg-border", className)} />;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-6 text-center">
      <Inbox aria-hidden="true" className="size-8 text-muted" />
      <h3 className="mt-3 text-sm font-semibold text-primary">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-xs text-secondary">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function FileUpload({ label, helperText }: { label?: string; helperText?: string }) {
  const { t } = useI18n();
  const resolvedLabel = label ?? t("common.uploadFile");
  const resolvedHelperText = helperText ?? t("common.uploadHelper");
  return (
    <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-brand bg-blue-50/40 px-4 text-center transition hover:bg-blue-50">
      <FileUp aria-hidden="true" className="size-7 text-brand" />
      <span className="mt-2 text-sm font-semibold text-brand">{resolvedLabel}</span>
      <span className="mt-1 text-xs text-muted">{resolvedHelperText}</span>
      <input type="file" className="sr-only" />
    </label>
  );
}
