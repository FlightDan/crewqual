import type { Metadata } from "next";
import { AdminSettingsView } from "@/components/admin/admin-settings-view";

export const metadata: Metadata = { title: "系统设置 · CrewQual" };

export default function AdminSettingsPage() {
  return <AdminSettingsView />;
}
