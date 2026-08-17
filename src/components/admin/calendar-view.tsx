"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Pencil, RotateCcw } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
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
import { isRemoteServiceMode } from "@/lib/service-mode";
import {
  OPERATIONS_TODAY,
  calendarDays,
  calendarRange,
  moveCalendarAnchor,
  shanghaiToday,
  validCalendarView,
  validIsoDate,
} from "@/lib/calendar-utils";
import { lifecycleLabels } from "@/lib/admin-labels";
import {
  adminQualificationRecordUpdateSchema,
  upgradeStageCompletionSchema,
  upgradeStageRescheduleSchema,
} from "@/lib/admin-operations-validation";
import { calculateExpectedExpiry } from "@/lib/qualification-rules";
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

const viewOptions = [
  { label: "90天列表", value: "agenda" },
  { label: "月历", value: "month" },
  { label: "周历", value: "week" },
  { label: "人员时间线", value: "timeline" },
];
const defaultCalendarPositionOptions = ["PILOT"];

const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

type QualificationEditTarget = {
  pilotId: string;
  pilotName: string;
  qualification: CalendarDayQualificationSlot;
};

function eventTone(event: AdminCalendarEvent) {
  if (event.type === "upgrade_stage") return "info" as const;
  return (event.daysRemaining ?? 0) < 0 ? ("danger" as const) : ("warning" as const);
}

