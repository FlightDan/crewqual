import { Suspense } from "react";
import { UpgradePlanForm } from "@/components/admin/upgrade-plan-form";
import { AdminPermissionGate } from "@/components/admin/admin-permission-gate";

export default function NewUpgradePlanPage() {
  return (
    <AdminPermissionGate permission="operations.write">
      <Suspense>
        <UpgradePlanForm />
      </Suspense>
    </AdminPermissionGate>
  );
}
