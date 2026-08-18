import type { Metadata } from "next";
import { Suspense } from "react";
import { QualificationConfigView } from "@/components/admin/qualification-config-view";

export const metadata: Metadata = { title: "职位资质管理 · CrewQual" };

export default async function PositionQualificationsPage({
  params,
}: {
  params: Promise<{ positionCode: string }>;
}) {
  const { positionCode } = await params;
  return (
    <Suspense>
      <QualificationConfigView positionCode={positionCode.toUpperCase()} />
    </Suspense>
  );
}
