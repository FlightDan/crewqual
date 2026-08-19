import type { Metadata } from "next";
import { AdminSettingsView } from "@/components/admin/admin-settings-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await localizedTitle("系统设置", "Settings")} · CrewQual` };
}

export default function AdminSettingsPage() {
  return <AdminSettingsView />;
}
