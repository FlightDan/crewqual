import { Suspense } from "react";
import { UpgradePlanForm } from "@/components/admin/upgrade-plan-form";
import { AdminPermissionGate } from "@/components/admin/admin-permission-gate";

export default async function EditUpgradePlanPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  return (
    <AdminPermissionGate permission="operations.write">
      <Suspense>
        <UpgradePlanForm planId={planId} />
      </Suspense>
    </AdminPermissionGate>
  );
}
