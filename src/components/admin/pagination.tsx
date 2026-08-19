import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";

export function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-secondary">
      <p>{t("common.records", { count: total })}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {t("common.previousPage")}
        </Button>
        <span
          aria-label={t("common.pageLabel", { page, pages: totalPages })}
          className="px-2 font-semibold"
        >
          {page} / {totalPages}
        </span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          {t("common.nextPage")}
        </Button>
      </div>
    </div>
  );
}
