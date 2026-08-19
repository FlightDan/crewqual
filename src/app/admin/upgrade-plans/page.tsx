import { Suspense } from "react";
import type { Metadata } from "next";
import { UpgradePlanListView } from "@/components/admin/upgrade-plan-list-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await localizedTitle("升级计划管理", "Upgrade plans") };
}

export default function UpgradePlansPage() {
  return (
    <Suspense>
      <UpgradePlanListView />
    </Suspense>
  );
}
