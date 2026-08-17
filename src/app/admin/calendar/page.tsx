import { Suspense } from "react";
import { CalendarViewPage } from "@/components/admin/calendar-view";

export default function CalendarPage() {
  return (
    <Suspense>
      <CalendarViewPage />
    </Suspense>
  );
}
