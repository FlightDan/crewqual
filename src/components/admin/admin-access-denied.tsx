"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAdminSession } from "@/services/admin-session-provider";
import { useI18n } from "@/components/i18n-provider";

export function AdminAccessDenied({ reason = "forbidden" }: { reason?: "forbidden" | "no-unit" }) {
  const { session } = useAdminSession();
  const noUnit = reason === "no-unit";
  const { t } = useI18n();
  return (
    <main className="flex min-h-[calc(100dvh-4rem)] items-center justify-center p-4 pb-24 lg:pb-4">
      <Card className="w-full max-w-xl">
        <CardContent className="flex flex-col items-center px-6 py-12 text-center">
          <span className="mb-5 inline-flex size-14 items-center justify-center rounded-full bg-red-50 text-danger">
            <ShieldAlert aria-hidden="true" className="size-7" />
          </span>
          <p className="text-sm font-semibold text-danger">
            {noUnit ? t("accessDenied.incomplete") : "403"}
          </p>
          <h1 className="mt-2 text-2xl font-bold text-primary">
            {noUnit ? t("accessDenied.noUnit") : t("accessDenied.forbidden")}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-secondary">
            {noUnit ? t("accessDenied.noUnitDescription") : t("accessDenied.forbiddenDescription")}
          </p>
          {session ? (
            <p className="mt-4 text-xs text-muted">
              {session.displayName} · {session.roles.join(" / ")} ·{" "}
              {session.unit?.name ?? t("accessDenied.unassignedUnit")}
            </p>
          ) : null}
          <Link href="/admin/dashboard" className={buttonVariants({ className: "mt-7" })}>
            {t("accessDenied.back")}
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
