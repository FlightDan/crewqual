import { Suspense } from "react";
import { QualificationConfigView } from "@/components/admin/qualification-config-view";

export default function QualificationConfigPage() {
  return (
    <Suspense>
      <QualificationConfigView />
    </Suspense>
  );
}
