import { cn } from "@/lib/utils";

export function Progress({
  value,
  label,
  className,
}: {
  value: number;
  label?: string;
  className?: string;
}) {
  const safeValue = Math.min(100, Math.max(0, value));
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <div className="flex justify-between text-xs text-secondary">
          <span>{label}</span>
          <span>{safeValue}%</span>
        </div>
      ) : null}
      <div
        className="h-2 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuenow={safeValue}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-brand transition-all"
          style={{ width: `${safeValue}%` }}
        />
      </div>
    </div>
  );
}
