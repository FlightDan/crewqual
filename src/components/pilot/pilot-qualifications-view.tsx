"use client";

import * as React from "react";
import { PilotShell, anonymousMockPilotProfile } from "@/components/layout/pilot-shell";
import { QualificationGroup } from "@/components/pilot/qualification-list";
import { Skeleton } from "@/components/ui/misc";
import { useApplicationServices } from "@/services/application-services-provider";
import type { PilotProfile, QualificationSection } from "@/types/services";

export function PilotQualificationsView({ portal = "pilot" }: { portal?: "pilot" | "member" }) {
  const { pilotIdentity, qualifications } = useApplicationServices();
  const [profile, setProfile] = React.useState<PilotProfile>(anonymousMockPilotProfile);
  const [sections, setSections] = React.useState<QualificationSection[] | null>(null);

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
  }, [pilotIdentity, qualifications]);

  return (
    <PilotShell profile={profile} portal={portal} className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-primary">我的资质</h1>
        <p className="mt-1 text-xs text-secondary">请及时跟进临期与已过期资质的更新复训</p>
        {profile.id === anonymousMockPilotProfile.id ? (
          <p className="mt-2 rounded bg-orange-50 px-2 py-1 text-[11px] text-warning">
            当前为匿名 Mock 开发预览，不代表安全鉴权状态
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
        <div aria-label="正在加载资质" className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}
    </PilotShell>
  );
}
