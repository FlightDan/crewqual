import { UpgradePlanDetailView } from "@/components/admin/upgrade-plan-detail-view";

export default async function UpgradePlanDetailPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  return <UpgradePlanDetailView planId={planId} />;
}
