"use client";

import * as React from "react";
import { PilotShell } from "@/components/layout/pilot-shell";
import { QualificationUpdateFlow } from "@/components/pilot/qualification-update-flow";
import { useApplicationServices } from "@/services/application-services-provider";
import type { PilotFlowScenario, QualificationId, Qualification } from "@/types/services";

export function QualificationUpdatePageClient({
  qualificationId,
  scenario,
  portal = "pilot",
}: {
  qualificationId: string;
  scenario: PilotFlowScenario;
  portal?: "pilot" | "member";
}) {
  const { qualifications } = useApplicationServices();
  const [qualification, setQualification] = React.useState<Qualification | null | undefined>();
  React.useEffect(() => {
    let active = true;
    void qualifications.getById(qualificationId as QualificationId).then((result) => {
      if (active) setQualification(result.data);
    });
    return () => {
      active = false;
    };
  }, [qualificationId, qualifications]);
  if (qualification === undefined)
    return <main className="min-h-dvh bg-surface p-6 text-sm text-secondary">正在读取资质…</main>;
  if (!qualification)
    return <main className="min-h-dvh bg-surface p-6 text-sm text-danger">未找到该资质项目</main>;
  return (
    <PilotShell
      variant="page"
      showBack
      portal={portal}
      title={`更新资质｜${qualification.name}`}
      className="pt-0"
    >
      <QualificationUpdateFlow qualification={qualification} scenario={scenario} portal={portal} />
    </PilotShell>
  );
}
