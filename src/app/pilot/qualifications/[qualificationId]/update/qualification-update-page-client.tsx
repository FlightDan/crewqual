"use client";

import * as React from "react";
import { PilotShell } from "@/components/layout/pilot-shell";
import { QualificationUpdateFlow } from "@/components/pilot/qualification-update-flow";
import { useApplicationServices } from "@/services/application-services-provider";
import type { PilotFlowScenario, QualificationId, Qualification } from "@/types/services";
import { useI18n } from "@/components/i18n-provider";

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
  const { t } = useI18n();
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
    return (
      <main className="min-h-dvh bg-surface p-6 text-sm text-secondary">
        {t("common.pageLoading")}
      </main>
    );
  if (!qualification)
    return (
      <main className="min-h-dvh bg-surface p-6 text-sm text-danger">{t("common.notFound")}</main>
    );
  return (
    <PilotShell
      variant="page"
      showBack
      portal={portal}
      title={`${t("update.pageTitle")} · ${qualification.name}`}
      className="pt-0"
    >
      <QualificationUpdateFlow qualification={qualification} scenario={scenario} portal={portal} />
    </PilotShell>
  );
}
