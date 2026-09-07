"use client";

import { useBusinessDayRefresh } from "@/hooks/use-business-day-refresh";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Pencil,
  RotateCcw,
} from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { DateField, Input, Textarea } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import { FieldLabel } from "@/components/ui/form-field";
import { useI18n } from "@/components/i18n-provider";
import { isRemoteServiceMode } from "@/lib/service-mode";
import {
  OPERATIONS_TODAY,
  calendarActiveUpgradeEventsForDay,
  calendarBoundaryEventsForDay,
  calendarDays,
  calendarEventDayKind,
  calendarRange,
  moveCalendarAnchor,
  shanghaiToday,
  summarizeDayQualifications,
  type CalendarEventDayKind,
  validCalendarView,
  validIsoDate,
} from "@/lib/calendar-utils";
import {
  adminQualificationRecordUpdateSchema,
  upgradeStageCompletionSchema,
  upgradeStageRescheduleSchema,
} from "@/lib/admin-operations-validation";
import { calculateExpectedExpiry } from "@/lib/qualification-rules";
import { localizeError } from "@/lib/error-i18n";
import { localizedQualificationText } from "@/lib/messages";
import { localizedQualificationName } from "@/lib/i18n";
import { useAdminState } from "@/services/admin-state-provider";
import { useApplicationServices } from "@/services/application-services-provider";
import { useAdminSession } from "@/services/admin-session-provider";
import type {
  AdminCalendarEvent,
  CalendarDayQualificationRoster,
  CalendarDayQualificationSlot,
  CalendarEventType,
  ReviewCredentialFields,
} from "@/types/services";

const viewOptionKeys = ["agenda", "month", "week", "timeline"] as const;
const defaultCalendarPositionOptions = ["PILOT"];

const weekdayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

type QualificationEditTarget = {
  pilotId: string;
  pilotName: string;
  qualification: CalendarDayQualificationSlot;
};

function eventTone(event: AdminCalendarEvent) {
  if (event.type === "upgrade_stage") return "info" as const;
  return (event.daysRemaining ?? 0) < 0 ? ("danger" as const) : ("warning" as const);
}

function eventTypeLabel(
  event: AdminCalendarEvent,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  if (event.type === "upgrade_stage") return t("calendar.event.upgrade");
  if (event.status === "missing") return t("qualifications.status.missing");
  if (event.status === "incomplete" || event.daysRemaining == null)
    return t("qualifications.status.incomplete");
  return event.daysRemaining < 0 ? t("calendar.event.expired") : t("calendar.event.due");
}

