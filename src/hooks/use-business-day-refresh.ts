"use client";

import * as React from "react";
import { dateOnlyForTimezone, isValidTimezone } from "@/lib/date-only";

/** Refresh data on resumption and on a business-day boundary; never recalculate server status. */
export function useBusinessDayRefresh(timezones: ReadonlyArray<string | null | undefined>) {
  const [revision, refresh] = React.useReducer((value: number) => value + 1, 0);
  const timezoneKey = [...new Set(timezones.filter(isValidTimezone))].sort().join("|");
  React.useEffect(() => {
    const zones = timezoneKey ? timezoneKey.split("|") : [];
    const dayKey = () => {
      const now = new Date();
      return zones.map((zone) => dateOnlyForTimezone(now, zone)).join("|");
    };
    let previousDay = dayKey();
    const resume = () => {
      previousDay = dayKey();
      refresh();
    };
    const visible = () => {
      if (document.visibilityState === "visible") resume();
    };
    const timer = window.setInterval(() => {
      const currentDay = dayKey();
      if (currentDay !== previousDay) {
        previousDay = currentDay;
        refresh();
      }
    }, 60_000);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [timezoneKey]);
  return revision;
}
