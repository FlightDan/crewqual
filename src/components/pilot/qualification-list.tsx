import Link from "next/link";
import { ArrowRight, CalendarDays, Plane } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Qualification, QualificationSection, QualificationStatus } from "@/types/services";

const statusStyles: Record<
  QualificationStatus,
  { marker: string; title: string; card: string; badge: "danger" | "warning" | "success" }
> = {
  expired: {
    marker: "bg-danger",
    title: "text-danger",
    card: "border-danger bg-red-50/70",
    badge: "danger",
  },
  due_30: {
    marker: "bg-warning",
    title: "text-warning",
    card: "border-warning bg-orange-50/70",
    badge: "warning",
  },
  due_90: {
    marker: "bg-secondary",
    title: "text-secondary",
    card: "border-warning bg-orange-50/40",
    badge: "warning",
  },
  valid: {
    marker: "bg-success",
    title: "text-secondary",
    card: "border-border bg-card",
    badge: "success",
  },
};

export function QualificationCard({
  qualification,
  portalPath = "/pilot",
}: {
  qualification: Qualification;
  portalPath?: "/pilot" | "/member";
}) {
  const styles = statusStyles[qualification.status];
  const urgent = qualification.status === "expired";
  const showAction = urgent || qualification.status === "due_30";
  return (
    <Card
      data-testid={`qualification-${qualification.id}`}
      className={cn("space-y-3 rounded-lg p-4 shadow-none", styles.card)}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-[15px] font-bold leading-5 text-primary">
          {qualification.name}
        </h3>
        <Badge tone={styles.badge} className="shrink-0 px-2 py-0.5 text-[11px]">
          {qualification.statusLabel}
        </Badge>
      </div>
      {qualification.parameter ? (
        <div className="flex items-center gap-2 text-xs text-secondary">
          <Plane aria-hidden="true" className="size-3.5" />
          <span>等级/参数：{qualification.parameter}</span>
          {qualification.cycleMonths ? <span>· {qualification.cycleMonths}个月周期</span> : null}
        </div>
      ) : null}
      <div className="flex items-end justify-between gap-3 text-xs">
        <div>
          <p className="text-[11px] text-secondary">到期日期</p>
          <p className="mt-0.5 font-semibold text-primary">{qualification.expiresOn}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-secondary">
            {qualification.cycleMonths ? "复训周期" : "剩余时间"}
          </p>
          <p
            className={cn(
              "mt-0.5 font-semibold",
              qualification.status === "expired"
                ? "text-danger"
                : qualification.status === "due_30" || qualification.status === "due_90"
                  ? "text-warning"
                  : "text-primary",
            )}
          >
            {qualification.remainingLabel}
          </p>
        </div>
      </div>
      {showAction ? (
        <Link
          href={`${portalPath}/qualifications/${qualification.id}/update`}
          className={cn(
            "flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white focus-visible:ring-2",
            urgent ? "bg-danger" : "bg-nav",
          )}
        >
          {urgent ? "立即更新资质" : "更新资质"}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      ) : (
        <Link
          href={`${portalPath}/qualifications/${qualification.id}/update`}
          className="flex min-h-11 items-center justify-between rounded-md border-t border-border/70 pt-2 text-xs font-semibold text-brand"
        >
          <span className="flex items-center gap-2">
            <CalendarDays aria-hidden="true" className="size-4" />
            查看或更新
          </span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      )}
    </Card>
  );
}

export function QualificationGroup({
  section,
  portalPath = "/pilot",
}: {
  section: QualificationSection;
  portalPath?: "/pilot" | "/member";
}) {
  const styles = statusStyles[section.status];
  return (
    <section aria-labelledby={`section-${section.status}`} className="space-y-2">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={cn("h-3 w-[3px] rounded-sm", styles.marker)} />
        <h2 id={`section-${section.status}`} className={cn("text-[13px] font-bold", styles.title)}>
          {section.title}
        </h2>
      </div>
      <div className="space-y-2">
        {section.qualifications.map((qualification) => (
          <QualificationCard
            key={qualification.id}
            qualification={qualification}
            portalPath={portalPath}
          />
        ))}
      </div>
    </section>
  );
}
