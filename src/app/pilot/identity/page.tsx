import type { Metadata } from "next";
import { PilotIdentityForm } from "@/components/pilot/identity-form";
import { localizedTitle } from "@/lib/server-locale";
import { getRuntimeSecurityPolicy } from "@/server/runtime-settings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("身份验证", "Identity verification")} · CrewQual` };
}

export default function PilotIdentityPage() {
  return <PilotIdentityContent />;
}

async function PilotIdentityContent() {
  const policy = await getRuntimeSecurityPolicy();
  return (
    <PilotIdentityForm
      loginMode={policy.memberLoginMode}
      fidoRequired={policy.memberFido2Required}
    />
  );
}
