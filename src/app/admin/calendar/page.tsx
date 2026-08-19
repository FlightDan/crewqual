import { Suspense } from "react";
import type { Metadata } from "next";
import { CalendarViewPage } from "@/components/admin/calendar-view";
import { localizedTitle } from "@/lib/server-locale";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await localizedTitle("统一日历", "Calendar") };
}

export default function CalendarPage() {
  return (
    <Suspense>
      <CalendarViewPage />
    </Suspense>
  );
}
