import {
  Award,
  Bell,
  CalendarDays,
  ClipboardCheck,
  LayoutGrid,
  LogOut,
  Settings,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type AdminNavItem = {
  label: string;
  href?: string;
  icon: LucideIcon;
  available: boolean;
  permission?: string;
};

export const adminNavItems: AdminNavItem[] = [
  { label: "总览", href: "/admin/dashboard", icon: LayoutGrid, available: true },
  { label: "日历", href: "/admin/calendar", icon: CalendarDays, available: true },
  { label: "成员管理", href: "/admin/members", icon: Users, available: true },
  { label: "资质管理", href: "/admin/qualification-config", icon: Award, available: true },
  { label: "升级计划", href: "/admin/upgrade-plans", icon: TrendingUp, available: true },
  { label: "待审核", href: "/admin/reviews", icon: ClipboardCheck, available: true },
  { label: "通知记录", href: "/admin/notifications", icon: Bell, available: true },
  {
    label: "系统设置",
    href: "/admin/settings",
    icon: Settings,
    available: true,
    permission: "settings.read",
  },
];

export const mobileBottomItems: AdminNavItem[] = [
  adminNavItems[0]!,
  adminNavItems[1]!,
  adminNavItems[2]!,
  adminNavItems[5]!,
];

export function isAdminNavItemActive(pathname: string | null, item: AdminNavItem): boolean {
  if (!item.href) return false;
  return pathname === item.href || Boolean(pathname?.startsWith(`${item.href}/`));
}

export function canAccessAdminNavItem(
  item: AdminNavItem,
  hasPermission: (permission: string) => boolean,
) {
  return !item.permission || hasPermission(item.permission);
}

export function getAdminRouteTitle(pathname: string | null): string {
  if (pathname === "/admin/upgrade-plans/new") return "新建机组升级计划";
  if (pathname?.startsWith("/admin/upgrade-plans/")) return "升级计划详情";
  if (pathname === "/admin/upgrade-plans") return "升级计划管理";
  if (pathname === "/admin/calendar") return "中队统一日程日历";
  if (pathname === "/admin/qualification-config") return "核心资质项目配置";
  if (pathname === "/admin/notifications") return "通知与预警记录日志";
  if (pathname === "/admin/settings") return "系统设置";
  if (pathname === "/admin/forbidden") return "访问受限";
  if (pathname?.startsWith("/admin/reviews/")) return "资质审核工作台";
  if (pathname === "/admin/reviews") return "待审核资质更新";
  if (pathname?.startsWith("/admin/members/positions/")) return "职位成员列表";
  if (pathname?.startsWith("/admin/members/")) return "成员详情档案";
  if (pathname === "/admin/members") return "成员管理与职位概览";
  if (pathname?.startsWith("/admin/pilots/")) return "飞行员详情档案";
  if (pathname === "/admin/pilots") return "飞行员管理与资质大盘";
  return "系统总览 Dashboard";
}

export { LogOut };
