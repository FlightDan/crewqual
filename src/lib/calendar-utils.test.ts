import { describe, expect, it } from "vitest";
import {
  calendarDays,
  calendarRange,
  moveCalendarAnchor,
  validCalendarView,
  validIsoDate,
} from "@/lib/calendar-utils";

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
});
