import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { reconcileEvidenceSources } from "@/server/evidence-reconciliation";

async function fixture() {
  const original = new Uint8Array(
    await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } })
      .withMetadata({ exif: { IFD0: { ImageDescription: "LEGACY-SOURCE" } } })
      .jpeg()
      .toBuffer(),
  );
  const row = {
    id: "image-1",
    objectKey: "evidence/legacy.jpg",
    mimeType: "image/jpeg",
    byteSize: original.length,
    sha256: createHash("sha256").update(original).digest("hex"),
    storageEncodingVersion: 0,
    sanitizedAt: null as Date | null,
    updatedAt: new Date(),
    pilotId: "pilot-1",
    personId: "person-1",
  };
  const blobs = new Map<string, Uint8Array>([[row.objectKey, original]]);
  const objectMetadata = new Map([
    [
      row.objectKey,
      { contentLength: original.length, contentType: row.mimeType, sha256: row.sha256 },
    ],
  ]);
  const tombstones: Array<{ objectKey: string }> = [];
  const evidenceImage = {
    findMany: vi.fn(async (query: { where?: unknown }) => (query.where ? [] : [{ ...row }])),
    findUnique: vi.fn(async (query: { where: { objectKey: string } }) =>
      query.where.objectKey === row.objectKey ? { ...row } : null,
    ),
    updateMany: vi.fn(async (query: { data: Partial<typeof row> }) => {
      Object.assign(row, query.data);
      return { count: 1 };
    }),
  };
  const galleryObjectTombstone = {
    upsert: vi.fn(async (query: { create: { objectKey: string } }) => {
      tombstones.push(query.create);
    }),
    findMany: vi.fn(async (query: { where: { objectKey?: unknown } }) =>
      query.where.objectKey ? [] : tombstones,
    ),
  };
  const tx = { evidenceImage, galleryObjectTombstone };
  const db = {
    ...tx,
    pilot: { findUnique: vi.fn(async () => ({ id: "pilot-1", personId: "person-1" })) },
    $transaction: vi.fn(async (f: (client: typeof tx) => Promise<unknown>) => f(tx)),
  };
  const objects = {
    read: vi.fn(async (key: string) => {
      const bytes = blobs.get(key);
      if (!bytes) throw new Error("missing");
      return { bytes, ...objectMetadata.get(key) };
    }),
    write: vi.fn(async (key: string, bytes: Uint8Array, contentType: string, sha256: string) => {
      blobs.set(key, bytes);
      objectMetadata.set(key, { contentLength: bytes.length, contentType, sha256 });
    }),
    remove: vi.fn(async (key: string) => {
      blobs.delete(key);
      objectMetadata.delete(key);
    }),
  };
  return {
    row,
    db: db as unknown as Parameters<typeof reconcileEvidenceSources>[0],
    evidenceImage,
    blobs,
    objects,
    objectMetadata,
    tombstones,
  };
}

describe("restartable evidence reconciliation", () => {
  it("atomically switches rebuilt objects, deletes the retired bytes and resumes without rebuilding", async () => {
    const f = await fixture();
    const sourceKey = f.row.objectKey;
    const report = await reconcileEvidenceSources(f.db, { objects: f.objects });
    expect(report).toMatchObject({ rebuilt: 1, conflicts: 0, failures: [] });
    expect(f.row.storageEncodingVersion).toBe(1);
    expect(f.row.objectKey).not.toBe(sourceKey);
    expect(f.blobs.has(sourceKey)).toBe(false);
    expect(f.tombstones).toEqual([expect.objectContaining({ objectKey: sourceKey })]);
    const resumed = await reconcileEvidenceSources(f.db, { objects: f.objects });
    expect(resumed).toMatchObject({ rebuilt: 0, verified: 1, failures: [] });
    expect(f.objects.write).toHaveBeenCalledTimes(1);
  });
  it("keeps corrupt or mismatched sources unreadable without publishing replacement metadata", async () => {
    const f = await fixture();
    f.row.storageEncodingVersion = 1;
    f.row.sanitizedAt = new Date();
    f.blobs.set(f.row.objectKey, new Uint8Array([1, 2, 3]));
    const report = await reconcileEvidenceSources(f.db, { objects: f.objects });
    expect(report.failures).toEqual([{ id: "image-1", reason: "invalid_source" }]);
    expect(f.row.storageEncodingVersion).toBe(0);
    expect(f.row.sanitizedAt).toBeNull();
    expect(f.objects.write).not.toHaveBeenCalled();
  });
  it("rejects a marked object whose storage metadata would block URL issuance", async () => {
    const f = await fixture();
    f.row.storageEncodingVersion = 1;
    f.row.sanitizedAt = new Date();
    f.objectMetadata.set(f.row.objectKey, {
      contentLength: f.row.byteSize,
      contentType: f.row.mimeType,
      sha256: "wrong",
    });
    const report = await reconcileEvidenceSources(f.db, { objects: f.objects });
    expect(report.failures).toEqual([{ id: "image-1", reason: "invalid_source" }]);
    expect(f.row.storageEncodingVersion).toBe(0);
    expect(f.row.sanitizedAt).toBeNull();
  });
  it("does not overwrite a concurrent database change", async () => {
    const f = await fixture();
    const sourceKey = f.row.objectKey;
    f.evidenceImage.updateMany.mockImplementation(async () => ({ count: 0 }));
    const report = await reconcileEvidenceSources(f.db, { objects: f.objects });
    expect(report.conflicts).toBe(1);
    expect(f.row.objectKey).toBe(sourceKey);
    expect(f.tombstones).toEqual([]);
    expect(f.blobs.size).toBe(1);
  });
  it("retries retired-object cleanup after an interruption without re-encoding the published object", async () => {
    const f = await fixture();
    f.objects.remove.mockRejectedValueOnce(new Error("storage unavailable"));
    const first = await reconcileEvidenceSources(f.db, { objects: f.objects });
    expect(first.failures).toContainEqual({ id: "retired-object", reason: "cleanup_failed" });
    const second = await reconcileEvidenceSources(f.db, { objects: f.objects });
    expect(second).toMatchObject({ rebuilt: 0, verified: 1, failures: [] });
    expect(f.blobs.size).toBe(1);
  });
});
