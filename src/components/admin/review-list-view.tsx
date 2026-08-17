"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Filter, Search } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Pagination } from "@/components/admin/pagination";
import { ResponsiveReviewList } from "@/components/admin/responsive-review-list";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/misc";
import { useAdminState } from "@/services/admin-state-provider";
import { useApplicationServices } from "@/services/application-services-provider";
import type {
  PaginatedResult,
  QualificationReview,
  ReviewAiStatus,
  ReviewHumanStatus,
} from "@/types/services";

const statusOptions = [
  { label: "待审核", value: "pending" },
  { label: "已通过", value: "approved" },
  { label: "已退回", value: "returned" },
  { label: "全部人工状态", value: "all" },
];

const aiOptions = [
  { label: "全部 AI 结果", value: "all" },
  { label: "匹配通过", value: "matched" },
  { label: "存在疑问", value: "question" },
  { label: "信息不一致", value: "mismatch" },
  { label: "不可用", value: "unavailable" },
];

export function ReviewListView() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = useAdminState();
  const { reviews } = useApplicationServices();
  const q = searchParams.get("q") ?? "";
  const status = (searchParams.get("status") ?? "pending") as "all" | ReviewHumanStatus;
  const ai = (searchParams.get("ai") ?? "all") as "all" | ReviewAiStatus;
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const [searchValue, setSearchValue] = React.useState(q);
  const [result, setResult] = React.useState<PaginatedResult<QualificationReview> | null>(null);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [interactive, setInteractive] = React.useState(false);

  React.useEffect(() => setInteractive(true), []);
  React.useEffect(() => setSearchValue(q), [q]);
  React.useEffect(() => {
    let active = true;
    void reviews.list({ q, status, ai, page, pageSize: 4 }).then((response) => {
      if (active) setResult(response.data);
    });
    return () => {
      active = false;
    };
  }, [ai, page, q, reviews, state, status]);

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
    <ReviewFilters
      searchValue={searchValue}
      status={status}
      ai={ai}
      disabled={!interactive}
      onSearchValueChange={setSearchValue}
      onSearch={(value) => updateQuery({ q: value.trim(), page: 1 })}
      onStatusChange={(value) => updateQuery({ status: value, page: 1 })}
      onAiChange={(value) => updateQuery({ ai: value, page: 1 })}
      onReset={() => {
        setSearchValue("");
        router.replace(pathname);
      }}
    />
  );

  return (
    <PageContainer className="space-y-5">
      <AdminPageHeader
        title="待审核资质更新"
        description="默认按提交时间倒序；AI 结果仅作人工复核参考"
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
            aria-label="移动端审核查询"
            name="q"
            disabled={!interactive}
            defaultValue={searchValue}
            key={q}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="姓名、员工号或资质名称..."
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
          <ResponsiveReviewList reviews={result.items} />
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
          <DrawerTitle className="text-lg font-bold">筛选审核队列</DrawerTitle>
          <DrawerDescription className="mt-1 text-sm text-secondary">
            筛选与页码会写入 URL 查询参数。
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

function ReviewFilters({
  searchValue,
  status,
  ai,
  disabled,
  onSearchValueChange,
  onSearch,
  onStatusChange,
  onAiChange,
  onReset,
}: {
  searchValue: string;
  status: string;
  ai: string;
  disabled: boolean;
  onSearchValueChange: (value: string) => void;
  onSearch: (value: string) => void;
  onStatusChange: (value: string) => void;
  onAiChange: (value: string) => void;
  onReset: () => void;
}) {
  return (
    <form
      className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_180px_180px_auto]"
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(String(new FormData(event.currentTarget).get("q") ?? ""));
      }}
    >
      <Input
        aria-label="搜索审核记录"
        name="q"
        disabled={disabled}
        defaultValue={searchValue}
        key={searchValue}
        onChange={(event) => onSearchValueChange(event.target.value)}
        placeholder="姓名、员工号或资质名称..."
      />
      <Select
        aria-label="人工状态"
        name="status"
        disabled={disabled}
        value={status}
        onChange={(event) => onStatusChange(event.target.value)}
        options={statusOptions}
      />
      <Select
        aria-label="AI 结果"
        name="ai"
        disabled={disabled}
        value={ai}
        onChange={(event) => onAiChange(event.target.value)}
        options={aiOptions}
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
