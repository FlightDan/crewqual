import { beforeEach, describe, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({
  readVerifiedEvidence: vi.fn(),
  convertJpegToLosslessAvif: vi.fn(),
  putPrivateObject: vi.fn(),
  deletePrivateEvidence: vi.fn(),
}));
vi.mock("@/server/storage", () => storage);
import { processImageOptimizationJob } from "@/server/worker-handlers";

function database(mutation: Record<string, unknown> = {}) {
  const image = {
    id: "image-1",
    objectKey: "evidence/1.jpg",
    mimeType: "image/jpeg",
    byteSize: 3,
    sha256: "a".repeat(64),
    storageEncodingVersion: 1,
    sanitizedAt: new Date(),
    pilotId: "pilot-1",
    personId: "person-1",
    pilot: { id: "pilot-1", personId: "person-1", active: true },
    ...mutation,
  };
  const task = {
    id: "optimization-1",
    evidenceImageId: "image-1",
    sourceObjectKey: "evidence/1.jpg",
    evidenceImage: image,
  };
  const tx = {
    evidenceImage: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    imageOptimizationTask: { update: vi.fn() },
  };
  return {
    mediaOptimizationSetting: {
      findUnique: vi.fn().mockResolvedValue({ enabled: true, idleMinutes: 5 }),
    },
    recognitionTask: { count: vi.fn().mockResolvedValue(0) },
    evidenceImage: { findMany: vi.fn().mockResolvedValue([]) },
    imageOptimizationTask: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([task]),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx)),
    tx,
  };
}

describe("gallery optimization provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.readVerifiedEvidence.mockResolvedValue(new Uint8Array([1, 2, 3]));
    storage.convertJpegToLosslessAvif.mockResolvedValue({
      storageBytes: new Uint8Array([4, 5]),
      sha256: "b".repeat(64),
      byteSize: 2,
      width: 20,
      height: 10,
    });
    storage.putPrivateObject.mockResolvedValue("evidence/generated.avif");
  });
  it("rejects legacy, changed-key and conflicting-owner tasks before object access", async () => {
    for (const mutation of [
      { storageEncodingVersion: 0 },
      { objectKey: "evidence/changed.jpg" },
      { personId: "other" },
    ]) {
      const db = database(mutation);
      await expect(processImageOptimizationJob(db)).resolves.toMatchObject({ converted: 0 });
      expect(storage.readVerifiedEvidence).not.toHaveBeenCalled();
      expect(storage.putPrivateObject).not.toHaveBeenCalled();
    }
  });
  it("keeps provenance and compares source identity during the atomic conversion switch", async () => {
    const db = database();
    await expect(processImageOptimizationJob(db)).resolves.toMatchObject({ converted: 1 });
    expect(db.tx.evidenceImage.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        storageEncodingVersion: 1,
        sanitizedAt: expect.any(Date),
        sha256: "a".repeat(64),
        objectKey: "evidence/1.jpg",
      }),
      data: expect.objectContaining({
        objectKey: "evidence/generated.avif",
        sha256: "b".repeat(64),
      }),
    });
  });
});
