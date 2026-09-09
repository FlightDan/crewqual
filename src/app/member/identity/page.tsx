import type { Metadata } from "next";
import { PilotIdentityForm } from "@/components/pilot/identity-form";
import { localizedTitle } from "@/lib/server-locale";
import { getRuntimeSecurityPolicy } from "@/server/runtime-settings";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `${await localizedTitle("成员身份验证", "Member identity verification")} · CrewQual`,
  };
}

export default function MemberIdentityPage() {
  return <MemberIdentityContent />;
}

async function MemberIdentityContent() {
  const policy = await getRuntimeSecurityPolicy();
  return (
    <PilotIdentityForm
      portal="member"
      loginMode={policy.memberLoginMode}
      fidoRequired={policy.memberFido2Required}
    />
  );
}
