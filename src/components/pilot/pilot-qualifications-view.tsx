"use client";

import * as React from "react";
import { PilotShell, anonymousMockPilotProfile } from "@/components/layout/pilot-shell";
import { QualificationGroup } from "@/components/pilot/qualification-list";
import { Skeleton } from "@/components/ui/misc";
import { useApplicationServices } from "@/services/application-services-provider";
import type { PilotProfile, QualificationSection } from "@/types/services";
import { useBusinessDayRefresh } from "@/hooks/use-business-day-refresh";
import { useI18n } from "@/components/i18n-provider";

export function PilotQualificationsView({ portal = "pilot" }: { portal?: "pilot" | "member" }) {
  const { pilotIdentity, qualifications } = useApplicationServices();
  const [profile, setProfile] = React.useState<PilotProfile>(anonymousMockPilotProfile);
  const [sections, setSections] = React.useState<QualificationSection[] | null>(null);
  const { t } = useI18n();

  const refreshRevision = useBusinessDayRefresh(
    sections?.flatMap((section) => section.qualifications.map((item) => item.timezone)) ?? [],
  );
  React.useEffect(() => {
    let active = true;
    const activeProfile = pilotIdentity.getActiveProfile();
    if (activeProfile) {
      setProfile(activeProfile);
      void qualifications.listForPilot(activeProfile.id).then((result) => {
        if (active) setSections(result.data);
      });
    } else {
      void pilotIdentity
        .getProfile()
        .then((result) => {
          if (!active) return;
          const nextProfile = result.data ?? anonymousMockPilotProfile;
          setProfile(nextProfile);
          void qualifications.listForPilot(nextProfile.id).then((sectionsResult) => {
            if (active) setSections(sectionsResult.data);
          });
        })
        .catch(() => {
          if (active) setSections([]);
        });
    }
    return () => {
      active = false;
    };
  }, [pilotIdentity, qualifications, refreshRevision]);

  return (
    <PilotShell profile={profile} portal={portal} className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-primary">{t("qualifications.title")}</h1>
        <p className="mt-1 text-xs text-secondary">{t("qualifications.hint")}</p>
        {profile.id === anonymousMockPilotProfile.id ? (
          <p className="mt-2 rounded bg-orange-50 px-2 py-1 text-[11px] text-warning">
            {t("qualifications.mockNotice")}
          </p>
        ) : null}
      </div>
      {sections ? (
        sections.map((section) => (
          <QualificationGroup
            key={section.status}
            section={section}
            portalPath={portal === "member" ? "/member" : "/pilot"}
          />
        ))
      ) : (
        <div aria-label={t("qualifications.loading")} className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}
    </PilotShell>
  );
}
