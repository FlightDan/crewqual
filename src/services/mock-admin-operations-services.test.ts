import { beforeEach, describe, expect, it } from "vitest";
import { createInitialAdminState } from "@/mocks/admin-fixtures";
import { createAdminStateStore } from "@/services/admin-state-store";
import {
  createMockAdminOperationsServices,
  createSequenceIdGenerator,
} from "@/services/mock-admin-operations-services";
import { UPGRADE_STAGE_CODES, UPGRADE_STAGE_NAMES, type UpgradePlanDraft } from "@/types/services";

const clock = { now: () => new Date("2026-08-14T12:00:00+08:00") };

function planDraft(pilotId = "pilot-demo-05"): UpgradePlanDraft {
  const ranges = [
    ["2026-09-01", "2026-09-10"],
    ["2026-09-11", "2026-09-20"],
    ["2026-09-21", "2026-09-30"],
    ["2026-10-01", "2026-10-15"],
    ["2026-10-16", "2026-11-30"],
    ["2026-12-01", "2026-12-15"],
  ];
  return {
    pilotId,
    title: "确定性测试升级计划",
    type: "captain_upgrade",
    startDate: "2026-09-01",
    endDate: "2026-12-31",
    overallOwner: "测试责任人",
    leadDepartment: "测试中队",
    stages: UPGRADE_STAGE_NAMES.map((name, index) => ({
      id: `draft-${index}`,
      code: UPGRADE_STAGE_CODES[index]!,
      name,
      status: "not_started",
      plannedStart: ranges[index]![0],
      plannedEnd: ranges[index]![1],
      owner: `责任人${index + 1}`,
      notes: "测试节点",
    })),
    inspectionItemSelections: [
      { inspectionItemId: "11111111-1111-4111-8111-111111111111", stageOrder: 0 },
    ],
    supplementalRequirements: ["补充训练"],
  };
}

