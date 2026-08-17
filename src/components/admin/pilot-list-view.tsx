"use client";

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

const healthOptions = [
  { label: "全部健康度", value: "all" },
  { label: "正常", value: "normal" },
  { label: "临期", value: "expiring" },
  { label: "存在过期", value: "expired" },
];

const upgradeOptions = [
  { label: "全部升级状态", value: "all" },
  { label: "进行中", value: "active" },
  { label: "无活动计划", value: "none" },
];

const statusOptions = [
  { label: "全部人员状态", value: "all" },
  { label: "启用", value: "active" },
  { label: "停用", value: "inactive" },
];

export function PilotListView({ positionCode }: { positionCode?: string } = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = useAdminState();
  const { pilotDirectory } = useApplicationServices();
  const q = searchParams.get("q") ?? "";
  const health = (searchParams.get("health") ?? "all") as "all" | PilotHealth;
  const upgrade = (searchParams.get("upgrade") ?? "all") as PilotUpgradeFilter;
  const status = (searchParams.get("status") ?? "all") as PilotStatusFilter;
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const [searchValue, setSearchValue] = React.useState(q);
  const [result, setResult] = React.useState<PaginatedResult<AdminPilotListItem> | null>(null);
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
  }, [health, page, pilotDirectory, q, revision, state, status, upgrade]);

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
        title={positionCode === "PILOT" ? "飞行员成员管理与资质大盘" : "成员管理与资质大盘"}
        description={
          positionCode
            ? `职位：${positionCode}。新增、批量导入和维护成员，并监控资质健康度`
            : "新增、批量导入和维护成员，并监控全部资质健康度"
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
            aria-label="移动端飞行员查询"
            name="q"
            disabled={!interactive}
            defaultValue={searchValue}
            key={q}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="搜索姓名、员工号..."
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
          筛选
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
          <DrawerTitle className="text-lg font-bold">筛选成员</DrawerTitle>
          <DrawerDescription className="mt-1 text-sm text-secondary">
            筛选会同步到 URL，刷新后仍然保留。
          </DrawerDescription>
          <div className="mt-6">{filters}</div>
          <Button type="button" className="mt-6 w-full" onClick={() => setFiltersOpen(false)}>
            完成
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
        aria-label="搜索姓名或员工号"
        name="q"
        disabled={disabled}
        defaultValue={searchValue}
        key={searchValue}
        onChange={(event) => onSearchValueChange(event.target.value)}
        placeholder="搜索姓名、员工号..."
      />
      <Select
        aria-label="资质健康度"
        name="health"
        disabled={disabled}
        value={health}
        onChange={(event) => onHealthChange(event.target.value)}
        options={healthOptions}
      />
      <Select
        aria-label="升级状态"
        name="upgrade"
        disabled={disabled}
        value={upgrade}
        onChange={(event) => onUpgradeChange(event.target.value)}
        options={upgradeOptions}
      />
      <Select
        aria-label="人员状态"
        name="status"
        disabled={disabled}
        value={status}
        onChange={(event) => onStatusChange(event.target.value)}
        options={statusOptions}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" disabled={disabled}>
          搜索
        </Button>
        <Button type="button" variant="ghost" disabled={disabled} onClick={onReset}>
          重置
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
  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted">
        未找到符合条件的飞行员
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
                "员工号",
                "姓名",
                "当前职务",
                "人员状态",
                "资质健康度",
                "已过期项数",
                "临期项数",
                "活动升级计划",
                "管理操作",
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
                    {pilot.active ? "启用" : "停用"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <PilotHealthBadge health={pilot.health} />
                </td>
                <td className="px-4 py-3">{pilot.expiredCount}</td>
                <td className="px-4 py-3">{pilot.expiringCount}</td>
                <td className="max-w-[240px] px-4 py-3 text-secondary">
                  {pilot.activeUpgradeTitle ?? "无活动计划"}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`${positionCode ? "/admin/members" : "/admin/pilots"}/${pilot.id}`}
                    className="font-semibold text-brand"
                  >
                    查看详情
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
                    {!pilot.active ? <Badge tone="neutral">停用</Badge> : null}
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
                  {pilot.activeUpgradeTitle ?? "无活动升级计划"}
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
