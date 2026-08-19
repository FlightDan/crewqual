import type { Metadata } from "next";
import { PilotIdentityForm } from "@/components/pilot/identity-form";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `${await localizedTitle("成员身份验证", "Member identity verification")} · CrewQual`,
  };
}

export default function MemberIdentityPage() {
  return <PilotIdentityForm portal="member" />;
}