function eventTypeLabel(event: AdminCalendarEvent) {
  if (event.type === "upgrade_stage") return "升级节点";
  return (event.daysRemaining ?? 0) < 0 ? "资质过期" : "资质临期";
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
  label = "中队",
}: {
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  label?: string;
}) {
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
      ? `全部${label}`
      : value.length === 1
        ? value[0]
        : `已选 ${value.length} 个${label}`;

  const toggle = (option: string) => {
    const next = value.includes(option)
      ? value.filter((item) => item !== option)
      : options.filter((item) => item === option || value.includes(item));
    onChange(next);
  };

  return (
    <div ref={rootRef} className="relative space-y-1.5">
      <FieldLabel htmlFor={`${listId}-trigger`}>{label}</FieldLabel>
      <button
        id={`${listId}-trigger`}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-border bg-card px-3 text-left text-sm text-primary focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
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
          aria-label={`选择${label}，可多选`}
          className="absolute left-0 top-full z-50 mt-1 w-full min-w-56 rounded-md border border-border bg-card p-2 shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-2 pb-2">
            <span className="text-xs font-semibold text-secondary">
              {value.length ? `已选择 ${value.length} 项` : "当前显示全部"}
            </span>
            {value.length ? (
              <button
                type="button"
                className="min-h-8 px-1 text-xs font-semibold text-brand"
                onClick={() => onChange([])}
              >
                清除
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
              <p className="px-2 py-3 text-xs text-muted">暂无可筛选的中队</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CalendarViewPage() {
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
  const [positionOptions, setPositionOptions] = React.useState(defaultCalendarPositionOptions);
  React.useEffect(() => {
    if (!isRemoteServiceMode()) return;
    let active = true;
    void fetch("/api/admin/members/positions", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          data?: { items?: Array<{ code: string }> };
        };
        if (active && response.ok) {
          const codes = body.data?.items?.map((item) => item.code.toUpperCase()) ?? [];
          setPositionOptions(codes.length ? codes : defaultCalendarPositionOptions);
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
        if (active) setError(reason instanceof Error ? reason.message : "日历加载失败");
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
    squadrons,
    state,
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
        if (active) setRosterError(reason instanceof Error ? reason.message : "人员资质加载失败");
      })
      .finally(() => {
        if (active) setRosterLoading(false);
      });
    return () => {
      active = false;
    };
  }, [anchor, calendar, qualification, positions, q, refreshRevision, squadrons, state, type]);

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
        if (active) setError(reason instanceof Error ? reason.message : "事件详情加载失败");
      });
    return () => {
      active = false;
    };
  }, [calendar, refreshRevision, selectedId, state, updateParams]);

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

  return (
    <PageContainer className="space-y-4">
      <AdminPageHeader
        title="统一日历"
        description="资质事件来自生效记录，升级事件来自计划节点；日历不保存静态副本"
      />

      <Card className="grid gap-3 p-3 shadow-none md:grid-cols-2 xl:grid-cols-[150px_160px_180px_180px_220px_minmax(180px,1fr)]">
        <Select
          label="视图"
          value={view}
          options={viewOptions}
          onChange={(event) => updateParams({ view: event.target.value })}
        />
        <Select
          label="事件类型"
          value={type}
          options={[
            { label: "全部事件", value: "all" },
            { label: "资质到期/临期", value: "qualification_expiry" },
            { label: "升级节点", value: "upgrade_stage" },
          ]}
          onChange={(event) => updateParams({ type: event.target.value })}
        />
        <SquadronMultiSelect
          options={squadronOptions}
          value={squadrons}
          onChange={(next) => updateParams({ units: next.join(",") || null })}
        />
        <SquadronMultiSelect
          label="职位"
          options={positionOptions}
          value={positions}
          onChange={(next) => updateParams({ positions: next.join(",") || null })}
        />
        <Select
          label="资质项目"
          value={qualification}
          options={[
            { label: "全部六项核心资质", value: "all" },
            ...state.qualificationConfigs
              .filter((item) => item.core && item.qualificationId)
              .map((item) => ({ label: item.name, value: item.qualificationId! })),
          ]}
          onChange={(event) => updateParams({ qualification: event.target.value })}
        />
        <Input
          label="搜索成员"
          value={q}
          placeholder="姓名或员工号"
          onChange={(event) => updateParams({ q: event.target.value })}
        />
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <IconButton
            label="上一周期"
            variant="secondary"
            onClick={() => updateParams({ date: moveCalendarAnchor(view, anchor, -1) })}
          >
            <ChevronLeft className="size-4" />
          </IconButton>
          <Button variant="secondary" onClick={() => updateParams({ date: today })}>
            <RotateCcw className="size-4" /> 回到今天
          </Button>
          <IconButton
            label="下一周期"
            variant="secondary"
            onClick={() => updateParams({ date: moveCalendarAnchor(view, anchor, 1) })}
          >
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
        <p className="text-sm font-bold">
          {view === "month"
            ? format(parseISO(anchor), "yyyy年M月", { locale: zhCN })
            : `${range.from} 至 ${range.to}`}
        </p>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!events ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            {view === "month" ? (
              <MonthCalendar
                anchor={anchor}
                events={events}
                onDate={selectDate}
                onEvent={selectEvent}
              />
            ) : view === "week" ? (
              <WeekCalendar anchor={anchor} events={events} onEvent={selectEvent} />
            ) : view === "timeline" ? (
              <TimelineCalendar events={events} onEvent={selectEvent} />
            ) : (
              <AgendaCalendar events={events} onEvent={selectEvent} />
            )}
          </div>
          <aside className="hidden lg:block">
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
      )}

      {mobile ? (
        <Drawer open={Boolean(selectedEvent)} onOpenChange={(open) => !open && selectEvent(null)}>
          <DrawerContent
            side="right"
            className="w-[min(24rem,calc(100vw-1rem))] overflow-y-auto p-4"
          >
            <DrawerTitle className="text-base font-bold">日程节点详细信息</DrawerTitle>
            <DrawerDescription className="mt-1 text-xs text-muted">
              查看节点详情并执行当前权限允许的操作
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
            <DrawerTitle className="text-base font-bold">{anchor} 当日人员资质</DrawerTitle>
            <DrawerDescription className="mt-1 text-xs text-muted">
              资质状态按所选日期计算
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
        title="资质记录已更新"
        tone="success"
        onClose={() => setToastOpen(false)}
      >
        日历事件和当日人员资质已重新计算。
      </Toast>
    </PageContainer>
  );
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
  const days = calendarDays("month", anchor);
  const month = anchor.slice(0, 7);
  const selectedEvents = events.filter((event) => event.date <= anchor && event.endDate >= anchor);
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden shadow-none" data-testid="month-calendar">
        <div role="grid" aria-label="月历" className="grid grid-cols-7">
          <div role="row" className="contents">
            {weekdays.map((day) => (
              <div
                role="columnheader"
                key={day}
                className="border-b border-border bg-slate-50 px-1 py-2 text-center text-[10px] font-semibold text-secondary sm:text-xs"
              >
                {day}
              </div>
            ))}
          </div>
          <div role="row" className="contents">
            {days.map((day) => {
              const dayEvents = events.filter((event) => event.date <= day && event.endDate >= day);
              return (
                <div
                  role="gridcell"
                  key={day}
                  className={`min-h-16 min-w-0 border-b border-r border-border p-1 text-left sm:min-h-28 sm:p-2 ${day === anchor ? "bg-blue-50" : day.startsWith(month) ? "bg-card" : "bg-slate-50 text-muted"}`}
                >
                  <button
                    type="button"
                    aria-label={`${day}，${dayEvents.length}项事件`}
                    onClick={() => onDate(day)}
                    className="block w-full text-left"
                  >
                    <span className="text-[11px] font-semibold sm:text-xs">
                      {Number(day.slice(-2))}
                    </span>
                    {dayEvents.length ? (
                      <span className="mt-1 block size-1.5 rounded-full bg-brand sm:hidden" />
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
                        {event.pilotName} · {event.title}
                      </button>
                    ))}
                    {dayEvents.length > 2 ? (
                      <span className="block text-[10px] text-muted">
                        还有 {dayEvents.length - 2} 项
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
        <h3 className="text-sm font-bold">{anchor} 当日事件</h3>
        {selectedEvents.length ? (
          selectedEvents.map((event) => (
            <EventCard key={event.id} event={event} onClick={() => onEvent(event, anchor)} />
          ))
        ) : (
          <EmptyState title="当日无事件" description="选择其他日期查看日程。" />
        )}
      </div>
    </div>
  );
}

function WeekCalendar({
  anchor,
  events,
  onEvent,
}: {
  anchor: string;
  events: AdminCalendarEvent[];
  onEvent: (event: AdminCalendarEvent) => void;
}) {
  const days = calendarDays("week", anchor);
  return (
    <Card className="overflow-x-auto shadow-none" data-testid="week-calendar">
      <div className="grid min-w-[840px] grid-cols-7">
        {days.map((day, index) => (
          <section key={day} className="min-h-96 border-r border-border p-2 last:border-r-0">
            <h3 className="border-b border-border pb-2 text-xs font-bold">
              {weekdays[index]} · {day.slice(5)}
            </h3>
            <div className="mt-2 space-y-2">
              {events
                .filter((event) => event.date <= day && event.endDate >= day)
                .map((event) => (
                  <EventCard key={event.id} event={event} onClick={() => onEvent(event)} compact />
                ))}
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
  const groups = Map.groupBy(events, (event) => event.date);
  if (!events.length)
    return <EmptyState title="没有符合条件的日程" description="请调整日期、类型或搜索条件。" />;
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
  const groups = Map.groupBy(
    events,
    (event) => `${event.pilotId}|${event.pilotName}|${event.employeeNumber}`,
  );
  if (!events.length)
    return <EmptyState title="没有符合条件的人员事件" description="请调整筛选条件。" />;
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
}: {
  event: AdminCalendarEvent;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border border-border bg-card text-left hover:border-brand ${compact ? "p-2" : "p-3"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-xs font-bold">{event.title}</p>
        <Badge tone={eventTone(event)} className="shrink-0 py-0.5 text-[10px]">
          {eventTypeLabel(event)}
        </Badge>
      </div>
      <p className="mt-1 truncate text-xs text-secondary">
        {event.pilotName} · {event.employeeNumber} · {event.unit}
      </p>
      <p className="mt-1 text-[10px] text-muted">
        {event.date}
        {event.endDate !== event.date ? ` 至 ${event.endDate}` : ""}
      </p>
    </button>
  );
}

function qualificationTone(record: NonNullable<CalendarDayQualificationSlot["record"]>) {
  if (record.status === "expired") return "danger" as const;
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
        <h2 className="text-base font-bold">{date} 当日人员资质</h2>
        <p className="mt-1 text-xs text-muted">
          {roster
            ? `${roster.pilots.length} 人 · ${roster.eventCount} 个节点`
            : "资质状态按所选日期计算"}
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
          <EmptyState title="当日无匹配人员节点" description="请调整日期或顶部筛选条件。" />
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
                  档案
                </Link>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {pilot.nodes.map((node) => (
                  <Badge key={node.id} tone={node.type === "upgrade_stage" ? "info" : "warning"}>
                    {node.title}
                  </Badge>
                ))}
              </div>
              <div className="mt-3 divide-y divide-border border-t border-border">
                {pilot.qualifications.map((qualification) => {
                  const record = qualification.record;
                  const statusLabel =
                    record?.daysRemaining === 0 ? "当日到期" : record?.statusLabel;
                  return (
                    <div
                      key={qualification.qualificationId}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">
                          {qualification.qualificationName}
                        </p>
                        {record ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-muted">
                              {record.expiryDate || "长期有效"}
                            </span>
                            <Badge tone={qualificationTone(record)} className="py-0.5 text-[10px]">
                              {statusLabel}
                            </Badge>
                          </div>
                        ) : (
                          <Badge tone="neutral" className="mt-1 py-0.5 text-[10px]">
                            未建档
                          </Badge>
                        )}
                      </div>
                      {canWrite && record ? (
                        <IconButton
                          label={`编辑${pilot.pilotName}的${qualification.qualificationName}`}
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
      setError(validation.error.issues[0]?.message ?? "请检查资质字段");
      return;
    }
    if (target.qualification.validityRule.kind === "manual_expiry" && !values.expiryDate) {
      setFieldErrors({ expiryDate: "请填写到期日期" });
      setError("请填写到期日期");
      return;
    }
    setLoading(true);
    try {
      await onSave(target, values);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资质保存失败");
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
        <DialogTitle className="text-lg font-bold">编辑资质</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted">
          {target?.pilotName} · {target?.qualification.qualificationName}
          ；保存后直接更新生效记录并留下审计记录。
        </DialogDescription>
        <div className="mt-4 space-y-3">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Input
            label="证件编号"
            required
            value={values.credentialNumber}
            onChange={(event) => update("credentialNumber", event.target.value)}
            error={fieldErrors.credentialNumber}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <DateField
              label="签发日期"
              required
              value={values.issueDate}
              onChange={(event) => update("issueDate", event.target.value)}
              error={fieldErrors.issueDate}
            />
            {target?.qualification.validityRule.kind === "fixed_months" &&
            target.qualification.validityRule.baseDateField === "trainingDate" ? (
              <DateField
                label="培训日期"
                required
                value={values.trainingDate}
                onChange={(event) => update("trainingDate", event.target.value)}
                error={fieldErrors.trainingDate}
              />
            ) : null}
            {target?.qualification.validityRule.kind !== "non_expiring" ? (
              <DateField
                label="到期日期"
                required
                readOnly={target?.qualification.validityRule.kind === "fixed_months"}
                value={values.expiryDate}
                onChange={(event) => update("expiryDate", event.target.value)}
                error={fieldErrors.expiryDate}
              />
            ) : null}
          </div>
          <Input
            label="签发机构"
            required
            value={values.issuingAuthority}
            onChange={(event) => update("issuingAuthority", event.target.value)}
            error={fieldErrors.issuingAuthority}
          />
          <Input
            label="等级/参数"
            required
            value={values.levelOrParameter}
            onChange={(event) => update("levelOrParameter", event.target.value)}
            error={fieldErrors.levelOrParameter}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
              取消
            </Button>
            <Button loading={loading} disabled={unchanged} onClick={() => void save()}>
              保存资质
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
    return (
      <Card className="p-5 text-sm text-muted shadow-none">选择日历事件后在此查看详细信息。</Card>
    );
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
      setError(validation.error.issues[0]?.message ?? "请检查节点日期");
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
      const message = reason instanceof Error ? reason.message : "调整失败";
      setError(message);
      if (message.includes("整体计划周期")) {
        setFieldErrors({ plannedStart: message, plannedEnd: message });
      } else if (message.includes("前一") || message.includes("开始日期")) {
        setFieldErrors({ plannedStart: message });
      } else if (message.includes("后一") || message.includes("结束日期")) {
        setFieldErrors({ plannedEnd: message });
      }
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
      setError(validation.error.issues[0]?.message ?? "请检查完成结果");
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
      setError(reason instanceof Error ? reason.message : "登记失败");
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
        <Badge tone={eventTone(event)}>{eventTypeLabel(event)}</Badge>
        {!compact ? (
          <Button variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
        ) : null}
      </div>
      <h3 className="mt-3 text-lg font-bold">{event.title}</h3>
      <dl className="mt-4 grid grid-cols-[88px_1fr] gap-x-3 gap-y-3 text-sm">
        <dt className="text-muted">计划对象</dt>
        <dd className="font-semibold">
          {event.pilotName}（{event.employeeNumber}）
        </dd>
        <dt className="text-muted">所属中队</dt>
        <dd>{event.unit}</dd>
        <dt className="text-muted">职位</dt>
        <dd>
          {event.positionName ??
            (event.positionCode === "PILOT" ? "飞行员" : (event.positionCode ?? "—"))}
        </dd>
        {event.type === "qualification_expiry" ? (
          <>
            <dt className="text-muted">资质项目</dt>
            <dd>{event.qualificationName}</dd>
            <dt className="text-muted">到期日期</dt>
            <dd>{event.date}</dd>
            <dt className="text-muted">剩余/逾期</dt>
            <dd>
              {(event.daysRemaining ?? 0) < 0
                ? `已逾期 ${Math.abs(event.daysRemaining!)} 天`
                : `剩余 ${event.daysRemaining} 天`}
            </dd>
          </>
        ) : (
          <>
            <dt className="text-muted">所属计划</dt>
            <dd>
              {event.planNumber} · {event.planTitle}
            </dd>
            <dt className="text-muted">节点周期</dt>
            <dd>
              {event.date} 至 {event.endDate}
            </dd>
            <dt className="text-muted">责任人</dt>
            <dd>{event.owner}</dd>
            <dt className="text-muted">状态</dt>
            <dd>
              {event.stageStatus}
              {event.planLifecycleStatus ? ` · ${lifecycleLabels[event.planLifecycleStatus]}` : ""}
            </dd>
            <dt className="text-muted">备注</dt>
            <dd>{event.notes || "无"}</dd>
            <dt className="text-muted">检查项目</dt>
            <dd>{event.inspectionItems?.join("、") || "无"}</dd>
          </>
        )}
      </dl>
      {event.type === "qualification_expiry" ? (
        <div className="mt-5">
          <Alert tone="info">到期日与飞行员当前生效资质记录关联。</Alert>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {canWrite && onEditQualification ? (
              <Button variant="secondary" onClick={onEditQualification}>
                <Pencil className="size-4" /> 编辑此资质
              </Button>
            ) : null}
            <Link
              href={`/admin/pilots/${event.pilotId}`}
              className="inline-flex min-h-11 items-center justify-center text-sm font-semibold text-brand"
            >
              进入飞行员档案
            </Link>
          </div>
        </div>
      ) : event.readonly || !canWrite ? (
        <Alert tone="info" className="mt-5">
          {event.readonly
            ? "该计划已完成或已取消，日历历史事件只读。"
            : "当前账号只有查看权限，不能调整节点。"}
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
            调整节点日期
          </Button>
          <Button
            onClick={() => {
              setError("");
              setFieldErrors({});
              setCompleteOpen(true);
            }}
            disabled={event.stageStatus === "completed" || event.planLifecycleStatus !== "active"}
          >
            登记完成结果
          </Button>
          {event.planLifecycleStatus !== "active" ? (
            <p className="col-span-full text-xs text-muted">
              仅进行中的计划可以登记节点完成；可先进入计划详情启动或恢复。
            </p>
          ) : null}
          <Link
            href={`/admin/upgrade-plans/${event.planId}`}
            className="col-span-full inline-flex min-h-11 items-center justify-center text-sm font-semibold text-brand"
          >
            查看计划详情
          </Link>
        </div>
      )}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent>
          <DialogTitle className="text-lg font-bold">调整节点日期</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted">
            日期须位于整体计划范围内，并保持六节点固定顺序。
          </DialogDescription>
          <div className="mt-4 space-y-3">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <DateField
              label="计划开始日期"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
              error={fieldErrors.plannedStart}
            />
            <DateField
              label="计划结束日期"
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              error={fieldErrors.plannedEnd}
            />
            <Textarea label="备注" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRescheduleOpen(false)}>
                取消
              </Button>
              <Button loading={loading} onClick={() => void reschedule()}>
                保存调整
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent>
          <DialogTitle className="text-lg font-bold">登记完成结果</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted">
            不能跳过尚未完成的中间节点。
          </DialogDescription>
          <div className="mt-4 space-y-3">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <DateField
              label="完成日期"
              required
              value={completedOn}
              onChange={(e) => setCompletedOn(e.target.value)}
              error={fieldErrors.completedOn}
            />
            <Textarea
              label="结果摘要"
              required
              value={result}
              onChange={(e) => setResult(e.target.value)}
              error={fieldErrors.resultSummary}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCompleteOpen(false)}>
                取消
              </Button>
              <Button loading={loading} onClick={() => void complete()}>
                确认完成
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
