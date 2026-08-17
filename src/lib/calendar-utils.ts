import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isMatch,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { CalendarView } from "@/types/services";

export const OPERATIONS_TODAY = "2026-08-14";

export function shanghaiToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function validIsoDate(value: string | null | undefined, fallback = OPERATIONS_TODAY) {
  return value && isMatch(value, "yyyy-MM-dd") && isValid(parseISO(value)) ? value : fallback;
}

export function validCalendarView(value: string | null | undefined): CalendarView {
  return value === "agenda" || value === "week" || value === "timeline" || value === "month"
    ? value
    : "month";
}

export function calendarRange(view: CalendarView, anchor: string) {
  const date = parseISO(validIsoDate(anchor));
  if (view === "month") {
    return {
      from: format(startOfWeek(startOfMonth(date), { weekStartsOn: 1 }), "yyyy-MM-dd"),
      to: format(endOfWeek(endOfMonth(date), { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  }
  if (view === "week") {
    return {
      from: format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      to: format(endOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  }
  return { from: format(date, "yyyy-MM-dd"), to: format(addDays(date, 89), "yyyy-MM-dd") };
}

export function calendarDays(view: CalendarView, anchor: string) {
  const range = calendarRange(view, anchor);
  return eachDayOfInterval({ start: parseISO(range.from), end: parseISO(range.to) }).map((date) =>
    format(date, "yyyy-MM-dd"),
  );
}

export function moveCalendarAnchor(view: CalendarView, anchor: string, direction: -1 | 1) {
  const date = parseISO(validIsoDate(anchor));
  if (view === "month") return format(addMonths(date, direction), "yyyy-MM-dd");
  if (view === "week") return format(addWeeks(date, direction), "yyyy-MM-dd");
  return format(addDays(date, 90 * direction), "yyyy-MM-dd");
}
