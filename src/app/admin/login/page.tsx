import { getServerConfig } from "@/server/config";
import { getRuntimeSecurityPolicy } from "@/server/runtime-settings";
import { isSetupRequired } from "@/server/setup";
import { redirect } from "next/navigation";
import { AdminLoginForm } from "./login-form";
import type { Metadata } from "next";
import { localizedTitle } from "@/lib/server-locale";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await localizedTitle("管理员安全登录", "Administrator sign-in") };
}

export default async function AdminLoginPage() {
  if (await isSetupRequired().catch(() => true)) redirect("/setup");
  const [policy, config] = await Promise.all([getRuntimeSecurityPolicy(), getServerConfig()]);
  return <AdminLoginForm mode={policy.adminLoginMode} mockMode={config.SERVICE_MODE === "mock"} />;
}
