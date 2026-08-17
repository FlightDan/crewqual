import type { Metadata } from "next";
import { PilotIdentityForm } from "@/components/pilot/identity-form";

export const metadata: Metadata = { title: "成员身份验证 · CrewQual" };

export default function MemberIdentityPage() {
  return <PilotIdentityForm portal="member" />;
}
