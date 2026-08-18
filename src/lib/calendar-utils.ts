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
import type {
  AdminCalendarEvent,
  CalendarDayQualificationSlot,
  CalendarView,
} from "@/types/services";

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

export type CalendarEventDayKind = "outside" | "single" | "start" | "end" | "active";

/**
 * Returns the semantic role of an event on a calendar date. Qualification
 * expiry events are deliberately single-day events; only upgrade stages can
 * be active between their start and end dates.
 */
export function calendarEventDayKind(
  event: Pick<AdminCalendarEvent, "type" | "date" | "endDate">,
  day: string,
): CalendarEventDayKind {
  if (event.type === "qualification_expiry") {
    return event.date === day ? "single" : "outside";
  }
  if (event.date === event.endDate) return event.date === day ? "single" : "outside";
  if (event.date === day) return "start";
  if (event.endDate === day) return "end";
  return event.date < day && day < event.endDate ? "active" : "outside";
}

export function calendarEventsForDay(events: AdminCalendarEvent[], day: string) {
  return events.filter((event) => calendarEventDayKind(event, day) !== "outside");
}

export function calendarBoundaryEventsForDay(events: AdminCalendarEvent[], day: string) {
  return events.filter((event) => {
    const kind = calendarEventDayKind(event, day);
    return kind === "single" || kind === "start" || kind === "end";
  });
}

export function calendarActiveUpgradeEventsForDay(events: AdminCalendarEvent[], day: string) {
  return events.filter(
    (event) => event.type === "upgrade_stage" && calendarEventDayKind(event, day) === "active",
  );
}

export type QualificationAttentionSummary = {
  attention: CalendarDayQualificationSlot[];
  normalCount: number;
  missingCount: number;
};

export function summarizeDayQualifications(
  qualifications: CalendarDayQualificationSlot[],
): QualificationAttentionSummary {
  const attention: CalendarDayQualificationSlot[] = [];
  let normalCount = 0;
  let missingCount = 0;

  for (const qualification of qualifications) {
    const record = qualification.record;
    if (!record) {
      missingCount += 1;
    } else if (record.daysRemaining <= 30) {
      attention.push(qualification);
    } else {
      normalCount += 1;
    }
  }

  attention.sort((a, b) => {
    const aDays = a.record?.daysRemaining ?? Number.POSITIVE_INFINITY;
    const bDays = b.record?.daysRemaining ?? Number.POSITIVE_INFINITY;
    return aDays - bDays || a.qualificationName.localeCompare(b.qualificationName, "zh-CN");
  });

  return { attention, normalCount, missingCount };
}

export function moveCalendarAnchor(view: CalendarView, anchor: string, direction: -1 | 1) {
  const date = parseISO(validIsoDate(anchor));
  if (view === "month") return format(addMonths(date, direction), "yyyy-MM-dd");
  if (view === "week") return format(addWeeks(date, direction), "yyyy-MM-dd");
  return format(addDays(date, 90 * direction), "yyyy-MM-dd");
}
