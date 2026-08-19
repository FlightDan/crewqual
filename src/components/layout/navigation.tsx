import {
  Bell,
  CalendarDays,
  ClipboardCheck,
  LayoutGrid,
  LogOut,
  Settings,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { isRemoteServiceMode } from "@/lib/service-mode";
import {
  ADMIN_POSITIONS_CHANGED_EVENT,
  adminSettingsService,
} from "@/services/admin-settings-service";
import { useI18n } from "@/components/i18n-provider";
import { legacyAdminNavLabels, legacyAdminRouteTitles } from "@/lib/navigation-legacy";

export type AdminNavItem = {
  label: string;
  href?: string;
  icon: LucideIcon;
  available: boolean;
  permission?: string;
};

export type AdminPositionNav = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  sortOrder: number;
};

export type AdminNavPosition = AdminPositionNav & {
  memberHref: string;
  qualificationHref: string;
  upgradeHref: string;
};

export const adminNavItems: AdminNavItem[] = [
  {
    label: legacyAdminNavLabels.overview,
    href: "/admin/dashboard",
    icon: LayoutGrid,
    available: true,
  },
  {
    label: legacyAdminNavLabels.calendar,
    href: "/admin/calendar",
    icon: CalendarDays,
    available: true,
  },
  { label: legacyAdminNavLabels.members, href: "/admin/members", icon: Users, available: true },
  {
    label: legacyAdminNavLabels.reviews,
    href: "/admin/reviews",
    icon: ClipboardCheck,
    available: true,
  },
  {
    label: legacyAdminNavLabels.notifications,
    href: "/admin/notifications",
    icon: Bell,
    available: true,
  },
  {
    label: legacyAdminNavLabels.settings,
    href: "/admin/settings",
    icon: Settings,
    available: true,
    permission: "settings.read",
  },
];

export function toAdminNavPosition(position: AdminPositionNav): AdminNavPosition {
  return {
    ...position,
    memberHref: `/admin/members/positions/${encodeURIComponent(position.code)}`,
    qualificationHref: `/admin/members/positions/${encodeURIComponent(position.code)}/qualifications`,
    upgradeHref: `/admin/upgrade-plans?positions=${encodeURIComponent(position.code)}`,
  };
}

export function useAdminPositions(refreshKey?: string | null) {
  const { locale } = useI18n();
  const [positions, setPositions] = React.useState<AdminPositionNav[]>([]);

  React.useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        let items: AdminPositionNav[];
        if (isRemoteServiceMode()) {
          const response = await fetch("/api/admin/members/positions", {
            credentials: "include",
            cache: "no-store",
          });
          const body = (await response.json().catch(() => ({}))) as {
            data?: { items?: AdminPositionNav[] };
          };
          if (!response.ok || !body.data?.items) return;
          items = body.data.items;
        } else {
          items = await adminSettingsService.listPositions();
        }
        if (active) {
          setPositions(
            items
              .filter((item) => item.active !== false)
              .sort(
                (left, right) =>
                  left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, locale),
              ),
          );
        }
      } catch {
        // Keep the last authoritative list on a transient read failure.
      }
    };
    const reload = () => void load();
    void load();
    window.addEventListener(ADMIN_POSITIONS_CHANGED_EVENT, reload);
    return () => {
      active = false;
      window.removeEventListener(ADMIN_POSITIONS_CHANGED_EVENT, reload);
    };
  }, [locale, refreshKey]);

  return React.useMemo(() => positions.map(toAdminNavPosition), [positions]);
}

export const mobileBottomItems: AdminNavItem[] = [
  adminNavItems[0]!,
  adminNavItems[1]!,
  adminNavItems[2]!,
  adminNavItems[3]!,
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
  if (pathname === "/admin/upgrade-plans/new") return legacyAdminRouteTitles.newUpgradePlan;
  if (pathname?.startsWith("/admin/upgrade-plans/")) return legacyAdminRouteTitles.upgradePlan;
  if (pathname === "/admin/upgrade-plans") return legacyAdminRouteTitles.upgradePlans;
  if (pathname === "/admin/calendar") return legacyAdminRouteTitles.calendar;
  if (pathname === "/admin/qualification-config") return legacyAdminRouteTitles.qualificationConfig;
  if (pathname === "/admin/notifications") return legacyAdminRouteTitles.notifications;
  if (pathname === "/admin/settings") return legacyAdminRouteTitles.settings;
  if (pathname === "/admin/forbidden") return legacyAdminRouteTitles.forbidden;
  if (pathname?.startsWith("/admin/reviews/")) return legacyAdminRouteTitles.review;
  if (pathname === "/admin/reviews") return legacyAdminRouteTitles.reviews;
  if (pathname?.endsWith("/qualifications")) return legacyAdminRouteTitles.positionQualifications;
  if (pathname?.startsWith("/admin/members/positions/"))
    return legacyAdminRouteTitles.positionMembers;
  if (pathname?.startsWith("/admin/members/")) return legacyAdminRouteTitles.member;
  if (pathname === "/admin/members") return legacyAdminRouteTitles.members;
  if (pathname?.startsWith("/admin/pilots/")) return legacyAdminRouteTitles.pilot;
  if (pathname === "/admin/pilots") return legacyAdminRouteTitles.pilots;
  return legacyAdminRouteTitles.dashboard;
}

export function getAdminRouteTitleKey(pathname: string | null): string {
  if (pathname === "/admin/upgrade-plans/new") return "navigation.route.newUpgradePlan";
  if (pathname?.startsWith("/admin/upgrade-plans/")) return "navigation.route.upgradePlan";
  if (pathname === "/admin/upgrade-plans") return "navigation.route.upgradePlans";
  if (pathname === "/admin/calendar") return "navigation.route.calendar";
  if (pathname === "/admin/qualification-config") return "navigation.route.qualificationConfig";
  if (pathname === "/admin/notifications") return "navigation.route.notifications";
  if (pathname === "/admin/settings") return "navigation.route.settings";
  if (pathname === "/admin/forbidden") return "navigation.route.forbidden";
  if (pathname?.startsWith("/admin/reviews/")) return "navigation.route.review";
  if (pathname === "/admin/reviews") return "navigation.route.reviews";
  if (pathname?.endsWith("/qualifications")) return "navigation.route.positionQualifications";
  if (pathname?.startsWith("/admin/members/positions/")) return "navigation.route.positionMembers";
  if (pathname?.startsWith("/admin/members/")) return "navigation.route.member";
  if (pathname === "/admin/members") return "navigation.route.members";
  if (pathname?.startsWith("/admin/pilots/")) return "navigation.route.pilot";
  if (pathname === "/admin/pilots") return "navigation.route.pilots";
  return "navigation.route.dashboard";
}

export function getAdminNavItemKey(label: string): string {
  const keys: Record<string, string> = {
    [legacyAdminNavLabels.overview]: "navigation.overview",
    [legacyAdminNavLabels.calendar]: "navigation.calendar",
    [legacyAdminNavLabels.members]: "navigation.members",
    [legacyAdminNavLabels.reviews]: "navigation.reviews",
    [legacyAdminNavLabels.notifications]: "navigation.notifications",
    [legacyAdminNavLabels.settings]: "navigation.settings",
  };
  return keys[label] ?? label;
}

export { LogOut };
