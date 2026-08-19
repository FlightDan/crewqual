import type { Metadata } from "next";
import { Suspense } from "react";
import { QualificationConfigView } from "@/components/admin/qualification-config-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("职位资质管理", "Position qualifications")} · CrewQual` };
}

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
