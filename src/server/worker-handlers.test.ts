import { describe, expect, it, vi } from "vitest";
import { emitDeliveryFailureAlert, emitPilotNotification } from "@/server/notifications";
import {
  processCleanupJob,
  processNotificationJob,
  processRecognitionJob,
  processReminderJob,
} from "@/server/worker-handlers";

vi.mock("@/server/jobs", () => ({
  QUEUES: { notifications: "crewqual.notifications" },
  enqueueInTransaction: vi.fn().mockResolvedValue("job-1"),
}));
vi.mock("@/server/notifications", () => ({
  emitPilotNotification: vi.fn().mockResolvedValue({ created: 1, queued: 0 }),
  emitDeliveryFailureAlert: vi.fn().mockResolvedValue({ created: 1, alertId: "alert-1" }),
}));
vi.mock("@/server/qualification-verification", () => ({
  persistVerificationForEvidence: vi.fn().mockResolvedValue({ id: "verification-1" }),
}));

function notificationDb(delivery: Record<string, unknown> | null, latestAttempt: unknown = null) {
  const tx = {
    notificationAttempt: { create: vi.fn().mockResolvedValue({}) },
    notificationDelivery: { update: vi.fn().mockResolvedValue({}) },
  };
  return {
    notificationDelivery: {
      findFirst: vi.fn().mockResolvedValue(delivery),
      updateMany: vi.fn().mockResolvedValue({ count: delivery ? 1 : 0 }),
    },
    notificationAttempt: {
      findFirst: vi.fn().mockResolvedValue(latestAttempt),
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    tx,
  };
}

describe("worker handlers", () => {
  it("writes queued and sent attempts for local in-app delivery", async () => {
    const db = notificationDb({
      id: "delivery-1",
      channel: "IN_APP",
      target: "pilot-1",
      message: "节点已更新",
    });
    const adapters = {
      sms: { send: vi.fn() },
      feishu: { send: vi.fn() },
    };

    await expect(
      processNotificationJob(
        db,
        { pilotId: "pilot-1", type: "STAGE_RESCHEDULED" },
        adapters,
        new Date("2026-08-15T08:00:00.000Z"),
      ),
    ).resolves.toEqual({ status: "sent" });
    expect(adapters.sms.send).not.toHaveBeenCalled();
    expect(adapters.feishu.send).not.toHaveBeenCalled();
    expect(db.tx.notificationAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT", attemptNumber: 1 }),
      }),
    );
    expect(db.tx.notificationDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SENT",
          startedAt: null,
          sentAt: expect.any(Date),
        }),
      }),
    );
    expect(emitDeliveryFailureAlert).not.toHaveBeenCalled();
  });

  it("records failed adapter delivery without claiming it was sent", async () => {
    const db = notificationDb({
      id: "delivery-2",
      channel: "SMS",
      target: "13800138000",
      message: "测试通知",
    });
    const adapters = {
      sms: { send: vi.fn().mockResolvedValue({ accepted: false }) },
      feishu: { send: vi.fn() },
    };

    await expect(
      processNotificationJob(db, { pilotId: "pilot-1", type: "REMINDER" }, adapters),
    ).resolves.toEqual({ status: "failed" });
    expect(adapters.sms.send).toHaveBeenCalledWith({
      mobile: "13800138000",
      message: "测试通知",
      idempotencyKey: "delivery-2",
    });
    expect(db.tx.notificationAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
    expect(db.tx.notificationDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", startedAt: null, sentAt: null }),
      }),
    );
    expect(emitDeliveryFailureAlert).toHaveBeenCalledWith(
      db.tx,
      expect.objectContaining({
        deliveryId: "delivery-2",
        pilotId: "pilot-1",
        channel: "SMS",
        errorCategory: "provider_rejected",
      }),
    );
  });

  it("ignores a job whose queued delivery no longer exists", async () => {
    const db = notificationDb(null);
    const adapters = { sms: { send: vi.fn() }, feishu: { send: vi.fn() } };

    await expect(
      processNotificationJob(db, { pilotId: "pilot-1", type: "REMINDER" }, adapters),
    ).resolves.toEqual({ status: "ignored" });
    expect(db.notificationAttempt.create).not.toHaveBeenCalled();
    expect(adapters.sms.send).not.toHaveBeenCalled();
  });

  it("completes recognition and persists a verification result atomically", async () => {
    const tx = {
      recognitionTask: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const db = {
      recognitionTask: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "task-1", status: "QUEUED", attemptCount: 0, retryLimit: 3 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "task-1",
          status: "RUNNING",
          attemptCount: 1,
          retryLimit: 3,
          evidenceImage: { objectKey: "e/1.jpg" },
        }),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const recognize = vi.fn().mockResolvedValue({
      available: true,
      provider: "fake",
      fields: {},
    });

    await expect(
      processRecognitionJob(
        db,
        { recognitionId: "task-1", updateRequestId: "request-1", evidenceImageId: "image-1" },
        recognize,
        new Date("2026-08-15T08:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ status: "completed" });
    expect(recognize).toHaveBeenCalledWith("e/1.jpg");
    expect(tx.recognitionTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }),
    );
  });

  it("marks recognition failed and rethrows the worker error", async () => {
    const db = {
      recognitionTask: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "task-2", status: "QUEUED", attemptCount: 0, retryLimit: 3 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "task-2",
          status: "RUNNING",
          attemptCount: 1,
          retryLimit: 3,
          evidenceImage: { objectKey: "e/2.jpg" },
        }),
      },
      $transaction: vi.fn(),
    };
    const recognize = vi.fn().mockRejectedValue(new Error("provider unavailable"));

    await expect(
      processRecognitionJob(db, { recognitionId: "task-2", evidenceImageId: "image-2" }, recognize),
    ).rejects.toThrow("provider unavailable");
    expect(db.recognitionTask.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "QUEUED", errorCode: "Error" }),
      }),
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("atomically claims one extraction when two workers race", async () => {
    let claimed = false;
    const tx = { recognitionTask: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const db = {
      recognitionTask: {
        updateMany: vi.fn().mockImplementation((input) => {
          if (!input.where.id) return { count: 0 };
          if (claimed) return { count: 0 };
          claimed = true;
          return { count: 1 };
        }),
        findUnique: vi.fn().mockImplementation(() => ({
          id: "task-race",
          status: claimed ? "RUNNING" : "QUEUED",
          attemptCount: 0,
          retryLimit: 3,
          result: null,
        })),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "task-race",
          status: "RUNNING",
          attemptCount: 1,
          retryLimit: 3,
          evidenceImage: { objectKey: "e/race.jpg" },
        }),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const recognize = vi.fn().mockResolvedValue({ available: true, provider: "fake", fields: {} });
    const payload = { recognitionId: "task-race", evidenceImageId: "image-race" };

    const results = await Promise.all([
      processRecognitionJob(db, payload, recognize),
      processRecognitionJob(db, payload, recognize),
    ]);

    expect(recognize).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.status).sort()).toEqual(["completed", "ignored"]);
  });

  it("deletes only expired orphaned images and tolerates storage cleanup failures", async () => {
    const db = {
      evidenceImage: {
        findMany: vi.fn().mockResolvedValue([
          { id: "image-1", objectKey: "e/1.jpg" },
          { id: "image-2", objectKey: "e/2.jpg" },
        ]),
        delete: vi.fn().mockResolvedValue({}),
      },
    };
    const deleteEvidence = vi
      .fn()
      .mockRejectedValueOnce(new Error("object already absent"))
      .mockResolvedValueOnce(undefined);

    await expect(
      processCleanupJob(db, deleteEvidence, new Date("2026-08-15T08:00:00.000Z")),
    ).resolves.toEqual({ deleted: 1 });
    expect(db.evidenceImage.findMany).toHaveBeenCalledWith({
      where: { status: "orphaned", expiresAt: { lt: new Date("2026-08-15T08:00:00.000Z") } },
      take: 100,
    });
    expect(db.evidenceImage.delete).toHaveBeenCalledTimes(1);
  });

  it("returns a deterministic reminder scan timestamp", async () => {
    await expect(processReminderJob(new Date("2026-08-15T08:00:00.000Z"))).resolves.toEqual({
      scannedAt: "2026-08-15T08:00:00.000Z",
    });
  });

  it("routes one deduplicated reminder through the unified outbox", async () => {
    const tx = {};
    const db = {
      qualificationRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "record-1",
            pilotId: "pilot-1",
            expiryDate: new Date("2026-08-20T00:00:00.000Z"),
            pilot: {
              displayName: "张三",
              mobile: "13800000000",
              unit: { timezone: "Asia/Shanghai" },
            },
            qualificationType: {
              name: "危险品运输培训合格证",
              reminders: { firstDays: 90, secondDays: 30 },
            },
          },
        ]),
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(processReminderJob(db, new Date("2026-08-15T00:00:00.000Z"))).resolves.toEqual({
      scannedAt: "2026-08-15T00:00:00.000Z",
      scanned: 1,
      created: 1,
    });
    expect(emitPilotNotification).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventKey: "qualification-expiry:record-1:second",
        type: "qualification_expiry",
      }),
    );
  });

  it("retries twice with backoff and succeeds on the third provider attempt", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ accepted: false })
      .mockRejectedValueOnce(new Error("SMS webhook HTTP 503"))
      .mockResolvedValueOnce({ accepted: true, providerId: "sms-3" });
    const adapters = { sms: { send }, feishu: { send: vi.fn() } };
    const base = {
      id: "delivery-retry",
      dedupeKey: "event:pilot:sms",
      channel: "SMS",
      target: "13800138000",
      message: "测试通知",
      retryLimit: 2,
      retryCycle: 0,
    };

    await expect(
      processNotificationJob(
        notificationDb({ ...base, attemptCount: 0 }),
        { pilotId: "pilot-1", type: "REMINDER" },
        adapters,
        new Date("2026-08-15T00:00:00Z"),
      ),
    ).resolves.toMatchObject({ status: "retrying", retryAt: new Date("2026-08-15T00:00:30Z") });
    await expect(
      processNotificationJob(
        notificationDb({ ...base, attemptCount: 1 }),
        { pilotId: "pilot-1", type: "REMINDER" },
        adapters,
        new Date("2026-08-15T00:00:30Z"),
      ),
    ).resolves.toMatchObject({ status: "retrying", retryAt: new Date("2026-08-15T00:01:30Z") });
    await expect(
      processNotificationJob(
        notificationDb({ ...base, attemptCount: 2 }),
        { pilotId: "pilot-1", type: "REMINDER" },
        adapters,
        new Date("2026-08-15T00:01:30Z"),
      ),
    ).resolves.toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledTimes(3);
  });
});
