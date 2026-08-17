import { Suspense } from "react";
import { NotificationLogView } from "@/components/admin/notification-log-view";

export default function NotificationPage() {
  return (
    <Suspense>
      <NotificationLogView />
    </Suspense>
  );
}
