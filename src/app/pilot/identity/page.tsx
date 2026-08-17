import type { Metadata } from "next";
import { PilotIdentityForm } from "@/components/pilot/identity-form";

export const metadata: Metadata = { title: "身份验证 · CrewQual" };

export default function PilotIdentityPage() {
  return <PilotIdentityForm />;
}
