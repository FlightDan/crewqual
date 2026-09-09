import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  stage: vi.fn(),
  records: vi.fn(),
  stages: vi.fn(),
}));
vi.mock("@/server/admin-guard", () => ({
  getAdmin: async () => ({ roles: ["ADMIN"], unitId: "unit-a" }),
}));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({
    qualificationRecord: { findFirst: mocks.record, findMany: mocks.records },
    upgradeStage: { findFirst: mocks.stage, findMany: mocks.stages },
  }),
}));
import { GET } from "./route";
import { listAdminCalendarEvents } from "@/server/admin-calendar";
import type { AuthenticatedAdmin } from "@/server/auth";
const uuid = "00000000-0000-4000-8000-000000000001";
const get = (id: string) =>
  GET(new NextRequest("http://crewqual.test/api/admin/calendar/test"), {
    params: Promise.resolve({ id }),
  });

describe("calendar event detail identifiers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.record.mockResolvedValue(null);
    mocks.stage.mockResolvedValue(null);
  });
  it("removes the complete qualification prefix and retains unit scoping", async () => {
    const response = await get(`qualification:${uuid}`);
    expect(response.status).toBe(404);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: uuid, status: "ACTIVE", pilot: { unitId: "unit-a" } },
      }),
    );
  });
  it("opens the qualification identifier produced by the calendar list", async () => {
    const record = {
      id: uuid,
      status: "ACTIVE",
      pilotId: "pilot-a",
      issueDate: new Date("2026-01-01"),
      expiryDate: new Date("2026-12-31"),
      qualificationType: {
        code: "medical",
        name: "Medical",
        validityRule: { kind: "manual_expiry" },
      },
      pilot: {
        displayName: "Pilot",
        employeeNumber: "001",
        unit: { name: "Unit", timezone: "Asia/Shanghai" },
      },
    };
    mocks.records.mockResolvedValue([record]);
    mocks.stages.mockResolvedValue([]);
    mocks.record.mockResolvedValue(record);
    const events = await listAdminCalendarEvents(
      { roles: ["ADMIN"], unitId: "unit-a" } as AuthenticatedAdmin,
      {},
    );
    const response = await get(events[0].id);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      id: events[0].id,
      type: "qualification_expiry",
      qualificationRecord: { recordId: uuid },
    });
  });
  it("retains stage event parsing and scoping", async () => {
    expect((await get(`stage:${uuid}`)).status).toBe(404);
    expect(mocks.stage).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: uuid, plan: { pilot: { unitId: "unit-a" } } } }),
    );
  });
  it.each([
    "qualification:",
    "qualification:broken",
    "stage:",
    "stage:broken",
    `unknown:${uuid}`,
    uuid,
  ])("rejects malformed ID %s before querying UUID columns", async (id) => {
    expect((await get(id)).status).toBe(422);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.stage).not.toHaveBeenCalled();
  });
});
