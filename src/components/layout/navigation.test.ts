import { describe, expect, it } from "vitest";
import {
  adminNavItems,
  canAccessAdminNavItem,
  getAdminRouteTitle,
  isAdminNavItemActive,
  mobileBottomItems,
} from "@/components/layout/navigation";

describe("admin route navigation", () => {
  it("highlights parent items for list and detail routes", () => {
    const members = adminNavItems.find((item) => item.label === "成员管理")!;
    const reviews = adminNavItems.find((item) => item.label === "待审核")!;
    expect(isAdminNavItemActive("/admin/members/positions/PILOT", members)).toBe(true);
    expect(isAdminNavItemActive("/admin/reviews/REV-1001", reviews)).toBe(true);
    expect(isAdminNavItemActive("/admin/dashboard", reviews)).toBe(false);
  });

  it("provides correct desktop/mobile titles and only real routes are links", () => {
    expect(getAdminRouteTitle("/admin/dashboard")).toBe("系统总览 Dashboard");
    expect(getAdminRouteTitle("/admin/calendar")).toBe("统一日历");
    expect(getAdminRouteTitle("/admin/members/member-demo-01")).toBe("成员详情档案");
    expect(getAdminRouteTitle("/admin/reviews/REV-1001")).toBe("资质审核工作台");
    expect(mobileBottomItems.map((item) => item.label)).toEqual([
      "总览",
      "日历",
      "成员管理",
      "待审核",
    ]);
    expect(
      adminNavItems
        .filter((item) => item.available)
        .every((item) => item.href?.startsWith("/admin/")),
    ).toBe(true);
    expect(adminNavItems.filter((item) => !item.available)).toEqual([]);
    const settings = adminNavItems.find((item) => item.label === "系统设置")!;
    expect(settings.href).toBe("/admin/settings");
    expect(canAccessAdminNavItem(settings, () => false)).toBe(false);
    expect(canAccessAdminNavItem(settings, (permission) => permission === "settings.read")).toBe(
      true,
    );
  });
});
