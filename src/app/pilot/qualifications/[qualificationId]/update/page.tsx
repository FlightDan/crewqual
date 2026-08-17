import type { Metadata } from "next";
import { QualificationUpdatePageClient } from "./qualification-update-page-client";
import type { PilotFlowScenario } from "@/types/services";

export const metadata: Metadata = { title: "更新资质 · CrewQual" };

const scenarios = new Set<PilotFlowScenario>([
  "default",
  "recognizing",
  "recognized",
  "ambiguous",
  "conflict",
  "mismatch",
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
