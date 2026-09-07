"use client";

import { useBusinessDayRefresh } from "@/hooks/use-business-day-refresh";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Filter, Search } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PilotManagementActions } from "@/components/admin/pilot-management-dialogs";
import { Pagination } from "@/components/admin/pagination";
import { PilotHealthBadge } from "@/components/admin/status-badges";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/misc";
import { useAdminState } from "@/services/admin-state-provider";
import { useApplicationServices } from "@/services/application-services-provider";
import type {
  AdminPilotListItem,
  PaginatedResult,
  PilotHealth,
  PilotUpgradeFilter,
  PilotStatusFilter,
} from "@/types/services";
import { useI18n } from "@/components/i18n-provider";

export function PilotListView({ positionCode }: { positionCode?: string } = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = useAdminState();
  const { pilotDirectory } = useApplicationServices();
  const { t } = useI18n();
  const q = searchParams.get("q") ?? "";
  const health = (searchParams.get("health") ?? "all") as "all" | PilotHealth;
  const upgrade = (searchParams.get("upgrade") ?? "all") as PilotUpgradeFilter;
  const status = (searchParams.get("status") ?? "all") as PilotStatusFilter;
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const [searchValue, setSearchValue] = React.useState(q);
  const [result, setResult] = React.useState<PaginatedResult<AdminPilotListItem> | null>(null);
  const businessDayRevision = useBusinessDayRefresh(result?.timezones ?? ["Asia/Shanghai"]);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [interactive, setInteractive] = React.useState(false);
  const [revision, setRevision] = React.useState(0);

  React.useEffect(() => setInteractive(true), []);
  React.useEffect(() => setSearchValue(q), [q]);
  React.useEffect(() => {
    let active = true;
    setResult(null);
    void pilotDirectory.list({ q, health, upgrade, status, page, pageSize: 4 }).then((response) => {
      if (active) setResult(response.data);
    });
    return () => {
      active = false;
    };
  }, [health, page, pilotDirectory, q, revision, businessDayRevision, state, status, upgrade]);

  const updateQuery = (patch: Record<string, string | number>) => {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(patch).forEach(([key, value]) => {
      if (!value || value === "all" || (key === "page" && value === 1)) next.delete(key);
      else next.set(key, String(value));
    });
    const query = next.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`);
  };

  const filters = (
    <PilotFilters
      searchValue={searchValue}
      health={health}
      upgrade={upgrade}
      status={status}
      disabled={!interactive}
      onSearchValueChange={setSearchValue}
      onSearch={(value) => updateQuery({ q: value.trim(), page: 1 })}
      onHealthChange={(value) => updateQuery({ health: value, page: 1 })}
      onUpgradeChange={(value) => updateQuery({ upgrade: value, page: 1 })}
      onStatusChange={(value) => updateQuery({ status: value, page: 1 })}
      onReset={() => {
        setSearchValue("");
        router.replace(pathname);
      }}
    />
  );

  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader
        title={
          positionCode === "PILOT"
            ? `${t("portal.pilot")}${t("navigation.members")}`
            : t("navigation.members")
        }
        description={
          positionCode
            ? `${positionCode} · ${t("members.positionDescription")}`
            : t("members.positionDescription")
        }
        action={<PilotManagementActions onCompleted={() => setRevision((value) => value + 1)} />}
      />
      <div className="hidden rounded-lg border border-border bg-card p-4 md:block">{filters}</div>
      <div className="flex gap-2 md:hidden">
        <form
          className="relative min-w-0 flex-1"
          method="get"
          onSubmit={(event) => {
            event.preventDefault();
            updateQuery({
              q: String(new FormData(event.currentTarget).get("q") ?? "").trim(),
              page: 1,
            });
          }}
        >
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted"
          />
          <Input
            aria-label={t("adminPilot.searchNameEmployee")}
            name="q"
            disabled={!interactive}
            defaultValue={searchValue}
            key={q}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder={t("adminPilot.searchPlaceholder")}
            className="pl-9"
          />
        </form>
        <Button
          type="button"
          variant="secondary"
          disabled={!interactive}
          onClick={() => setFiltersOpen(true)}
        >
          <Filter aria-hidden="true" className="size-4" />
          {t("adminPilot.filter")}
        </Button>
      </div>

      {!result ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <>
          <PilotResults items={result.items} positionCode={positionCode} />
          <Pagination
            page={result.page}
            totalPages={result.totalPages}
            total={result.total}
            onPageChange={(nextPage) => updateQuery({ page: nextPage })}
          />
        </>
      )}

      <Drawer open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DrawerContent side="right" className="overflow-y-auto p-5">
          <DrawerTitle className="text-lg font-bold">{t("adminPilot.filterMembers")}</DrawerTitle>
          <DrawerDescription className="mt-1 text-sm text-secondary">
            {t("adminPilot.filterDescription")}
          </DrawerDescription>
          <div className="mt-6">{filters}</div>
          <Button type="button" className="mt-6 w-full" onClick={() => setFiltersOpen(false)}>
            {t("adminPilot.done")}
          </Button>
        </DrawerContent>
      </Drawer>
    </PageContainer>
  );
}

function PilotFilters({
  searchValue,
  health,
  upgrade,
  status,
  disabled,
  onSearchValueChange,
  onSearch,
  onHealthChange,
  onUpgradeChange,
  onStatusChange,
  onReset,
}: {
  searchValue: string;
  health: string;
  upgrade: string;
  status: string;
  disabled: boolean;
  onSearchValueChange: (value: string) => void;
  onSearch: (value: string) => void;
  onHealthChange: (value: string) => void;
  onUpgradeChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const healthOptions = [
    { label: t("adminPilot.allHealth"), value: "all" },
    { label: t("members.health.valid"), value: "normal" },
    { label: t("members.health.unconfigured"), value: "unconfigured" },
    { label: t("members.health.missing"), value: "missing" },
    { label: t("members.health.incomplete"), value: "incomplete" },
    { label: t("adminPilot.expiring"), value: "expiring" },
    { label: t("adminPilot.hasExpired"), value: "expired" },
  ];
  const upgradeOptions = [
    { label: t("adminPilot.allUpgrade"), value: "all" },
    { label: t("adminPilot.inProgress"), value: "active" },
    { label: t("adminPilot.noActivePlan"), value: "none" },
  ];
  const statusOptions = [
    { label: t("adminPilot.allPeople"), value: "all" },
    { label: t("members.active"), value: "active" },
    { label: t("members.inactive"), value: "inactive" },
  ];
  return (
    <form
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_180px_180px_160px_auto]"
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(String(new FormData(event.currentTarget).get("q") ?? ""));
      }}
    >
      <Input
        aria-label={t("adminPilot.searchNameEmployee")}
        name="q"
        disabled={disabled}
        defaultValue={searchValue}
        key={searchValue}
        onChange={(event) => onSearchValueChange(event.target.value)}
        placeholder={t("adminPilot.searchPlaceholder")}
      />
      <Select
        aria-label={t("adminPilot.health")}
        name="health"
        disabled={disabled}
        value={health}
        onChange={(event) => onHealthChange(event.target.value)}
        options={healthOptions}
      />
      <Select
        aria-label={t("adminPilot.upgrade")}
        name="upgrade"
        disabled={disabled}
        value={upgrade}
        onChange={(event) => onUpgradeChange(event.target.value)}
        options={upgradeOptions}
      />
      <Select
        aria-label={t("adminPilot.peopleStatus")}
        name="status"
        disabled={disabled}
        value={status}
        onChange={(event) => onStatusChange(event.target.value)}
        options={statusOptions}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" disabled={disabled}>
          {t("adminPilot.search")}
        </Button>
        <Button type="button" variant="ghost" disabled={disabled} onClick={onReset}>
          {t("adminPilot.reset")}
        </Button>
      </div>
    </form>
  );
}

function PilotResults({
  items,
  positionCode,
}: {
  items: AdminPilotListItem[];
  positionCode?: string;
}) {
  const { t } = useI18n();
  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted">
        {t("adminPilot.noMatch")}
      </div>
    );
  }
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card lg:block">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs text-secondary">
            <tr>
              {[
                t("adminPilot.employeeNumber"),
                t("adminPilot.name"),
                t("adminPilot.role"),
                t("adminPilot.status"),
                t("adminPilot.health"),
                t("adminPilot.expiredCount"),
                t("adminPilot.expiringCount"),
                t("adminPilot.activePlan"),
                t("adminPilot.actions"),
              ].map((heading) => (
                <th key={heading} scope="col" className="px-4 py-3 font-semibold">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((pilot) => (
              <tr
                key={pilot.id}
                className={
                  pilot.active ? "border-t border-border" : "border-t border-border opacity-65"
                }
              >
                <td className="px-4 py-3 font-medium">{pilot.employeeNumber}</td>
                <td className="px-4 py-3 font-semibold">{pilot.displayName}</td>
                <td className="px-4 py-3 text-secondary">
                  {pilot.role}（{pilot.aircraftType}）
                </td>
                <td className="px-4 py-3">
                  <Badge tone={pilot.active ? "success" : "neutral"}>
                    {pilot.active ? t("members.active") : t("members.inactive")}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <PilotHealthBadge health={pilot.health} />
                </td>
                <td className="px-4 py-3">{pilot.expiredCount}</td>
                <td className="px-4 py-3">{pilot.expiringCount}</td>
                <td className="max-w-[240px] px-4 py-3 text-secondary">
                  {pilot.activeUpgradeTitle ?? t("adminPilot.noPlan")}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`${positionCode ? "/admin/members" : "/admin/pilots"}/${pilot.id}`}
                    className="font-semibold text-brand"
                  >
                    {t("members.viewDetails")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 lg:hidden">
        {items.map((pilot) => (
          <Link
            key={pilot.id}
            href={`${positionCode ? "/admin/members" : "/admin/pilots"}/${pilot.id}`}
            className="block"
          >
            <Card className="p-4 shadow-none">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-50 font-bold text-brand">
                  {pilot.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-bold">{pilot.displayName}</p>
                    <span className="text-xs text-muted">{pilot.employeeNumber}</span>
                    {!pilot.active ? <Badge tone="neutral">{t("members.inactive")}</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-secondary">
                    {pilot.role}（{pilot.aircraftType}）
                  </p>
                </div>
                <ChevronRight aria-hidden="true" className="size-5 text-muted" />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                <PilotHealthBadge health={pilot.health} />
                <span className="truncate text-xs text-muted">
                  {pilot.activeUpgradeTitle ?? t("adminPilot.noActiveUpgrade")}
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