describe("fourth-batch operation services", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("derives unique calendar events from qualifications and plan stages", async () => {
    const store = createAdminStateStore(createInitialAdminState());
    const services = createMockAdminOperationsServices(store, clock, createSequenceIdGenerator());
    const events = (await services.calendar.listEvents({})).data;
    expect(events).toHaveLength(54);
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
    expect(events.filter((event) => event.type === "qualification_expiry")).toHaveLength(30);
    expect(events.filter((event) => event.type === "upgrade_stage")).toHaveLength(24);
    expect(
      events.find((event) => event.id === "upgrade:upgrade-03:upgrade-03-stage-1"),
    ).toMatchObject({ readonly: true, planLifecycleStatus: "completed" });
  });

  it("filters calendar events by one or more squadrons", async () => {
    const initial = createInitialAdminState();
    initial.pilots = initial.pilots.map((pilot) =>
      pilot.id === "pilot-demo-05" ? { ...pilot, unit: "一大队二中队" } : pilot,
    );
    const services = createMockAdminOperationsServices(
      createAdminStateStore(initial),
      clock,
      createSequenceIdGenerator(),
    );

    const secondSquadron = (await services.calendar.listEvents({ units: "一大队二中队" })).data;
    expect(secondSquadron.length).toBeGreaterThan(0);
    expect(secondSquadron.every((event) => event.unit === "一大队二中队")).toBe(true);

    const bothSquadrons = (
      await services.calendar.listEvents({ units: "一大队一中队,一大队二中队" })
    ).data;
    expect(bothSquadrons).toHaveLength(54);
  });

  it("builds a filtered day roster with six ordered qualifications and selected-day status", async () => {
    const initial = createInitialAdminState();
    initial.pilots = initial.pilots.map((pilot) =>
      pilot.id === "pilot-demo-04"
        ? {
            ...pilot,
            qualifications: pilot.qualifications.filter(
              (qualification) => qualification.id !== "medical-certificate",
            ),
          }
        : pilot,
    );
    const services = createMockAdminOperationsServices(
      createAdminStateStore(initial),
      clock,
      createSequenceIdGenerator(),
    );
    const roster = (
      await services.calendar.getDayQualificationRoster({
        date: "2026-08-15",
        type: "upgrade_stage",
        q: "MOCK-1522",
        units: "一大队一中队",
      })
    ).data;
    expect(roster).toMatchObject({ date: "2026-08-15", eventCount: 1 });
    expect(roster.pilots.map((pilot) => pilot.pilotId)).toEqual(["pilot-demo-04"]);
    expect(roster.pilots[0]?.qualifications.map((item) => item.qualificationId)).toEqual([
      "medical-certificate",
      "annual-recurrent-training",
      "dangerous-goods-training",
      "icao-english-endorsement",
      "chinese-language-assessment",
      "simulator-recurrent-training",
    ]);
    expect(roster.pilots[0]?.qualifications[0]?.record).toBeNull();
    expect(
      roster.pilots[0]?.qualifications.find(
        (item) => item.qualificationId === "dangerous-goods-training",
      )?.record,
    ).toMatchObject({ daysRemaining: -1, status: "expired" });

    expect(
      (
        await services.calendar.getDayQualificationRoster({
          date: "2026-08-15",
          type: "qualification_expiry",
          q: "MOCK-1522",
        })
      ).data.pilots,
    ).toEqual([]);
  });

  it("keeps qualification events on their expiry date while stages remain active across a range", async () => {
    const services = createMockAdminOperationsServices(
      createAdminStateStore(createInitialAdminState()),
      clock,
      createSequenceIdGenerator(),
    );

    const expiryDay = (
      await services.calendar.listEvents({
        from: "2026-08-14",
        to: "2026-08-14",
        q: "MOCK-1522",
      })
    ).data;
    expect(expiryDay.filter((event) => event.type === "qualification_expiry")).toHaveLength(1);

    const activeDay = (
      await services.calendar.listEvents({
        from: "2026-08-15",
        to: "2026-08-15",
        q: "MOCK-1522",
      })
    ).data;
    expect(activeDay.filter((event) => event.type === "qualification_expiry")).toHaveLength(0);
    expect(activeDay.filter((event) => event.type === "upgrade_stage")).toHaveLength(1);
  });

  it("reschedules a stage once and synchronizes calendar and notification logs", async () => {
    const store = createAdminStateStore(createInitialAdminState());
    const services = createMockAdminOperationsServices(store, clock, createSequenceIdGenerator());
    await services.upgradePlans.rescheduleStage("upgrade-01", "upgrade-01-stage-5", {
      plannedStart: "2026-08-13",
      plannedEnd: "2026-08-19",
    });
    const event = (await services.calendar.getEvent("upgrade:upgrade-01:upgrade-01-stage-5")).data;
    expect(event).toMatchObject({ date: "2026-08-13", endDate: "2026-08-19" });
    expect(store.getSnapshot().notificationLogs[0]).toMatchObject({
      type: "stage_date_changed",
      status: "queued",
    });
    const notificationCount = store.getSnapshot().notificationLogs.length;
    const auditCount = store.getSnapshot().upgradePlans.find((plan) => plan.id === "upgrade-01")!
      .audit.length;
    await services.upgradePlans.rescheduleStage("upgrade-01", "upgrade-01-stage-5", {
      plannedStart: "2026-08-13",
      plannedEnd: "2026-08-19",
    });
    expect(store.getSnapshot().notificationLogs).toHaveLength(notificationCount);
    expect(
      store.getSnapshot().upgradePlans.find((plan) => plan.id === "upgrade-01")!.audit,
    ).toHaveLength(auditCount);
    expect(
      (await services.calendar.listEvents({})).data.filter(
        (item) => item.id === "upgrade:upgrade-01:upgrade-01-stage-5",
      ),
    ).toHaveLength(1);
  });

  it("rejects invalid stage ranges and skipping intermediate nodes", async () => {
    const services = createMockAdminOperationsServices(
      createAdminStateStore(createInitialAdminState()),
      clock,
      createSequenceIdGenerator(),
    );
    await expect(
      services.upgradePlans.rescheduleStage("upgrade-01", "upgrade-01-stage-5", {
        plannedStart: "2026-08-01",
        plannedEnd: "2026-08-19",
      }),
    ).rejects.toThrow("前一固定顺序节点");
    await expect(
      services.upgradePlans.rescheduleStage("upgrade-01", "upgrade-01-stage-5", {
        plannedStart: "invalid-date",
        plannedEnd: "2026-08-19",
      }),
    ).rejects.toThrow("有效日期");
    await expect(
      services.upgradePlans.completeStage("upgrade-01", "upgrade-01-stage-6", {
        completedOn: "2026-08-28",
        resultSummary: "不应跳过",
      }),
    ).rejects.toThrow("不能跳过");
    await expect(
      services.upgradePlans.completeStage("upgrade-04", "upgrade-04-stage-3", {
        completedOn: "2026-08-14",
        resultSummary: "暂停期间不应完成",
      }),
    ).rejects.toThrow("仅进行中的计划");
  });

  it("completes only the next eligible stage and advances exactly one node", async () => {
    const store = createAdminStateStore(createInitialAdminState());
    const services = createMockAdminOperationsServices(store, clock, createSequenceIdGenerator());
    const completed = (
      await services.upgradePlans.completeStage("upgrade-01", "upgrade-01-stage-5", {
        completedOn: "2026-08-18",
        resultSummary: "航线检查人工登记通过",
      })
    ).data;
    expect(completed.stages[4]).toMatchObject({
      status: "completed",
      completedOn: "2026-08-18",
    });
    expect(completed.stages[5]?.status).toBe("scheduled");
    expect(store.getSnapshot().notificationLogs[0]).toMatchObject({
      type: "stage_completed",
      status: "queued",
    });
    await expect(
      services.upgradePlans.completeStage("upgrade-01", "upgrade-01-stage-5", {
        completedOn: "2026-08-18",
        resultSummary: "重复登记",
      }),
    ).rejects.toThrow("已经完成");
  });

  it("creates six fixed stages, prevents an active-plan conflict, and persists drafts", async () => {
    const store = createAdminStateStore(createInitialAdminState());
    const services = createMockAdminOperationsServices(store, clock, createSequenceIdGenerator());
    const created = (await services.upgradePlans.createAndStart(planDraft())).data;
    expect(created.stages.map((stage) => stage.name)).toEqual(UPGRADE_STAGE_NAMES);
    expect(
      store.getSnapshot().pilots.find((item) => item.id === "pilot-demo-05")?.activeUpgradePlanId,
    ).toBe(created.id);
    await expect(services.upgradePlans.createAndStart(planDraft())).rejects.toThrow("已有活动计划");
    const draft = (await services.upgradePlans.saveDraft(planDraft())).data;
    expect(draft.lifecycleStatus).toBe("draft");
    expect(
      store.getSnapshot().notificationLogs.filter((item) => item.summary.includes(draft.title)),
    ).toHaveLength(1);
  });

  it("enforces lifecycle transitions, cancellation reason, and expired-qualification blocking", async () => {
    const store = createAdminStateStore(createInitialAdminState());
    const services = createMockAdminOperationsServices(store, clock, createSequenceIdGenerator());
    await services.upgradePlans.pause("upgrade-01");
    expect((await services.upgradePlans.resume("upgrade-01")).data.lifecycleStatus).toBe("active");
    await expect(services.upgradePlans.cancel("upgrade-01", { reason: "短" })).rejects.toThrow(
      "至少需要 5 个字符",
    );
    expect(
      (await services.upgradePlans.cancel("upgrade-01", { reason: "训练路线发生调整" })).data
        .lifecycleStatus,
    ).toBe("cancelled");
    const startableDraft = (await services.upgradePlans.saveDraft(planDraft())).data;
    const notificationsBeforeStart = store.getSnapshot().notificationLogs.length;
    expect((await services.upgradePlans.start(startableDraft.id)).data.lifecycleStatus).toBe(
      "active",
    );
    expect(store.getSnapshot().notificationLogs).toHaveLength(notificationsBeforeStart + 1);
    expect(store.getSnapshot().notificationLogs[0]?.summary).toContain("升级计划已启动");
    const expiredPilotDraft = (await services.upgradePlans.saveDraft(planDraft("pilot-demo-03")))
      .data;
    await expect(services.upgradePlans.start(expiredPilotDraft.id)).rejects.toThrow(
      "核心资质已过期",
    );
    await expect(
      services.upgradePlans.cancel(expiredPilotDraft.id, { reason: "草稿不应通过取消流转" }),
    ).rejects.toThrow("仅未开始、进行中或已暂停");
  });

  it("validates configs without rewriting effective Pilot records or core completion", async () => {
    const store = createAdminStateStore(createInitialAdminState());
    const services = createMockAdminOperationsServices(store, clock, createSequenceIdGenerator());
    const config = store.getSnapshot().qualificationConfigs[0]!;
    const beforeQualification = structuredClone(store.getSnapshot().pilots[0]!.qualifications[0]);
    await expect(
      services.qualificationConfigs.save("PILOT", config.id, {
        ...config,
        name: "被改名的核心项目",
      }),
    ).rejects.toThrow("不可改名");
    await expect(
      services.qualificationConfigs.save("PILOT", config.id, {
        ...config,
        reminders: { firstDays: 20, secondDays: 30 },
      }),
    ).rejects.toThrow("首次提醒天数");
    await expect(
      services.qualificationConfigs.save("PILOT", config.id, {
        ...config,
        parameterRestriction: { enabled: true, description: "" },
      }),
    ).rejects.toThrow("请填写说明");
    const saved = await services.qualificationConfigs.save("PILOT", config.id, {
      ...config,
      reminders: { firstDays: 90, secondDays: 45 },
      expectedVersion: 1,
    });
    expect(saved.data.version).toBe(2);
    await expect(
      services.qualificationConfigs.save("PILOT", config.id, {
        ...config,
        reminders: { firstDays: 100, secondDays: 50 },
        expectedVersion: 1,
      }),
    ).rejects.toThrow("其他管理员修改");
    expect(store.getSnapshot().pilots[0]!.qualifications[0]).toEqual(beforeQualification);
    const supplemental = (
      await services.qualificationConfigs.create({
        ...config,
        positionCode: "PILOT",
        kind: "supplemental",
        name: "高原机场补充训练",
      })
    ).data;
    expect(supplemental).toMatchObject({ core: false, name: "高原机场补充训练" });
    await expect(
      services.qualificationConfigs.save("PILOT", supplemental.id, {
        ...supplemental,
        name: config.name,
      }),
    ).rejects.toThrow("同名资质");
    await expect(
      services.qualificationConfigs.create({
        ...config,
        positionCode: "UNKNOWN_POSITION",
        kind: "supplemental",
        name: "无效职位资质",
      }),
    ).rejects.toThrow("职位不存在");
    await expect(services.qualificationConfigs.list("UNKNOWN_POSITION")).rejects.toThrow(
      "职位不存在",
    );
    expect(store.getSnapshot().qualificationConfigs.filter((item) => item.core)).toHaveLength(6);
  });

  it("derives notification summaries and appends retry attempt history", async () => {
    const services = createMockAdminOperationsServices(
      createAdminStateStore(createInitialAdminState()),
      clock,
      createSequenceIdGenerator(),
    );
    const before = (await services.notifications.getById("NOT-1003")).data!;
    expect((await services.notifications.getSummary()).data).toMatchObject({
      sentToday: 1,
      failedToday: 1,
    });
    const retried = (await services.notifications.retry("NOT-1003")).data;
    expect(retried.status).toBe("sent");
    expect(retried.attempts).toHaveLength(before.attempts.length + 2);
    expect(retried.attempts.at(-2)?.status).toBe("queued");
    expect(retried.attempts.at(-1)?.status).toBe("sent");
  });
});
