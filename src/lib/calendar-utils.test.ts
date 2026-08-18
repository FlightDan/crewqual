import { describe, expect, it } from "vitest";
import {
  calendarActiveUpgradeEventsForDay,
  calendarDays,
  calendarBoundaryEventsForDay,
  calendarEventDayKind,
  calendarRange,
  moveCalendarAnchor,
  summarizeDayQualifications,
  validCalendarView,
  validIsoDate,
} from "@/lib/calendar-utils";
import type { AdminCalendarEvent, CalendarDayQualificationSlot } from "@/types/services";

describe("calendar date boundaries", () => {
  it("creates Monday-first month grids across month and year boundaries", () => {
    expect(calendarRange("month", "2026-12-15")).toEqual({
      from: "2026-11-30",
      to: "2027-01-03",
    });
    expect(calendarDays("month", "2026-12-15")).toHaveLength(35);
  });

  it("keeps week and 90-day ranges inclusive without timezone drift", () => {
    expect(calendarRange("week", "2026-08-14")).toEqual({
      from: "2026-08-10",
      to: "2026-08-16",
    });
    expect(calendarRange("agenda", "2026-11-15")).toEqual({
      from: "2026-11-15",
      to: "2027-02-12",
    });
    expect(moveCalendarAnchor("week", "2026-12-30", 1)).toBe("2027-01-06");
  });

  it("falls back explicitly for invalid URL parameters", () => {
    expect(validIsoDate("not-a-date")).toBe("2026-08-14");
    expect(validCalendarView("board")).toBe("month");
  });

  it("keeps qualification expiry events on their exact date", () => {
    const event = {
      type: "qualification_expiry" as const,
      date: "2026-08-15",
      endDate: "2026-08-15",
    } satisfies Pick<AdminCalendarEvent, "type" | "date" | "endDate">;

    expect(calendarEventDayKind(event, "2026-08-14")).toBe("outside");
    expect(calendarEventDayKind(event, "2026-08-15")).toBe("single");
    expect(calendarEventDayKind(event, "2026-08-16")).toBe("outside");
  });

  it("distinguishes upgrade stage boundaries from active middle dates", () => {
    const event = {
      type: "upgrade_stage" as const,
      date: "2026-08-10",
      endDate: "2026-08-16",
    } satisfies Pick<AdminCalendarEvent, "type" | "date" | "endDate">;

    expect(calendarEventDayKind(event, "2026-08-09")).toBe("outside");
    expect(calendarEventDayKind(event, "2026-08-10")).toBe("start");
    expect(calendarEventDayKind(event, "2026-08-15")).toBe("active");
    expect(calendarEventDayKind(event, "2026-08-16")).toBe("end");
    expect(
      calendarEventDayKind({ ...event, date: "2026-08-15", endDate: "2026-08-15" }, "2026-08-15"),
    ).toBe("single");
    expect(
      calendarBoundaryEventsForDay([{ ...event, id: "stage" } as AdminCalendarEvent], "2026-08-15"),
    ).toHaveLength(0);
    expect(
      calendarActiveUpgradeEventsForDay(
        [{ ...event, id: "stage" } as AdminCalendarEvent],
        "2026-08-15",
      ),
    ).toHaveLength(1);
  });

  it("expands urgent qualifications and summarizes normal or missing entries", () => {
    const record = (daysRemaining: number) => ({
      daysRemaining,
      status: daysRemaining < 0 ? "expired" : daysRemaining <= 30 ? "due_30" : "valid",
    });
    const qualifications = [
      { qualificationId: "expired", qualificationName: "已过期", record: record(-1) },
      { qualificationId: "today", qualificationName: "今日到期", record: record(0) },
      { qualificationId: "due", qualificationName: "30天内", record: record(30) },
      { qualificationId: "normal", qualificationName: "31天后", record: record(31) },
      { qualificationId: "missing", qualificationName: "未建档", record: null },
    ] as unknown as CalendarDayQualificationSlot[];

    expect(summarizeDayQualifications(qualifications)).toMatchObject({
      attention: [
        { qualificationId: "expired" },
        { qualificationId: "today" },
        { qualificationId: "due" },
      ],
      normalCount: 1,
      missingCount: 1,
    });
  });
});
