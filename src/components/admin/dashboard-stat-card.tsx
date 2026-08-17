import { Card } from "@/components/ui/card";

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
}: {
  testId?: string;
  label: string;
  value: number;
  note: string;
  tone: keyof typeof toneClasses;
}) {
  return (
    <Card data-testid={testId} className="p-4 shadow-none">
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p
        className={`mt-2 inline-flex rounded-md px-2 py-1 text-2xl font-bold ${toneClasses[tone]}`}
      >
        {value}
        <span className="ml-1 self-end pb-0.5 text-[11px] font-normal">项</span>
      </p>
      <p className="mt-2 truncate text-[11px] text-muted">{note}</p>
    </Card>
  );
}
