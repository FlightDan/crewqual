import { Suspense } from "react";
import type { Metadata } from "next";
import { NotificationLogView } from "@/components/admin/notification-log-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await localizedTitle("通知与预警记录日志", "Notification log") };
}

export default function NotificationPage() {
  return (
    <Suspense>
      <NotificationLogView />
    </Suspense>
  );
}
