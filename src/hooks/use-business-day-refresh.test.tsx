import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBusinessDayRefresh } from "@/hooks/use-business-day-refresh";

afterEach(() => vi.useRealTimers());
describe("business day refresh", () => {
  it("refreshes at a holder's midnight, on focus and online, and cleans up", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T15:58:30Z"));
    const { result, unmount } = renderHook(() =>
      useBusinessDayRefresh(["Asia/Shanghai", "America/New_York"]),
    );
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(0);
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(1);
    act(() => window.dispatchEvent(new Event("focus")));
    act(() => window.dispatchEvent(new Event("online")));
    expect(result.current).toBe(3);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
