import { UpgradeStageBadge } from "@/components/admin/status-badges";
import { Card } from "@/components/ui/card";
import type { UpgradePlan } from "@/types/services";

export function UpgradeStageTimeline({ plan }: { plan: UpgradePlan | null }) {
  if (!plan) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-secondary">
        当前无活动升级计划
      </div>
    );
  }
  return (
    <section aria-label={`当前升级计划：${plan.title}`}>
      <h3 className="mb-3 text-sm font-bold text-primary">当前升级计划摘要（{plan.title}）</h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {plan.stages.map((stage, index) => (
          <Card key={stage.name} className="relative p-4 shadow-none">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold">
                {index + 1}. {stage.name}
              </p>
              <UpgradeStageBadge status={stage.status} />
            </div>
            <p className="mt-2 text-xs leading-5 text-secondary">{stage.notes}</p>
            <p className="mt-1 text-[11px] text-muted">
              计划周期：{stage.plannedStart} 至 {stage.plannedEnd}
            </p>
          </Card>
        ))}
      </div>
    </section>
  );
}
