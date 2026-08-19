import type { Metadata } from "next";
import { PilotIdentityForm } from "@/components/pilot/identity-form";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("身份验证", "Identity verification")} · CrewQual` };
}

export default function PilotIdentityPage() {
  return <PilotIdentityForm />;
}
