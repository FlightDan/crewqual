"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, User, Users } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  adminNavItems,
  canAccessAdminNavItem,
  isAdminNavItemActive,
  useAdminPositions,
  getAdminNavItemKey,
} from "@/components/layout/navigation";
import { cn } from "@/lib/utils";
import { useAdminSession } from "@/services/admin-session-provider";
import { useI18n } from "@/components/i18n-provider";
import { legacyAdminNavLabels } from "@/lib/navigation-legacy";

export function AdminNavigationTree({
  mobile = false,
  pendingReviewCount = 0,
  onNavigate,
}: {
  mobile?: boolean;
  pendingReviewCount?: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [positionFilter, setPositionFilter] = React.useState<string | null>(null);
  const { hasPermission } = useAdminSession();
  const { t } = useI18n();
  const positions = useAdminPositions(pathname);
  const [membersOpen, setMembersOpen] = React.useState(true);
  const [openPositions, setOpenPositions] = React.useState<Record<string, boolean>>({
    PILOT: true,
  });
  const visibleItems = adminNavItems.filter((item) => canAccessAdminNavItem(item, hasPermission));
  const overviewItem = visibleItems.find((item) => item.label === legacyAdminNavLabels.overview);
  const membersItem = visibleItems.find((item) => item.label === legacyAdminNavLabels.members);
  const otherItems = visibleItems.filter(
    (item) =>
      item.label !== legacyAdminNavLabels.overview && item.label !== legacyAdminNavLabels.members,
  );

  React.useEffect(() => {
    const nextPositionFilter =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("positions");
    setPositionFilter(nextPositionFilter);
    const activePosition = positions.find(
      (position) =>
        pathname === position.qualificationHref ||
        pathname === position.memberHref ||
        pathname?.startsWith(`${position.memberHref}/`) ||
        (pathname === "/admin/upgrade-plans" && nextPositionFilter === position.code),
    );
    if (activePosition) {
      setMembersOpen(true);
      setOpenPositions((current) => ({ ...current, [activePosition.code]: true }));
    }
  }, [pathname, positions]);

  const togglePosition = (code: string) => {
    setOpenPositions((current) => ({ ...current, [code]: !current[code] }));
  };

  const navClass = (active: boolean, level: "root" | "position" | "child") =>
    cn(
      "transition",
      mobile
        ? level === "root"
          ? "flex min-h-11 items-center gap-4 rounded-md px-4 text-sm font-semibold"
          : level === "position"
            ? "flex min-h-10 items-center gap-3 rounded-md pl-8 pr-4 text-sm font-semibold"
            : "flex min-h-9 items-center rounded-md pl-14 pr-4 text-[13px] font-medium"
        : level === "root"
          ? "flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium"
          : level === "position"
            ? "flex min-h-9 items-center gap-2 rounded-md pl-8 pr-3 text-sm font-medium"
            : "flex min-h-8 items-center rounded-md pl-11 pr-3 text-[13px] font-medium",
      active
        ? mobile
          ? "bg-brand text-white"
          : level === "child"
            ? "bg-slate-800 text-brand"
            : "bg-slate-800 text-slate-50"
        : mobile
          ? "text-primary hover:bg-slate-100"
          : "text-slate-400 hover:bg-slate-800 hover:text-white",
    );

  const link = (
    href: string,
    active: boolean,
    level: "root" | "position" | "child",
    children: React.ReactNode,
  ) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={navClass(active, level)}
      onClick={onNavigate}
    >
      {children}
    </Link>
  );

  const rootItem = (item: (typeof visibleItems)[number]) => {
    if (!item.href) return null;
    const Icon = item.icon;
    const active = isAdminNavItemActive(pathname, item);
    return (
      <React.Fragment key={item.label}>
        {item.label === legacyAdminNavLabels.reviews ? (
          <div aria-hidden="true" className="my-2 border-t border-slate-800" />
        ) : null}
        {link(
          item.href,
          active,
          "root",
          <>
            <Icon aria-hidden="true" className={mobile ? "size-5" : "size-[18px]"} />
            <span>{t(getAdminNavItemKey(item.label))}</span>
            {item.label === legacyAdminNavLabels.reviews && pendingReviewCount > 0 ? (
              <span className="ml-auto rounded-full bg-danger px-1.5 py-0.5 text-[10px] text-white">
                {pendingReviewCount}
              </span>
            ) : null}
          </>,
        )}
      </React.Fragment>
    );
  };

  return (
    <div className={cn("flex flex-col", mobile ? "gap-1" : "gap-1.5")}>
      {overviewItem ? rootItem(overviewItem) : null}
      {membersItem ? (
        <div>
          <div
            className={cn(
              navClass(isAdminNavItemActive(pathname, membersItem), "root"),
              "cursor-pointer",
            )}
          >
            <Users aria-hidden="true" className={mobile ? "size-5" : "size-[18px]"} />
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              aria-expanded={membersOpen}
              onClick={() => setMembersOpen((open) => !open)}
            >
              <span>{t("navigation.members")}</span>
            </button>
            <button
              type="button"
              aria-label={
                membersOpen
                  ? `${t("navigation.collapse")}${t("navigation.members")}`
                  : `${t("navigation.expand")}${t("navigation.members")}`
              }
              aria-expanded={membersOpen}
              className="rounded p-1"
              onClick={() => setMembersOpen((open) => !open)}
            >
              {membersOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </button>
          </div>
          {membersOpen ? (
            <div
              className={cn("mt-0.5 space-y-0.5", !mobile && "border-l border-slate-700/70 pl-1")}
            >
              {positions.map((position) => {
                const positionActive = pathname === position.memberHref;
                const qualificationActive = pathname === position.qualificationHref;
                const upgradeActive =
                  pathname === "/admin/upgrade-plans" && positionFilter === position.code;
                const expanded = openPositions[position.code] ?? position.code === "PILOT";
                return (
                  <div key={position.id}>
                    <div className={cn(navClass(positionActive, "position"), "gap-1")}>
                      <User aria-hidden="true" className={mobile ? "size-4" : "size-4"} />
                      <Link
                        href={position.memberHref}
                        aria-current={positionActive ? "page" : undefined}
                        className="min-w-0 flex-1 truncate"
                        onClick={onNavigate}
                      >
                        {position.name}
                      </Link>
                      <button
                        type="button"
                        aria-label={
                          expanded
                            ? `${t("navigation.collapse")}${position.name}`
                            : `${t("navigation.expand")}${position.name}`
                        }
                        aria-expanded={expanded}
                        className="rounded p-1"
                        onClick={() => togglePosition(position.code)}
                      >
                        {expanded ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronRight className="size-3" />
                        )}
                      </button>
                    </div>
                    {expanded ? (
                      <div className="space-y-0.5 border-l border-slate-700/70">
                        <React.Fragment key={`${position.code}-qualifications`}>
                          {link(
                            position.qualificationHref,
                            qualificationActive,
                            "child",
                            t("navigation.route.positionQualifications"),
                          )}
                        </React.Fragment>
                        <React.Fragment key={`${position.code}-upgrades`}>
                          {link(
                            position.upgradeHref,
                            upgradeActive,
                            "child",
                            t("navigation.route.upgradePlans"),
                          )}
                        </React.Fragment>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      {otherItems.map(rootItem)}
    </div>
  );
}
