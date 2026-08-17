import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitDeliveryFailureAlert, emitPilotNotification } from "@/server/notifications";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn().mockResolvedValue("job-1"),
  integration: vi.fn().mockResolvedValue({ retryLimit: 4 }),
}));

vi.mock("@/server/jobs", () => ({
  QUEUES: { notifications: "crewqual.notifications" },
  enqueueInTransaction: mocks.enqueue,
}));
vi.mock("@/server/runtime-settings", () => ({
  getRuntimeIntegration: mocks.integration,
}));

function txWithInsertCounts(counts: number[]) {
  return {
    pilot: {
      findUnique: vi.fn().mockResolvedValue({
        id: "00000000-0000-0000-0000-000000000001",
        employeeNumber: "CQ-1",
        mobile: "13800138000",
        active: true,
        unit: {
          notificationRouting: [
            {
              key: "qualification_expiry",
              channels: ["inApp", "sms", "feishu"],
            },
          ],
          notificationChannelState: { inApp: true, sms: true, feishu: true },
        },
      }),
    },
    notificationDelivery: {
      createMany: vi.fn().mockImplementation(() => ({ count: counts.shift() ?? 0 })),
    },
  };
}

describe("unified notification outbox", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds newly enabled channels even when the in-app channel already exists", async () => {
    const tx = txWithInsertCounts([0, 1, 1]);
    await expect(
      emitPilotNotification(tx, {
        eventKey: "qualification-expiry:record-1:second",
        type: "qualification_expiry",
        pilotId: "00000000-0000-0000-0000-000000000001",
        summary: "即将到期",
        message: "还有 30 天到期",
      }),
    ).resolves.toMatchObject({ created: 2, queued: 2 });
    expect(tx.notificationDelivery.createMany).toHaveBeenCalledTimes(3);
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when a concurrent scan already inserted every channel", async () => {
    const tx = txWithInsertCounts([0, 0, 0]);
    await expect(
      emitPilotNotification(tx, {
        eventKey: "qualification-expiry:record-1:second",
        type: "qualification_expiry",
        pilotId: "00000000-0000-0000-0000-000000000001",
        summary: "即将到期",
        message: "还有 30 天到期",
      }),
    ).resolves.toMatchObject({ created: 0, queued: 0 });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("creates one stable, admin-visible alert for a terminal delivery failure", async () => {
    const tx = {
      notificationDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    await expect(
      emitDeliveryFailureAlert(tx, {
        deliveryId: "delivery-1",
        pilotId: "00000000-0000-0000-0000-000000000001",
        channel: "SMS",
        summary: "资质到期提醒",
        errorCategory: "provider_http",
        finalFailureReason: "provider_http",
        failedAt: new Date("2026-08-16T00:00:00Z"),
      }),
    ).resolves.toMatchObject({ created: 1, alertId: expect.any(String) });
    expect(tx.notificationDelivery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          dedupeKey: "delivery-failed:delivery-1:in_app",
          type: "DELIVERY_FAILED",
          channel: "IN_APP",
          status: "SENT",
          target: "ADMIN_NOTIFICATION_LOG",
        }),
      ],
      skipDuplicates: true,
    });
  });
});
