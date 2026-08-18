import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const toneClasses = {
  danger: "text-danger bg-red-50",
  warning: "text-warning bg-orange-50",
  info: "text-brand bg-blue-50",
  success: "text-success bg-emerald-50",
  purple: "text-violet-600 bg-violet-50",
  neutral: "text-secondary bg-slate-100",
} as const;

export function DashboardStatCard({
  testId,
  label,
  value,
  note,
  tone,
  onClick,
  expanded = false,
}: {
  testId?: string;
  label: string;
  value: number;
  note: string;
  tone: keyof typeof toneClasses;
  onClick?: () => void;
  expanded?: boolean;
}) {
  const content = (
    <Card
      className={cn(
        "h-full p-4 shadow-none transition",
        onClick && "group-hover:border-brand/40 group-hover:shadow-card",
        expanded && "border-brand ring-2 ring-brand/10",
      )}
    >
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p
        className={`mt-2 inline-flex rounded-md px-2 py-1 text-2xl font-bold ${toneClasses[tone]}`}
      >
        {value}
        <span className="ml-1 self-end pb-0.5 text-[11px] font-normal">项</span>
      </p>
      <div className="mt-2 flex items-center gap-1 text-[11px] text-muted">
        <p className="min-w-0 flex-1 truncate">{note}</p>
        {onClick ? (
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
          />
        ) : null}
      </div>
    </Card>
  );

  if (!onClick) return <div data-testid={testId}>{content}</div>;

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={`查看${label}明细，共 ${value} 项`}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      className="group block w-full cursor-pointer rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      onClick={onClick}
    >
      {content}
    </button>
  );
}
