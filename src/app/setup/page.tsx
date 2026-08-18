import { redirect } from "next/navigation";
import { SetupWizard } from "@/components/setup/setup-wizard";
import { getSetupOverview } from "@/server/setup";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const overview = await getSetupOverview();
  if (!overview.required) redirect("/admin/login");
  return <SetupWizard initialOverview={overview} />;
}
