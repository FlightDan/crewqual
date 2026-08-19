import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Qualification } from "@/types/services";
import { useI18n } from "@/components/i18n-provider";
import { localizedQualificationText } from "@/lib/messages";

function qualificationTone(status: Qualification["status"]) {
  if (status === "expired") return "danger" as const;
  if (status === "due_30" || status === "due_90") return "warning" as const;
  return "success" as const;
}

export function QualificationHealthList({ qualifications }: { qualifications: Qualification[] }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3" data-testid="qualification-health-list">
      {qualifications.map((qualification, index) => (
        <Card key={qualification.id} className="p-4 shadow-none">
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-sm font-bold text-primary">
              {index + 1}. {qualification.name}
            </h4>
            <Badge tone={qualificationTone(qualification.status)} className="shrink-0 py-0.5">
              {localizedQualificationText(qualification.statusLabel, t)}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
            <span>{qualification.parameter ?? t("qualification.pass")}</span>
            <span>
              {t("qualification.expiry", {
                date: qualification.expiresOn,
                remaining: localizedQualificationText(qualification.remainingLabel, t),
              })}
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
}
