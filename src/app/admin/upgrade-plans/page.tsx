import { Suspense } from "react";
import { UpgradePlanListView } from "@/components/admin/upgrade-plan-list-view";

export default function UpgradePlansPage() {
  return (
    <Suspense>
      <UpgradePlanListView />
    </Suspense>
  );
}
