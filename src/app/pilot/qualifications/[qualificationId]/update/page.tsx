import type { Metadata } from "next";
import { QualificationUpdatePageClient } from "./qualification-update-page-client";
import type { PilotFlowScenario } from "@/types/services";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("更新资质", "Update qualification")} · CrewQual` };
}

const scenarios = new Set<PilotFlowScenario>([
  "default",
  "recognizing",
  "recognized",
  "ambiguous",
  "conflict",
  "mismatch",
  "disabled",
  "busy",
  "modified",
  "confirm",
]);

export default async function QualificationUpdatePage({
  params,
  searchParams,
}: {
  params: Promise<{ qualificationId: string }>;
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { qualificationId } = await params;
  const query = await searchParams;
  const scenario = scenarios.has(query.scenario as PilotFlowScenario)
    ? (query.scenario as PilotFlowScenario)
    : "default";
  return <QualificationUpdatePageClient qualificationId={qualificationId} scenario={scenario} />;
}