function useMobile() {
  const [mobile, setMobile] = React.useState(false);
  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

function SquadronMultiSelect({
  options,
  value,
  onChange,
  label,
}: {
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  label?: string;
}) {
  const { t } = useI18n();
  const resolvedLabel = label ?? t("calendar.squadron");
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const summary =
    value.length === 0
      ? t("calendar.all", { label: resolvedLabel })
      : value.length === 1
        ? value[0]
        : t("calendar.selected", { count: value.length, label: resolvedLabel });

  const toggle = (option: string) => {
    const next = value.includes(option)
      ? value.filter((item) => item !== option)
      : options.filter((item) => item === option || value.includes(item));
    onChange(next);
  };

  return (
    <div ref={rootRef} className="relative space-y-1">
      <FieldLabel htmlFor={`${listId}-trigger`}>{resolvedLabel}</FieldLabel>
      <button
        id={`${listId}-trigger`}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-border bg-card px-3 text-left text-sm text-primary focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div
          id={listId}
          role="group"
          aria-label={t("calendar.multiSelectAria", { label: resolvedLabel })}
          className="absolute left-0 top-full z-50 mt-1 w-full min-w-56 rounded-md border border-border bg-card p-2 shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-2 pb-2">
            <span className="text-xs font-semibold text-secondary">
              {value.length
                ? t("calendar.selectedItems", { count: value.length })
                : t("calendar.showAll")}
            </span>
            {value.length ? (
              <button
                type="button"
                className="min-h-8 px-1 text-xs font-semibold text-brand"
                onClick={() => onChange([])}
              >
                {t("calendar.clear")}
              </button>
            ) : null}
          </div>
          <div className="mt-1 max-h-60 overflow-y-auto">
            {options.length ? (
              options.map((option) => {
                const checked = value.includes(option);
                return (
                  <label
                    key={option}
                    className="flex min-h-10 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-slate-50"
                  >
                    <span className="relative flex size-4 shrink-0 items-center justify-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(option)}
                        className="peer size-4 appearance-none rounded border border-border checked:border-brand checked:bg-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                      />
                      <Check
                        aria-hidden="true"
                        className="pointer-events-none absolute size-3 text-white opacity-0 peer-checked:opacity-100"
                      />
                    </span>
                    <span className="truncate">{option}</span>
                  </label>
                );
              })
            ) : (
              <p className="px-2 py-3 text-xs text-muted">{t("calendar.noSquadrons")}</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CalendarViewPage() {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = useAdminState();
  const { calendar, pilotDirectory } = useApplicationServices();
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission("operations.write");
  const remoteMode = isRemoteServiceMode();
  const today = remoteMode ? shanghaiToday() : OPERATIONS_TODAY;
  const mobile = useMobile();
  const rawView = searchParams.get("view");
  const rawDate = searchParams.get("date");
  const view = validCalendarView(rawView);
  const anchor = validIsoDate(rawDate, today);
  const rawType = searchParams.get("type");
  const type: "all" | CalendarEventType =
    rawType === "qualification_expiry" || rawType === "upgrade_stage" ? rawType : "all";
  const rawQualification = searchParams.get("qualification");
  const qualification = state.qualificationConfigs.some(
    (item) => item.core && item.qualificationId === rawQualification,
  )
    ? rawQualification!
    : "all";
  const rawUnits = searchParams.get("units") ?? "";
  const rawPositions = searchParams.get("positions") ?? "";
  const [businessTimezones, setBusinessTimezones] = React.useState<string[]>(["Asia/Shanghai"]);
  const businessDayRevision = useBusinessDayRefresh(businessTimezones);
  const [positionOptions, setPositionOptions] = React.useState(defaultCalendarPositionOptions);
  React.useEffect(() => {
    if (!isRemoteServiceMode()) return;
    let active = true;
    void fetch("/api/admin/members/positions", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          data?: { items?: Array<{ code: string; timezones?: string[] }> };
        };
        if (active && response.ok) {
          const codes = body.data?.items?.map((item) => item.code.toUpperCase()) ?? [];
          setPositionOptions(codes.length ? codes : defaultCalendarPositionOptions);
          setBusinessTimezones([
            "Asia/Shanghai",
            ...(body.data?.items?.flatMap((item) => item.timezones ?? []) ?? []),
          ]);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const positions = React.useMemo(
    () =>
      [
        ...new Set(
          rawPositions
            .split(",")
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean),
        ),
      ].filter((position) => positionOptions.includes(position)),
    [positionOptions, rawPositions],
  );
  const squadronOptions = React.useMemo(
    () => [...new Set(state.pilots.map((pilot) => pilot.unit).filter(Boolean))].sort(),
    [state.pilots],
  );
  const squadrons = React.useMemo(() => {
    const requested = [
      ...new Set(
        rawUnits
          .split(",")
          .map((unit) => unit.trim())
          .filter(Boolean),
      ),
    ];
    return squadronOptions.length
      ? requested.filter((unit) => squadronOptions.includes(unit))
      : requested;
  }, [rawUnits, squadronOptions]);
  const q = searchParams.get("q") ?? "";
  const selectedId = searchParams.get("event");
  const [events, setEvents] = React.useState<AdminCalendarEvent[] | null>(null);
  const [selectedEvent, setSelectedEvent] = React.useState<AdminCalendarEvent | null>(null);
  const [roster, setRoster] = React.useState<CalendarDayQualificationRoster | null>(null);
  const [rosterLoading, setRosterLoading] = React.useState(true);
  const [rosterError, setRosterError] = React.useState("");
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [dayDrawerOpen, setDayDrawerOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<QualificationEditTarget | null>(null);
  const [refreshRevision, setRefreshRevision] = React.useState(0);
  const [toastOpen, setToastOpen] = React.useState(false);
  const [error, setError] = React.useState("");
  const range = React.useMemo(() => calendarRange(view, anchor), [anchor, view]);

  const updateParams = React.useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (!value || value === "all" || (key === "view" && value === "month")) next.delete(key);
        else next.set(key, value);
      });
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    const normalized: Record<string, string | null> = {};
    if (rawView && !["agenda", "month", "week", "timeline"].includes(rawView)) {
      normalized.view = "month";
    }
    if (rawDate && rawDate !== anchor) normalized.date = anchor;
    if (rawType && !["all", "qualification_expiry", "upgrade_stage"].includes(rawType)) {
      normalized.type = null;
    }
    if (
      rawQualification &&
      rawQualification !== "all" &&
      !state.qualificationConfigs.some(
        (item) => item.core && item.qualificationId === rawQualification,
      )
    ) {
      normalized.qualification = null;
    }
    if (rawUnits && squadronOptions.length && rawUnits !== squadrons.join(",")) {
      normalized.units = squadrons.join(",") || null;
    }
    if (rawPositions && rawPositions !== positions.join(",")) {
      normalized.positions = positions.join(",") || null;
    }
    if (Object.keys(normalized).length) updateParams(normalized);
  }, [
    anchor,
    rawDate,
    rawQualification,
    rawType,
    rawUnits,
    rawView,
    rawPositions,
    squadronOptions.length,
    squadrons,
    positions,
    state,
    updateParams,
  ]);

  React.useEffect(() => {
    let active = true;
    setError("");
    void calendar
      .listEvents({
        view,
        date: anchor,
        type,
        qualification: qualification as Parameters<typeof calendar.listEvents>[0]["qualification"],
        ...(squadrons.length ? { units: squadrons.join(",") } : {}),
        ...(positions.length ? { positions: positions.join(",") } : {}),
        q,
        ...range,
      })
      .then((result) => {
        if (active) setEvents(result.data);
      })
      .catch((reason: unknown) => {
        if (active) setError(localizeError(reason, t, "calendar.loadError"));
      });
    return () => {
      active = false;
    };
  }, [
    anchor,
    calendar,
    qualification,
    positions,
    q,
    range,
    refreshRevision,
    businessDayRevision,
    squadrons,
    state,
    t,
    type,
    view,
  ]);

  React.useEffect(() => {
    let active = true;
    setRosterLoading(true);
    setRosterError("");
    void calendar
      .getDayQualificationRoster({
        date: anchor,
        type,
        qualification: qualification as Parameters<
          typeof calendar.getDayQualificationRoster
        >[0]["qualification"],
        ...(squadrons.length ? { units: squadrons.join(",") } : {}),
        ...(positions.length ? { positions: positions.join(",") } : {}),
        q,
      })
      .then((result) => {
        if (active) setRoster(result.data);
      })
      .catch((reason: unknown) => {
        if (active) setRosterError(localizeError(reason, t, "calendar.rosterError"));
      })
      .finally(() => {
        if (active) setRosterLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    anchor,
    calendar,
    qualification,
    positions,
    q,
    refreshRevision,
    businessDayRevision,
    squadrons,
    state,
    t,
    type,
  ]);

  React.useEffect(() => {
    let active = true;
    if (!selectedId) {
      setSelectedEvent(null);
      return;
    }
    void calendar
      .getEvent(selectedId)
      .then((result) => {
        if (!active) return;
        setSelectedEvent(result.data);
        if (!result.data) updateParams({ event: null });
      })
      .catch((reason: unknown) => {
        if (active) setError(localizeError(reason, t, "calendar.eventError"));
      });
    return () => {
      active = false;
    };
  }, [calendar, refreshRevision, businessDayRevision, selectedId, state, t, updateParams]);

  const selectDate = (date: string) => {
    setDayDrawerOpen(mobile);
    updateParams({ date, event: null });
  };
  const selectEvent = (event: AdminCalendarEvent | null, date?: string) => {
    setDayDrawerOpen(false);
    updateParams({ event: event?.id ?? null, ...(date ? { date } : {}) });
  };
  const editQualificationEvent = React.useMemo(() => {
    if (selectedEvent?.type !== "qualification_expiry") return null;
    if (
      selectedEvent.qualificationId &&
      selectedEvent.qualificationName &&
      selectedEvent.qualificationRecord &&
      selectedEvent.qualificationValidityRule
    ) {
      return {
        pilotId: selectedEvent.pilotId,
        pilotName: selectedEvent.pilotName,
        qualification: {
          qualificationId: selectedEvent.qualificationId,
          qualificationName: selectedEvent.qualificationName,
          validityRule: selectedEvent.qualificationValidityRule,
          record: selectedEvent.qualificationRecord,
        },
      };
    }
    const pilot = roster?.pilots.find((item) => item.pilotId === selectedEvent.pilotId);
    const slot = pilot?.qualifications.find(
      (item) => item.qualificationId === selectedEvent.qualificationId,
    );
    return pilot && slot
      ? { pilotId: pilot.pilotId, pilotName: pilot.pilotName, qualification: slot }
      : null;
  }, [roster, selectedEvent]);

  const refreshCalendar = () => setRefreshRevision((revision) => revision + 1);
  const activeFilterCount = [
    view !== "month",
    type !== "all",
    squadrons.length > 0,
    positions.length > 0,
    qualification !== "all",
    Boolean(q.trim()),
  ].filter(Boolean).length;

  return (
    <PageContainer className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] lg:gap-x-4">
        <div
          data-testid="calendar-toolbar"
          className="flex flex-nowrap items-center justify-end gap-1 lg:col-start-2 lg:row-start-1"
          aria-label={t("calendar.dateNav")}
        >
          <IconButton
            label={t("calendar.previous")}
            variant="secondary"
            size="sm"
            className="h-9 min-h-9 w-9 px-0"
            onClick={() => updateParams({ date: moveCalendarAnchor(view, anchor, -1) })}
          >
            <ChevronLeft className="size-3.5" />
          </IconButton>
          <Button
            variant="secondary"
            size="sm"
            className="h-9 min-h-9 px-2"
            onClick={() => updateParams({ date: today })}
          >
            <RotateCcw className="size-3.5" /> {t("calendar.today")}
          </Button>
          <IconButton
            label={t("calendar.next")}
            variant="secondary"
            size="sm"
            className="h-9 min-h-9 w-9 px-0"
            onClick={() => updateParams({ date: moveCalendarAnchor(view, anchor, 1) })}
          >
            <ChevronRight className="size-3.5" />
          </IconButton>
          <DateField
            aria-label={t("calendar.selectDate")}
            value={anchor}
            className="h-9 min-h-9 w-[7.75rem] px-2 text-xs"
            onChange={(event) => {
              if (event.target.value) updateParams({ date: event.target.value, event: null });
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="relative h-9 min-h-9 px-2"
            data-testid="calendar-filter-trigger"
            aria-label={
              activeFilterCount
                ? t("calendar.filterActive", { count: activeFilterCount })
                : t("calendar.filter")
            }
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(true)}
          >
            <Filter aria-hidden="true" className="size-3.5" />
            {t("calendar.filter")}
            {activeFilterCount ? (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-brand text-[9px] leading-none text-white"
              >
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {!events ? (
            <Skeleton className="h-96" />
          ) : (
            <>
              {view === "month" ? (
                <MonthCalendar
                  anchor={anchor}
                  events={events}
                  onDate={selectDate}
                  onEvent={selectEvent}
                />
              ) : view === "week" ? (
                <WeekCalendar
                  anchor={anchor}
                  events={events}
                  onDate={selectDate}
                  onEvent={selectEvent}
                />
              ) : view === "timeline" ? (
                <TimelineCalendar events={events} onEvent={selectEvent} />
              ) : (
                <AgendaCalendar events={events} onEvent={selectEvent} />
              )}
            </>
          )}
        </div>
        <aside className="hidden lg:col-start-2 lg:row-start-2 lg:block">
          {selectedEvent ? (
            <EventDetail
              event={selectedEvent}
              onClose={() => selectEvent(null)}
              onEditQualification={
                canWrite && editQualificationEvent
                  ? () => setEditTarget(editQualificationEvent)
                  : undefined
              }
              onUpdated={refreshCalendar}
            />
          ) : (
            <DayQualificationPanel
              date={anchor}
              roster={roster}
              loading={rosterLoading}
              error={rosterError}
              canWrite={canWrite}
              onEdit={setEditTarget}
            />
          )}
        </aside>
      </div>

      <Drawer open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DrawerContent side="right" className="w-[min(25rem,calc(100vw-1rem))] overflow-y-auto p-5">
          <DrawerTitle className="text-lg font-bold">{t("calendar.filterTitle")}</DrawerTitle>
          <DrawerDescription className="mt-1 text-sm text-secondary">
            {t("calendar.filterDescription")}
          </DrawerDescription>
          <div className="mt-6 space-y-4">
            <Select
              label={t("calendar.view")}
              value={view}
              options={viewOptionKeys.map((value) => ({
                value,
                label: t(`calendar.view.${value}`),
              }))}
              onChange={(event) => updateParams({ view: event.target.value })}
            />
            <Select
              label={t("calendar.eventType")}
              value={type}
              options={[
                { label: t("calendar.allEvents"), value: "all" },
                { label: t("calendar.qualificationEvent"), value: "qualification_expiry" },
                { label: t("calendar.event.upgrade"), value: "upgrade_stage" },
              ]}
              onChange={(event) => updateParams({ type: event.target.value })}
            />
            <SquadronMultiSelect
              options={squadronOptions}
              value={squadrons}
              onChange={(next) => updateParams({ units: next.join(",") || null })}
            />
            <SquadronMultiSelect
              label={t("calendar.position")}
              options={positionOptions}
              value={positions}
              onChange={(next) => updateParams({ positions: next.join(",") || null })}
            />
            <Select
              label={t("calendar.qualification")}
              value={qualification}
              options={[
                { label: t("calendar.allCore"), value: "all" },
                ...state.qualificationConfigs
                  .filter((item) => item.core && item.qualificationId)
                  .map((item) => ({
                    label: localizedQualificationName(item.name, item.translations, locale),
                    value: item.qualificationId!,
                  })),
              ]}
              onChange={(event) => updateParams({ qualification: event.target.value })}
            />
            <Input
              label={t("calendar.searchMember")}
              value={q}
              placeholder={t("calendar.searchPlaceholder")}
              onChange={(event) => updateParams({ q: event.target.value })}
            />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                updateParams({
                  view: "month",
                  type: null,
                  units: null,
                  positions: null,
                  qualification: null,
                  q: null,
                })
              }
            >
              {t("calendar.reset")}
            </Button>
            <Button type="button" onClick={() => setFiltersOpen(false)}>
              {t("calendar.done")}
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      {mobile ? (
        <Drawer open={Boolean(selectedEvent)} onOpenChange={(open) => !open && selectEvent(null)}>
          <DrawerContent
            side="right"
            className="w-[min(24rem,calc(100vw-1rem))] overflow-y-auto p-4"
          >
            <DrawerTitle className="text-base font-bold">{t("calendar.detailTitle")}</DrawerTitle>
            <DrawerDescription className="mt-1 text-xs text-muted">
              {t("calendar.detailDescription")}
            </DrawerDescription>
            <div className="mt-4">
              <EventDetail
                event={selectedEvent}
                onClose={() => selectEvent(null)}
                onEditQualification={
                  canWrite && editQualificationEvent
                    ? () => setEditTarget(editQualificationEvent)
                    : undefined
                }
                onUpdated={refreshCalendar}
                compact
              />
            </div>
          </DrawerContent>
        </Drawer>
      ) : null}

      {mobile ? (
        <Drawer open={dayDrawerOpen && !selectedEvent} onOpenChange={setDayDrawerOpen}>
          <DrawerContent
            side="right"
            className="w-[min(24rem,calc(100vw-1rem))] overflow-y-auto p-4"
          >
            <DrawerTitle className="text-base font-bold">
              {t("calendar.dayQualifications", { date: anchor })}
            </DrawerTitle>
            <DrawerDescription className="mt-1 text-xs text-muted">
              {t("calendar.dayDescription")}
            </DrawerDescription>
            <div className="mt-4">
              <DayQualificationPanel
                date={anchor}
                roster={roster}
                loading={rosterLoading}
                error={rosterError}
                canWrite={canWrite}
                onEdit={setEditTarget}
                compact
              />
            </div>
          </DrawerContent>
        </Drawer>
      ) : null}

      <QualificationEditDialog
        target={editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        onSave={async (target, values) => {
          await pilotDirectory.updateQualificationRecord(
            target.pilotId,
            target.qualification.qualificationId,
            {
              ...values,
              expectedVersion: target.qualification.record!.version,
            },
          );
          setEditTarget(null);
          setToastOpen(true);
          refreshCalendar();
        }}
      />
      <Toast
        open={toastOpen}
        title={t("calendar.updatedTitle")}
        tone="success"
        onClose={() => setToastOpen(false)}
      >
        {t("calendar.updatedDescription")}
      </Toast>
    </PageContainer>
  );
}

function countUpgradePlans(events: AdminCalendarEvent[]) {
  return new Set(events.map((event) => event.planId ?? event.id)).size;
}

function calendarEventTitle(
  event: AdminCalendarEvent,
  kind: CalendarEventDayKind | undefined,
  t: (key: string, values?: Record<string, string | number>) => string,
  locale: "zh-CN" | "en-US",
) {
  if (event.type === "qualification_expiry" && event.qualificationName) {
    return `${localizedQualificationName(event.qualificationName, event.qualificationTranslations, locale)} ${t("calendar.expirySuffix")}`;
  }
  if (event.type !== "upgrade_stage") return event.title;
  if (!kind) return event.title;
  if (kind === "start") return `${event.title} · ${t("calendar.start")}`;
  if (kind === "end") return `${event.title} · ${t("calendar.end")}`;
  if (kind === "single") return `${event.title} · ${t("calendar.todayNode")}`;
  return event.title;
}

function MonthCalendar({
  anchor,
  events,
  onDate,
  onEvent,
}: {
  anchor: string;
  events: AdminCalendarEvent[];
  onDate: (date: string) => void;
  onEvent: (event: AdminCalendarEvent, date: string) => void;
}) {
  const { locale, t } = useI18n();
  const days = calendarDays("month", anchor);
  const month = anchor.slice(0, 7);
  const selectedEvents = calendarBoundaryEventsForDay(events, anchor);
  const selectedActiveEvents = calendarActiveUpgradeEventsForDay(events, anchor);
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden shadow-none" data-testid="month-calendar">
        <div role="grid" aria-label={t("calendar.dayGrid")} className="grid grid-cols-7">
          <div role="row" className="contents">
            {weekdayKeys.map((day) => (
              <div
                role="columnheader"
                key={day}
                className="border-b border-border bg-slate-50 px-1 py-2 text-center text-[10px] font-semibold text-secondary sm:text-xs"
              >
                {t(`calendar.week.${day}`)}
              </div>
            ))}
          </div>
          <div role="row" className="contents">
            {days.map((day) => {
              const dayEvents = calendarBoundaryEventsForDay(events, day);
              const activeEvents = calendarActiveUpgradeEventsForDay(events, day);
              const activeUpgradeCount = countUpgradePlans(activeEvents);
              const markerCount = dayEvents.length + activeEvents.length;
              return (
                <div
                  role="gridcell"
                  key={day}
                  className={`min-h-16 min-w-0 border-b border-r border-border p-1 text-left sm:min-h-[92px] sm:p-2 ${day === anchor ? "bg-blue-50" : day.startsWith(month) ? "bg-card" : "bg-slate-50 text-muted"}`}
                >
                  <button
                    type="button"
                    aria-label={t("calendar.dayAria", {
                      date: day,
                      events: dayEvents.length,
                      upgrades: activeUpgradeCount,
                    })}
                    onClick={() => onDate(day)}
                    className="flex w-full items-center gap-1.5 text-left"
                  >
                    <span className="text-[11px] font-semibold sm:text-xs">
                      {Number(day.slice(-2))}
                    </span>
                    {activeUpgradeCount ? (
                      <span className="hidden shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-secondary sm:inline-flex">
                        {t("calendar.upgradeCount", { count: activeUpgradeCount })}
                      </span>
                    ) : null}
                    {markerCount ? (
                      <span className="block size-1.5 rounded-full bg-brand sm:hidden" />
                    ) : null}
                  </button>
                  <div className="mt-1 hidden space-y-1 sm:block">
                    {dayEvents.slice(0, 2).map((event) => (
                      <button
                        type="button"
                        key={event.id}
                        onClick={() => onEvent(event, day)}
                        className={`block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-semibold ${event.type === "upgrade_stage" ? "bg-blue-50 text-info" : (event.daysRemaining ?? 0) < 0 ? "bg-red-50 text-danger" : "bg-orange-50 text-warning"}`}
                      >
                        {event.pilotName} ·{" "}
                        {calendarEventTitle(event, calendarEventDayKind(event, day), t, locale)}
                      </button>
                    ))}
                    {dayEvents.length > 2 ? (
                      <span className="block text-[10px] text-muted">
                        {t("calendar.more", { count: dayEvents.length - 2 })}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
      <div className="space-y-2 sm:hidden">
        <h3 className="text-sm font-bold">{t("calendar.dayEvents", { date: anchor })}</h3>
        {selectedEvents.length ? (
          selectedEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              dayKind={calendarEventDayKind(event, anchor)}
              onClick={() => onEvent(event, anchor)}
            />
          ))
        ) : !selectedActiveEvents.length ? (
          <EmptyState title={t("calendar.noEvents")} description={t("calendar.otherDate")} />
        ) : null}
        {selectedActiveEvents.length ? (
          <button
            type="button"
            onClick={() => onDate(anchor)}
            className="w-full rounded-lg border border-blue-100 bg-blue-50 p-3 text-left text-xs font-semibold text-info"
          >
            {t("calendar.activePlans", { count: countUpgradePlans(selectedActiveEvents) })}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function WeekCalendar({
  anchor,
  events,
  onDate,
  onEvent,
}: {
  anchor: string;
  events: AdminCalendarEvent[];
  onDate: (date: string) => void;
  onEvent: (event: AdminCalendarEvent, date?: string) => void;
}) {
  const { t } = useI18n();
  const days = calendarDays("week", anchor);
  return (
    <Card className="overflow-x-auto shadow-none" data-testid="week-calendar">
      <div className="grid min-w-[840px] grid-cols-7">
        {days.map((day, index) => (
          <section key={day} className="min-h-96 border-r border-border p-2 last:border-r-0">
            <h3 className="border-b border-border pb-2 text-xs font-bold">
              {t(`calendar.week.${weekdayKeys[index]}`)} · {day.slice(5)}
            </h3>
            <div className="mt-2 space-y-2">
              {calendarBoundaryEventsForDay(events, day).map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  dayKind={calendarEventDayKind(event, day)}
                  onClick={() => onEvent(event, day)}
                  compact
                />
              ))}
              {calendarActiveUpgradeEventsForDay(events, day).length ? (
                <button
                  type="button"
                  onClick={() => onDate(day)}
                  className="w-full rounded border border-blue-100 bg-blue-50 p-2 text-left text-[11px] font-semibold text-info hover:bg-blue-100"
                >
                  {t("calendar.activePlanShort", {
                    count: countUpgradePlans(calendarActiveUpgradeEventsForDay(events, day)),
                  })}
                </button>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </Card>
  );
}

function AgendaCalendar({
  events,
  onEvent,
}: {
  events: AdminCalendarEvent[];
  onEvent: (event: AdminCalendarEvent) => void;
}) {
  const { t } = useI18n();
  const groups = Map.groupBy(events, (event) => event.date);
  if (!events.length)
    return <EmptyState title={t("calendar.noAgenda")} description={t("calendar.adjustQuery")} />;
  return (
    <div className="space-y-4" data-testid="agenda-calendar">
      {[...groups.entries()].map(([date, items]) => (
        <section key={date}>
          <h3 className="mb-2 text-sm font-bold">{date}</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {items.map((event) => (
              <EventCard key={event.id} event={event} onClick={() => onEvent(event)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TimelineCalendar({
  events,
  onEvent,
}: {
  events: AdminCalendarEvent[];
  onEvent: (event: AdminCalendarEvent) => void;
}) {
  const { t } = useI18n();
  const groups = Map.groupBy(
    events,
    (event) => `${event.pilotId}|${event.pilotName}|${event.employeeNumber}`,
  );
  if (!events.length)
    return (
      <EmptyState title={t("calendar.noPeopleEvents")} description={t("calendar.adjustFilter")} />
    );
  return (
    <Card className="overflow-x-auto p-3 shadow-none" data-testid="timeline-calendar">
      <div className="min-w-[720px] space-y-3">
        {[...groups.entries()].map(([key, items]) => {
          const [, name, number] = key.split("|");
          return (
            <section
              key={key}
              className="grid grid-cols-[170px_1fr] gap-3 border-b border-border pb-3"
            >
              <div>
                <p className="text-sm font-bold">{name}</p>
                <p className="text-xs text-muted">{number}</p>
              </div>
              <div className="flex gap-2 overflow-x-auto">
                {items.map((event) => (
                  <div key={event.id} className="w-56 shrink-0">
                    <EventCard event={event} onClick={() => onEvent(event)} compact />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </Card>
  );
}

function EventCard({
  event,
  onClick,
  compact = false,
  dayKind,
}: {
  event: AdminCalendarEvent;
  onClick: () => void;
  compact?: boolean;
  dayKind?: CalendarEventDayKind;
}) {
  const { locale, t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border border-border bg-card text-left hover:border-brand ${compact ? "p-2" : "p-3"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-xs font-bold">
          {calendarEventTitle(event, dayKind, t, locale)}
        </p>
        <Badge tone={eventTone(event)} className="shrink-0 py-0.5 text-[10px]">
          {eventTypeLabel(event, t)}
        </Badge>
      </div>
      <p className="mt-1 truncate text-xs text-secondary">
        {event.pilotName} · {event.employeeNumber} · {event.unit}
      </p>
      <p className="mt-1 text-[10px] text-muted">
        {event.date}
        {event.endDate !== event.date ? ` ${t("calendar.rangeTo")} ${event.endDate}` : ""}
      </p>
    </button>
  );
}

function qualificationTone(record: NonNullable<CalendarDayQualificationSlot["record"]>) {
  if (record.status === "expired" || record.status === "missing") return "danger" as const;
  if (record.status === "incomplete") return "warning" as const;
  if (record.status === "due_30" || record.status === "due_90") return "warning" as const;
  return "success" as const;
}

function DayQualificationPanel({
  date,
  roster,
  loading,
  error,
  canWrite,
  onEdit,
  compact = false,
}: {
  date: string;
  roster: CalendarDayQualificationRoster | null;
  loading: boolean;
  error: string;
  canWrite: boolean;
  onEdit: (target: QualificationEditTarget) => void;
  compact?: boolean;
}) {
  const { locale, t } = useI18n();
  return (
    <Card
      className={
        compact
          ? "border-0 shadow-none"
          : "sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto p-4 shadow-none"
      }
      data-testid="calendar-day-qualification-roster"
    >
      <div>
        <h2 className="text-base font-bold">{t("calendar.dayRoster", { date })}</h2>
        <p className="mt-1 text-xs text-muted">
          {roster
            ? t("calendar.rosterSummary", {
                people: roster.pilots.length,
                events: roster.eventCount,
              })
            : t("calendar.rosterStatus")}
        </p>
      </div>
      {error ? (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      ) : loading ? (
        <Skeleton className="mt-4 h-64" />
      ) : !roster?.pilots.length ? (
        <div className="mt-4">
          <EmptyState title={t("calendar.noRoster")} description={t("calendar.adjustDateFilter")} />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {roster.pilots.map((pilot) => (
            <section
              key={pilot.pilotId}
              className="rounded-lg border border-border p-3"
              data-testid={`calendar-day-pilot-${pilot.pilotId}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-bold">{pilot.pilotName}</h3>
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    {pilot.employeeNumber} · {pilot.unit}
                  </p>
                </div>
                <Link
                  href={`/admin/pilots/${pilot.pilotId}`}
                  className="shrink-0 text-xs font-semibold text-brand"
                >
                  {t("calendar.profile")}
                </Link>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {pilot.nodes.map((node) => (
                  <Badge key={node.id} tone={node.type === "upgrade_stage" ? "info" : "warning"}>
                    {node.type === "qualification_expiry"
                      ? calendarEventTitle(node, undefined, t, locale)
                      : node.title}
                  </Badge>
                ))}
              </div>
              {(() => {
                const summary = summarizeDayQualifications(pilot.qualifications);
                return (
                  <>
                    {summary.attention.length ? (
                      <div className="mt-3 divide-y divide-border border-t border-border">
                        {summary.attention.map((qualification) => {
                          const record = qualification.record;
                          const statusLabel =
                            record?.daysRemaining === 0
                              ? t("calendar.expiryToday")
                              : record
                                ? localizedQualificationText(record.statusLabel, t)
                                : undefined;
                          return (
                            <div
                              key={qualification.qualificationId}
                              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-xs font-semibold">
                                  {localizedQualificationName(
                                    qualification.qualificationName,
                                    qualification.qualificationTranslations,
                                    locale,
                                  )}
                                </p>
                                {record ? (
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                    <span className="text-[11px] text-muted">
                                      {record.expiryDate ||
                                        (record.statusReason === "non_expiring"
                                          ? t("calendar.expiryLong")
                                          : t("qualifications.status.incomplete"))}
                                    </span>
                                    <Badge
                                      tone={qualificationTone(record)}
                                      className="py-0.5 text-[10px]"
                                    >
                                      {statusLabel}
                                    </Badge>
                                  </div>
                                ) : (
                                  <Badge tone="neutral" className="mt-1 py-0.5 text-[10px]">
                                    {t("calendar.notFiled")}
                                  </Badge>
                                )}
                              </div>
                              {canWrite && record ? (
                                <IconButton
                                  label={t("calendar.editQualification", {
                                    pilot: pilot.pilotName,
                                    qualification: localizedQualificationName(
                                      qualification.qualificationName,
                                      qualification.qualificationTranslations,
                                      locale,
                                    ),
                                  })}
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    onEdit({
                                      pilotId: pilot.pilotId,
                                      pilotName: pilot.pilotName,
                                      qualification,
                                    })
                                  }
                                >
                                  <Pencil className="size-3.5" />
                                </IconButton>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {summary.normalCount || summary.missingCount ? (
                      <p className="mt-2 text-[11px] text-muted">
                        {summary.normalCount
                          ? t("calendar.otherNormal", { count: summary.normalCount })
                          : null}
                        {summary.normalCount && summary.missingCount ? " · " : null}
                        {summary.missingCount
                          ? t("calendar.otherMissing", { count: summary.missingCount })
                          : null}
                      </p>
                    ) : null}
                  </>
                );
              })()}
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

function QualificationEditDialog({
  target,
  onOpenChange,
  onSave,
}: {
  target: QualificationEditTarget | null;
  onOpenChange: (open: boolean) => void;
  onSave: (target: QualificationEditTarget, values: ReviewCredentialFields) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const record = target?.qualification.record;
  const [values, setValues] = React.useState<ReviewCredentialFields>({
    credentialNumber: "",
    issueDate: "",
    trainingDate: "",
    expiryDate: "",
    issuingAuthority: "",
    levelOrParameter: "",
  });
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!record) return;
    setValues({
      credentialNumber: record.credentialNumber,
      issueDate: record.issueDate,
      trainingDate: record.trainingDate,
      expiryDate: record.expiryDate,
      issuingAuthority: record.issuingAuthority,
      levelOrParameter: record.levelOrParameter,
    });
    setFieldErrors({});
    setError("");
  }, [record]);

  React.useEffect(() => {
    const rule = target?.qualification.validityRule;
    if (!rule) return;
    if (rule.kind === "non_expiring") {
      setValues((current) => (current.expiryDate ? { ...current, expiryDate: "" } : current));
      return;
    }
    if (rule.kind !== "fixed_months") return;
    const expected = calculateExpectedExpiry(
      {
        issueDate: values.issueDate,
        trainingDate: values.trainingDate,
      },
      rule,
    );
    if (expected && expected !== values.expiryDate) {
      setValues((current) => ({ ...current, expiryDate: expected }));
    }
  }, [
    target?.qualification.validityRule,
    values.issueDate,
    values.trainingDate,
    values.expiryDate,
  ]);

  const update = (field: keyof ReviewCredentialFields, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));
  const unchanged = Boolean(
    record &&
    (Object.keys(values) as Array<keyof ReviewCredentialFields>).every(
      (field) => values[field] === record[field],
    ),
  );
  const save = async () => {
    if (!target || !record || loading) return;
    setError("");
    setFieldErrors({});
    const validation = adminQualificationRecordUpdateSchema.safeParse({
      ...values,
      expectedVersion: record.version,
    });
    if (!validation.success) {
      const next = Object.fromEntries(
        validation.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
      );
      setFieldErrors(next);
      setError(validation.error.issues[0]?.message ?? t("calendar.checkFields"));
      return;
    }
    if (target.qualification.validityRule.kind === "manual_expiry" && !values.expiryDate) {
      setFieldErrors({ expiryDate: t("calendar.fillExpiry") });
      setError(t("calendar.fillExpiry"));
      return;
    }
    setLoading(true);
    try {
      await onSave(target, values);
    } catch (reason) {
      setError(localizeError(reason, t, "calendar.qualificationSaveError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={Boolean(target && record)}
      onOpenChange={(open) => !loading && onOpenChange(open)}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle className="text-lg font-bold">{t("calendar.editTitle")}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted">
          {t("calendar.editDescription", {
            pilot: target?.pilotName ?? "",
            qualification: target
              ? localizedQualificationName(
                  target.qualification.qualificationName,
                  target.qualification.qualificationTranslations,
                  locale,
                )
              : "",
          })}
        </DialogDescription>
        <div className="mt-4 space-y-3">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Input
            label={t("calendar.credentialNumber")}
            required
            value={values.credentialNumber}
            onChange={(event) => update("credentialNumber", event.target.value)}
            error={fieldErrors.credentialNumber}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <DateField
              label={t("calendar.issueDate")}
              required
              value={values.issueDate}
              onChange={(event) => update("issueDate", event.target.value)}
              error={fieldErrors.issueDate}
            />
            {target?.qualification.validityRule.kind === "fixed_months" &&
            target.qualification.validityRule.baseDateField === "trainingDate" ? (
              <DateField
                label={t("calendar.trainingDate")}
                required
                value={values.trainingDate}
                onChange={(event) => update("trainingDate", event.target.value)}
                error={fieldErrors.trainingDate}
              />
            ) : null}
            {target?.qualification.validityRule.kind !== "non_expiring" ? (
              <DateField
                label={t("calendar.expiryDate")}
                required
                readOnly={target?.qualification.validityRule.kind === "fixed_months"}
                value={values.expiryDate}
                onChange={(event) => update("expiryDate", event.target.value)}
                error={fieldErrors.expiryDate}
              />
            ) : null}
          </div>
          <Input
            label={t("calendar.issuingAuthority")}
            required
            value={values.issuingAuthority}
            onChange={(event) => update("issuingAuthority", event.target.value)}
            error={fieldErrors.issuingAuthority}
          />
          <Input
            label={t("calendar.level")}
            required
            value={values.levelOrParameter}
            onChange={(event) => update("levelOrParameter", event.target.value)}
            error={fieldErrors.levelOrParameter}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
              {t("common.cancel")}
            </Button>
            <Button loading={loading} disabled={unchanged} onClick={() => void save()}>
              {t("calendar.saveQualification")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EventDetail({
  event,
  onClose,
  onEditQualification,
  onUpdated,
  compact = false,
}: {
  event: AdminCalendarEvent | null;
  onClose: () => void;
  onEditQualification?: () => void;
  onUpdated?: () => void;
  compact?: boolean;
}) {
  const { locale, t } = useI18n();
  const { upgradePlans } = useApplicationServices();
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission("operations.write");
  const [rescheduleOpen, setRescheduleOpen] = React.useState(false);
  const [completeOpen, setCompleteOpen] = React.useState(false);
  const [start, setStart] = React.useState(event?.date ?? "");
  const [end, setEnd] = React.useState(event?.endDate ?? "");
  const [notes, setNotes] = React.useState(event?.notes ?? "");
  const [completedOn, setCompletedOn] = React.useState(event?.date ?? "");
  const [result, setResult] = React.useState("");
  const [error, setError] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    setStart(event?.date ?? "");
    setEnd(event?.endDate ?? "");
    setNotes(event?.notes ?? "");
    setCompletedOn(event?.date ?? "");
    setResult("");
    setError("");
    setFieldErrors({});
  }, [event]);
  if (!event)
    return <Card className="p-5 text-sm text-muted shadow-none">{t("calendar.selectEvent")}</Card>;
  const reschedule = async () => {
    if (!event.planId || !event.stageId || loading) return;
    setError("");
    setFieldErrors({});
    const validation = upgradeStageRescheduleSchema.safeParse({
      plannedStart: start,
      plannedEnd: end,
      notes,
    });
    if (!validation.success) {
      const next = Object.fromEntries(
        validation.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
      );
      setFieldErrors(next);
      setError(validation.error.issues[0]?.message ?? t("calendar.checkDates"));
      return;
    }
    setLoading(true);
    try {
      await upgradePlans.rescheduleStage(event.planId, event.stageId, {
        plannedStart: start,
        plannedEnd: end,
        notes,
      });
      setRescheduleOpen(false);
      onUpdated?.();
    } catch (reason) {
      const message = localizeError(reason, t, "calendar.adjustError");
      setError(message);
      setFieldErrors({ plannedStart: message, plannedEnd: message });
    } finally {
      setLoading(false);
    }
  };
  const complete = async () => {
    if (!event.planId || !event.stageId || loading) return;
    setError("");
    setFieldErrors({});
    const validation = upgradeStageCompletionSchema.safeParse({
      completedOn,
      resultSummary: result,
    });
    if (!validation.success) {
      setFieldErrors(
        Object.fromEntries(
          validation.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      setError(validation.error.issues[0]?.message ?? t("calendar.checkResult"));
      return;
    }
    setLoading(true);
    try {
      await upgradePlans.completeStage(event.planId, event.stageId, {
        completedOn,
        resultSummary: result,
      });
      setCompleteOpen(false);
      onUpdated?.();
    } catch (reason) {
      setError(localizeError(reason, t, "calendar.recordError"));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Card
      className={compact ? "border-0 shadow-none" : "sticky top-20 p-5 shadow-none"}
      data-testid="calendar-event-detail"
    >
      <div className="flex items-start justify-between gap-2">
        <Badge tone={eventTone(event)}>{eventTypeLabel(event, t)}</Badge>
        {!compact ? (
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("calendar.close")}
          </Button>
        ) : null}
      </div>
      <h3 className="mt-3 text-lg font-bold">
        {event.type === "qualification_expiry"
          ? calendarEventTitle(event, undefined, t, locale)
          : event.title}
      </h3>
      <dl className="mt-4 grid grid-cols-[88px_1fr] gap-x-3 gap-y-3 text-sm">
        <dt className="text-muted">{t("calendar.planObject")}</dt>
        <dd className="font-semibold">
          {event.pilotName}（{event.employeeNumber}）
        </dd>
        <dt className="text-muted">{t("calendar.unit")}</dt>
        <dd>{event.unit}</dd>
        <dt className="text-muted">{t("calendar.job")}</dt>
        <dd>
          {event.positionName ??
            (event.positionCode === "PILOT" ? t("positions.pilot") : (event.positionCode ?? "—"))}
        </dd>
        {event.type === "qualification_expiry" ? (
          <>
            <dt className="text-muted">{t("calendar.qualificationItem")}</dt>
            <dd>
              {localizedQualificationName(
                event.qualificationName ?? "",
                event.qualificationTranslations,
                locale,
              )}
            </dd>
            <dt className="text-muted">{t("calendar.expiryDate")}</dt>
            <dd>{event.date}</dd>
            <dt className="text-muted">{t("calendar.remainingLabel")}</dt>
            <dd>
              {typeof event.daysRemaining !== "number"
                ? t(
                    event.statusReason === "non_expiring"
                      ? "qualifications.status.longTerm"
                      : "qualifications.reviewRequired",
                  )
                : event.daysRemaining < 0
                  ? t("calendar.expiredDays", { days: Math.abs(event.daysRemaining) })
                  : event.daysRemaining === 0
                    ? t("calendar.expiryToday")
                    : t("calendar.remainingDays", { days: event.daysRemaining })}
            </dd>
          </>
        ) : (
          <>
            <dt className="text-muted">{t("calendar.plan")}</dt>
            <dd>
              {event.planNumber} · {event.planTitle}
            </dd>
            <dt className="text-muted">{t("calendar.stagePeriod")}</dt>
            <dd>
              {event.date} {t("calendar.rangeTo")} {event.endDate}
            </dd>
            <dt className="text-muted">{t("calendar.owner")}</dt>
            <dd>{event.owner}</dd>
            <dt className="text-muted">{t("calendar.status")}</dt>
            <dd>
              {event.stageStatus}
              {event.planLifecycleStatus
                ? ` · ${t(`upgradePlans.lifecycle.${event.planLifecycleStatus}`)}`
                : ""}
            </dd>
            <dt className="text-muted">{t("calendar.notes")}</dt>
            <dd>{event.notes || t("calendar.none")}</dd>
            <dt className="text-muted">{t("calendar.inspection")}</dt>
            <dd>{event.inspectionItems?.join(" · ") || t("calendar.none")}</dd>
          </>
        )}
      </dl>
      {event.type === "qualification_expiry" ? (
        <div className="mt-5">
          <Alert tone="info">{t("calendar.expiryLinked")}</Alert>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {canWrite && onEditQualification ? (
              <Button variant="secondary" onClick={onEditQualification}>
                <Pencil className="size-4" /> {t("calendar.editThis")}
              </Button>
            ) : null}
            <Link
              href={`/admin/pilots/${event.pilotId}`}
              className="inline-flex min-h-11 items-center justify-center text-sm font-semibold text-brand"
            >
              {t("calendar.pilotProfile")}
            </Link>
          </div>
        </div>
      ) : event.readonly || !canWrite ? (
        <Alert tone="info" className="mt-5">
          {event.readonly ? t("calendar.readonlyHistory") : t("calendar.readonlyPermission")}
        </Alert>
      ) : (
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Button
            variant="secondary"
            onClick={() => {
              setError("");
              setFieldErrors({});
              setRescheduleOpen(true);
            }}
          >
            {t("calendar.reschedule")}
          </Button>
          <Button
            onClick={() => {
              setError("");
              setFieldErrors({});
              setCompleteOpen(true);
            }}
            disabled={event.stageStatus === "completed" || event.planLifecycleStatus !== "active"}
          >
            {t("calendar.completeResult")}
          </Button>
          {event.planLifecycleStatus !== "active" ? (
            <p className="col-span-full text-xs text-muted">{t("calendar.activeOnly")}</p>
          ) : null}
          <Link
            href={`/admin/upgrade-plans/${event.planId}`}
            className="col-span-full inline-flex min-h-11 items-center justify-center text-sm font-semibold text-brand"
          >
            {t("calendar.viewPlan")}
          </Link>
        </div>
      )}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent>
          <DialogTitle className="text-lg font-bold">{t("calendar.rescheduleTitle")}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted">
            {t("calendar.rescheduleDescription")}
          </DialogDescription>
          <div className="mt-4 space-y-3">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <DateField
              label={t("calendar.plannedStart")}
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
              error={fieldErrors.plannedStart}
            />
            <DateField
              label={t("calendar.plannedEnd")}
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              error={fieldErrors.plannedEnd}
            />
            <Textarea
              label={t("calendar.note")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRescheduleOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button loading={loading} onClick={() => void reschedule()}>
                {t("calendar.saveAdjustment")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent>
          <DialogTitle className="text-lg font-bold">{t("calendar.completeTitle")}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted">
            {t("calendar.completeDescription")}
          </DialogDescription>
          <div className="mt-4 space-y-3">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <DateField
              label={t("calendar.completionDate")}
              required
              value={completedOn}
              onChange={(e) => setCompletedOn(e.target.value)}
              error={fieldErrors.completedOn}
            />
            <Textarea
              label={t("calendar.resultSummary")}
              required
              value={result}
              onChange={(e) => setResult(e.target.value)}
              error={fieldErrors.resultSummary}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCompleteOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button loading={loading} onClick={() => void complete()}>
                {t("calendar.confirmComplete")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
