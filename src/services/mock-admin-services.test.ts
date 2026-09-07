import { beforeEach, describe, expect, it } from "vitest";
import { createInitialAdminState } from "@/mocks/admin-fixtures";
import { createAdminStateStore } from "@/services/admin-state-store";
import { createMockAdminOperationsServices } from "@/services/mock-admin-operations-services";
import { createMockAdminServices } from "@/services/mock-admin-services";
import { UPGRADE_STAGE_NAMES } from "@/types/services";

const clock = { now: () => new Date("2026-08-14T12:00:00+08:00") };

describe("admin Mock service state", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("derives dashboard statistics without allowing AI to auto approve", async () => {
    const store = createAdminStateStore(createInitialAdminState());
    const services = createMockAdminServices(store, clock);
    const summary = (await services.dashboard.getSummary()).data;
    expect(summary).toMatchObject({
      expiredCount: 2,
      dueIn7DaysCount: 3,
      dueIn30DaysCount: 6,
      pendingReviewCount: 4,
      delayedUpgradeCount: 3,
    });
    expect(summary.qualificationAlerts).toEqual(
      expect.arrayContaining([expect.objectContaining({ daysRemaining: expect.any(Number) })]),
    );
    expect(summary.weeklyUpgrades.every((item) => Boolean(item.planId))).toBe(true);
    expect(summary.delayedUpgrades).toHaveLength(summary.delayedUpgradeCount);
    expect(summary.delayedUpgrades.every((item) => Boolean(item.planId))).toBe(true);
    expect(summary.pendingReviews.every((review) => review.humanStatus === "pending")).toBe(true);
    expect((await services.reviews.getById("REV-1001")).data?.humanStatus).toBe("pending");
  });

  it("keeps originals when correcting and records the audit event", async () => {
    const services = createMockAdminServices(
      createAdminStateStore(createInitialAdminState()),
      clock,
    );
    const before = (await services.reviews.getById("REV-1004")).data!;
    const corrected = (
      await services.reviews.correct("REV-1004", {
        ...before.submittedFields,
        expiryDate: "2027-09-01",
        issuingAuthority: "人工核验后的示例机构",
      })
    ).data;
    expect(corrected.submittedFields.expiryDate).toBe(before.submittedFields.expiryDate);
    expect(corrected.corrections.expiryDate).toBe("2027-09-01");
    expect(corrected.fieldComparisons.find((field) => field.field === "expiryDate")).toMatchObject({
      submittedValue: before.submittedFields.expiryDate,
      correctedValue: "2027-09-01",
    });
    expect(corrected.audit.at(-1)).toMatchObject({ action: "corrected", actor: "演示管理员" });
  });

  it("re-derives corrections, removes reverted fields, and skips no-op audits", async () => {
    const services = createMockAdminServices(
      createAdminStateStore(createInitialAdminState()),
      clock,
    );
    const original = (await services.reviews.getById("REV-1004")).data!;
    const first = (
      await services.reviews.correct("REV-1004", {
        ...original.submittedFields,
        expiryDate: "2027-09-01",
        issuingAuthority: "人工核验后的示例机构",
      })
    ).data;
    const reverted = (
      await services.reviews.correct("REV-1004", {
        ...original.submittedFields,
        issuingAuthority: "人工核验后的示例机构",
      })
    ).data;
    expect(reverted.corrections.expiryDate).toBeUndefined();
    expect(reverted.corrections.issuingAuthority).toBe("人工核验后的示例机构");
    expect(
      reverted.fieldComparisons.find((field) => field.field === "expiryDate")?.correctedValue,
    ).toBeUndefined();
    const noOp = (
      await services.reviews.correct("REV-1004", {
        ...original.submittedFields,
        issuingAuthority: "人工核验后的示例机构",
      })
    ).data;
    expect(noOp.audit).toHaveLength(reverted.audit.length);
    expect(reverted.audit).toHaveLength(first.audit.length + 1);
  });

  it("validates complete correction fields and date order in the service", async () => {
    const services = createMockAdminServices(
      createAdminStateStore(createInitialAdminState()),
      clock,
    );
    const review = (await services.reviews.getById("REV-1002")).data!;
    await expect(
      services.reviews.correct("REV-1002", {
        ...review.submittedFields,
        issueDate: "2027-09-02",
        expiryDate: "2027-09-01",
      }),
    ).rejects.toThrow("到期日期不得早于签发日期");
    expect((await services.reviews.getById("REV-1002")).data?.audit).toHaveLength(
      review.audit.length,
    );
  });

  it("approves once, creates an effective Pilot record, and synchronizes summary", async () => {
    const store = createAdminStateStore(createInitialAdminState());
    const services = createMockAdminServices(store, clock);
    await expect(services.reviews.approve("REV-1001", { confirmed: false })).rejects.toThrow(
      "请先确认",
    );
    const approved = (
      await services.reviews.approve("REV-1001", { confirmed: true, note: "人工核验通过" })
    ).data;
    expect(approved.humanStatus).toBe("approved");
    expect(approved.audit.at(-1)?.action).toBe("approved");
    const pilot = (await services.pilots.getById("pilot-demo-02")).data!;
    expect(
      pilot.qualificationRecords.find((item) => item.id === "medical-certificate"),
    ).toMatchObject({ expiryDate: "2027-08-10", expiresOn: "2027-08-10" });
    expect((await services.dashboard.getSummary()).data).toMatchObject({
      expiredCount: 1,
      pendingReviewCount: 3,
    });
    expect((await services.reviews.getById("REV-1001")).data?.humanStatus).toBe("approved");
    expect(store.getSnapshot().notificationLogs[0]).toMatchObject({
      type: "review_approved",
      status: "queued",
      summary: expect.stringContaining("人工审核通过"),
    });
    await expect(services.reviews.approve("REV-1001", { confirmed: true })).rejects.toThrow(
      "已经处理",
    );
  });

  it("validates return reasons and persists returned state in session storage", async () => {
    const firstStore = createAdminStateStore(createInitialAdminState());
    const firstServices = createMockAdminServices(firstStore, clock);
    await expect(
      firstServices.reviews.returnForChanges("REV-1003", { reason: "短" }),
    ).rejects.toThrow("至少需要 5 个字符");
    await firstServices.reviews.returnForChanges("REV-1003", {
      reason: "  请重新上传完整凭证  ",
    });
    expect(firstStore.getSnapshot().notificationLogs[0]).toMatchObject({
      type: "review_returned",
      status: "queued",
      message: expect.stringContaining("管理员决定退回"),
    });
    expect(firstStore.getSnapshot().notificationLogs[0]?.message).not.toContain("AI 自动退回");
    const restoredServices = createMockAdminServices(
      createAdminStateStore(createInitialAdminState()),
      clock,
    );
    expect((await restoredServices.reviews.getById("REV-1003")).data).toMatchObject({
      humanStatus: "returned",
      decision: { kind: "returned", reason: "请重新上传完整凭证" },
    });
  });

  it("searches, filters and paginates pilots and reviews", async () => {
    const services = createMockAdminServices(
      createAdminStateStore(createInitialAdminState()),
      clock,
    );
    expect((await services.pilots.list({ q: "MOCK-1049", pageSize: 2 })).data.items).toHaveLength(
      1,
    );
    expect(
      (await services.pilots.list({ health: "expired", pageSize: 10 })).data.items,
    ).toHaveLength(2);
    expect((await services.pilots.list({ page: 2, pageSize: 4 })).data).toMatchObject({
      page: 2,
      totalPages: 2,
    });
    expect(
      (await services.reviews.list({ status: "pending", ai: "mismatch" })).data.items,
    ).toHaveLength(1);
  });

  it("keeps pagination and totals stable at the required list scale", async () => {
    const state = createInitialAdminState();
    const pilotTemplate = structuredClone(state.pilots[0]!);
    const reviewTemplate = structuredClone(state.reviews[0]!);
    const planTemplate = structuredClone(state.upgradePlans[0]!);
    const notificationTemplate = structuredClone(state.notificationLogs[0]!);
    state.pilots = Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(pilotTemplate),
      id: `scale-pilot-${index + 1}`,
      employeeNumber: `SCALE-${String(index + 1).padStart(4, "0")}`,
      displayName: `规模测试飞行员 ${index + 1}`,
    }));
    state.reviews = Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(reviewTemplate),
      id: `scale-review-${index + 1}`,
      pilotId: state.pilots[index]!.id,
    }));
    state.upgradePlans = Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(planTemplate),
      id: `scale-plan-${index + 1}`,
      planNumber: `SCALE-PLAN-${index + 1}`,
      pilotId: state.pilots[index]!.id,
    }));
    state.notificationLogs = Array.from({ length: 200 }, (_, index) => ({
      ...structuredClone(notificationTemplate),
      id: `scale-notification-${index + 1}`,
      pilotId: state.pilots[index % state.pilots.length]!.id,
      employeeNumber: state.pilots[index % state.pilots.length]!.employeeNumber,
    }));

    const store = createAdminStateStore(state);
    const adminServices = createMockAdminServices(store, clock);
    const operations = createMockAdminOperationsServices(store, clock);
    expect((await adminServices.pilots.list({ page: 10, pageSize: 10 })).data).toMatchObject({
      total: 100,
      page: 10,
      items: expect.any(Array),
    });
    expect((await adminServices.reviews.list({ page: 5, pageSize: 20 })).data.total).toBe(100);
    expect((await operations.upgradePlans.list({ page: 5, pageSize: 20 })).data.total).toBe(100);
    expect(
      (await operations.notifications.list({ page: 10, pageSize: 20 })).data.total,
    ).toBeGreaterThanOrEqual(200);
  });

  it("keeps six official qualification names and six upgrade stages in fixed order", async () => {
    const services = createMockAdminServices(
      createAdminStateStore(createInitialAdminState()),
      clock,
    );
    const pilot = (await services.pilots.getById("pilot-demo-01")).data!;
    expect(pilot.qualifications.map((item) => item.name)).toEqual([
      "民用航空人员体检合格证",
      "机组年度复训合格证",
      "危险品运输培训合格证",
      "ICAO英语语言能力等级签注",
      "ICAO汉语语言能力等级签注",
      "模拟机复训（每6个月）",
    ]);
    expect(pilot.upgradePlan?.stages.map((stage) => stage.name)).toEqual(UPGRADE_STAGE_NAMES);
  });

  it("updates an active qualification with validation and optimistic versioning", async () => {
    const store = createAdminStateStore(createInitialAdminState());
    const services = createMockAdminServices(store, clock);
    const notificationsBefore = store.getSnapshot().notificationLogs.length;
    const original = store
      .getSnapshot()
      .pilots.find((pilot) => pilot.id === "pilot-demo-04")!
      .qualifications.find((item) => item.id === "dangerous-goods-training")!;
    const updated = (
      await services.pilots.updateQualificationRecord("pilot-demo-04", "dangerous-goods-training", {
        credentialNumber: original.credentialNumber,
        issueDate: original.issueDate,
        expiryDate: "2026-08-20",
        issuingAuthority: original.issuingAuthority,
        levelOrParameter: "合格（管理员修正）",
        expectedVersion: 1,
      })
    ).data;
    expect(updated).toMatchObject({ expiryDate: "2026-08-20", version: 2 });
    expect(
      store
        .getSnapshot()
        .pilots.find((pilot) => pilot.id === "pilot-demo-04")!
        .qualifications.find((item) => item.id === "dangerous-goods-training"),
    ).toMatchObject({
      expiresOn: "2026-08-20",
      levelOrParameter: "合格（管理员修正）",
      audit: [expect.objectContaining({ action: "qualification.admin_updated" })],
    });
    expect(store.getSnapshot().notificationLogs).toHaveLength(notificationsBefore);
    await expect(
      services.pilots.updateQualificationRecord("pilot-demo-04", "dangerous-goods-training", {
        credentialNumber: original.credentialNumber,
        issueDate: original.issueDate,
        expiryDate: "2026-08-22",
        issuingAuthority: original.issuingAuthority,
        levelOrParameter: original.levelOrParameter,
        expectedVersion: 1,
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
  });

  it("enforces parameter restrictions on Mock update, create, and review corrections", async () => {
    const state = createInitialAdminState();
    const qualificationId = "dangerous-goods-training";
    const config = state.qualificationConfigs.find(
      (item) => item.qualificationId === qualificationId,
    )!;
    config.parameterRestriction = {
      enabled: true,
      description: "仅允许标准结论",
      version: 1,
      enforcement: {
        mode: "allowed_values",
        allowedValues: ["合格（两年期）"],
        pattern: "",
      },
    };
    const store = createAdminStateStore(state);
    const services = createMockAdminServices(store, clock);
    const pilot = state.pilots.find((item) => item.id === "pilot-demo-04")!;
    const original = pilot.qualifications.find((item) => item.id === qualificationId)!;
    const invalidFields = {
      credentialNumber: original.credentialNumber,
      issueDate: original.issueDate,
      expiryDate: original.expiryDate,
      issuingAuthority: original.issuingAuthority,
      levelOrParameter: "任意输入",
    };

    await expect(
      services.pilots.updateQualificationRecord(pilot.id, qualificationId, {
        ...invalidFields,
        expectedVersion: original.version ?? 1,
      }),
    ).rejects.toThrow("等级/参数必须是");

    store.update((current) => ({
      ...current,
      pilots: current.pilots.map((item) =>
        item.id === pilot.id
          ? {
              ...item,
              qualifications: item.qualifications.filter(
                (qualification) => qualification.id !== qualificationId,
              ),
            }
          : item,
      ),
    }));
    await expect(
      services.pilots.createQualificationRecord(pilot.id, qualificationId, invalidFields),
    ).rejects.toThrow("等级/参数必须是");

    const review = (await services.reviews.getById("REV-1004")).data!;
    await expect(
      services.reviews.correct(review.id, {
        ...review.submittedFields,
        levelOrParameter: "任意输入",
      }),
    ).rejects.toThrow("等级/参数必须是");
  });

  it("creates, edits and soft-deactivates pilots with missing assigned qualifications", async () => {
    const services = createMockAdminServices(
      createAdminStateStore(createInitialAdminState()),
      clock,
    );
    const created = (
      await services.pilots.create({
        employeeNumber: "CQ-NEW-01",
        displayName: "新增人员",
        mobile: "13800138999",
        aircraftType: "A320",
        roleCode: "FIRST_OFFICER",
        unitCode: "DEMO",
        rankCode: "FO-1",
      })
    ).data;
    expect(created).toMatchObject({ health: "missing", active: true, version: 1 });
    expect(created.qualifications).toHaveLength(6);
    expect(created.qualifications.every((item) => item.status === "missing")).toBe(true);

    const updated = (
      await services.pilots.update(created.id, {
        employeeNumber: created.employeeNumber,
        displayName: "新增人员甲",
        mobile: created.mobile,
        aircraftType: created.aircraftType,
        roleCode: "CAPTAIN",
        unitCode: created.unitCode,
        rankCode: "CAPT-A",
        active: false,
        expectedVersion: created.version,
      })
    ).data;
    expect(updated).toMatchObject({ displayName: "新增人员甲", active: false, version: 2 });
    expect((await services.pilots.list({ status: "inactive" })).data.items).toContainEqual(
      expect.objectContaining({ id: created.id }),
    );
  });

  it("previews and imports only valid CSV rows with dynamic qualification fields", async () => {
    const services = createMockAdminServices(
      createAdminStateStore(createInitialAdminState()),
      clock,
    );
    const meta = (await services.pilots.getManagementMeta()).data;
    const qualification = meta.qualifications[0]!;
    const values: Record<string, string> = Object.fromEntries(
      meta.csvHeaders.map((header) => [header, ""]),
    );
    Object.assign(values, {
      employeeNumber: "CQ-CSV-01",
      displayName: "批量人员",
      mobile: "13800138888",
      aircraftType: "A320",
      roleCode: "FIRST_OFFICER",
      unitCode: "DEMO",
      rankCode: "FO-2",
      [`${qualification.code}.issueDate`]: "2026-01-01",
      [`${qualification.code}.expiryDate`]: "2027-01-01",
      [`${qualification.code}.levelOrParameter`]: "合格",
    });
    const validRow = meta.csvHeaders.map((header) => values[header]).join(",");
    const invalidRow = validRow.replace("CQ-CSV-01", "MOCK-1049");
    const csv = `${meta.csvHeaders.join(",")}\n${validRow}\n${invalidRow}`;
    const preview = (await services.pilots.previewImport(csv)).data;
    expect(preview).toMatchObject({ total: 2, validCount: 1, errorCount: 1 });
    expect(preview.rows[1]?.errors).toContain("员工号已存在");

    const imported = (await services.pilots.importCsv(csv)).data;
    expect(imported).toMatchObject({ createdCount: 1, skippedCount: 1, qualificationCount: 1 });
    const pilot = (await services.pilots.list({ q: "CQ-CSV-01" })).data.items[0];
    expect(pilot).toMatchObject({ employeeNumber: "CQ-CSV-01", health: "missing" });
  });
  it("preserves optional risk counts without failing member health", async () => {
    const state = createInitialAdminState();
    const pilot = state.pilots[0]!;
    state.qualificationConfigs = [{ ...state.qualificationConfigs[0]!, core: false }];
    pilot.qualifications = [];
    const services = createMockAdminServices(createAdminStateStore(state), clock);
    const detail = (await services.pilots.getById(pilot.id)).data!;
    expect(detail.health).toBe("normal");
    expect(detail.qualifications[0]).toMatchObject({ status: "missing", required: false });
    expect((await services.dashboard.getSummary()).data.missingCount).toBe(0);
  });
});
