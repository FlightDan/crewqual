"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  getAdminNavItemKey,
  isAdminNavItemActive,
  mobileBottomItems,
} from "@/components/layout/navigation";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n-provider";

export function AdminMobileBottomNav({ pendingReviewCount = 0 }: { pendingReviewCount?: number }) {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav
      data-testid="mobile-bottom-nav"
      aria-label={t("navigation.bottom")}
      className="fixed inset-x-0 bottom-0 z-[var(--z-bottom-nav)] grid grid-cols-4 border-t border-border bg-card px-2 pb-safe-bottom pt-2 shadow-[0_-4px_12px_rgb(15_23_42/0.06)] lg:hidden"
    >
      {mobileBottomItems.map((item) => {
        const Icon = item.icon;
        const active = isAdminNavItemActive(pathname, item);
        const content = (
          <>
            <Icon aria-hidden="true" className="size-5" />
            {getAdminNavItemKey(item.label) === "navigation.reviews" && pendingReviewCount > 0 ? (
              <span className="absolute left-1/2 top-0 rounded-full bg-danger px-1 text-[9px] leading-4 text-white">
                {pendingReviewCount}
              </span>
            ) : null}
            <span>{t(getAdminNavItemKey(item.label))}</span>
          </>
        );
        const className = cn(
          "relative flex min-h-11 flex-col items-center justify-center gap-0.5 text-[11px]",
          active ? "font-semibold text-brand" : item.available ? "text-muted" : "text-slate-300",
        );
        return item.href ? (
          <Link
            key={item.label}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={className}
          >
            {content}
          </Link>
        ) : (
          <div
            key={item.label}
            aria-disabled="true"
            className={className}
            title={t("navigation.comingSoon")}
          >
            {content}
          </div>
        );
      })}
    </nav>
  );
}
