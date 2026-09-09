import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  finalizeRestoredEvidence,
  prepareRestoredEvidence,
  resetRestoredEvidenceTrust,
} from "@/server/evidence-restore";

async function sourceFixture() {
  const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } })
    .withMetadata({ exif: { IFD0: { ImageDescription: "PRIVATE-ORIGINAL" } } })
    .jpeg()
    .toBuffer();
  return {
    bytes,
    source: {
      objectKey: "evidence/original.jpg",
      mimeType: "image/jpeg" as const,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

describe("restored evidence source gate", () => {
  it("reconstructs old manifests before any object write and does not trust supplied source markers", async () => {
    const { source, bytes } = await sourceFixture();
    const result = await prepareRestoredEvidence(source, bytes);
    expect(result.object).toMatchObject({
      storageEncodingVersion: 1,
      mimeType: "image/jpeg",
      width: 20,
      height: 10,
    });
    expect(result.object.sha256).not.toBe(source.sha256);
    expect(Buffer.from(result.bytes).includes(Buffer.from("PRIVATE-ORIGINAL"))).toBe(false);
    const allegedlyTrusted = await prepareRestoredEvidence(
      { ...source, storageEncodingVersion: 1, sanitizedAt: new Date().toISOString() },
      bytes,
    );
    expect(allegedlyTrusted.object.sha256).toBe(result.object.sha256);
    await expect(
      prepareRestoredEvidence({ ...source, sha256: "a".repeat(64) }, bytes),
    ).rejects.toThrow("MISMATCH");
    await expect(
      prepareRestoredEvidence({ ...source, storageEncodingVersion: 999 }, bytes),
    ).rejects.toThrow("MISMATCH");
  });

  it("clears dump-supplied trust including old schemas before gallery restore", async () => {
    const execute = vi.fn().mockResolvedValue(1);
    await resetRestoredEvidenceTrust({ $executeRaw: execute } as unknown as Parameters<
      typeof resetRestoredEvidenceTrust
    >[0]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0].join("")).toContain('"storageEncodingVersion" = 0');
  });

  it("only publishes reconstructed metadata against matching restored database rows", async () => {
    const { source, bytes } = await sourceFixture();
    const result = await prepareRestoredEvidence(source, bytes);
    const row = { id: "image-1", status: "linked", ...source };
    const tx = {
      evidenceImage: {
        findMany: vi.fn().mockResolvedValue([row]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const db = {
      $transaction: vi.fn(async (f: (client: typeof tx) => Promise<void>) => f(tx)),
    } as unknown as Parameters<typeof finalizeRestoredEvidence>[0];
    await finalizeRestoredEvidence(
      db,
      new Map([[source.objectKey, source]]),
      new Map([[source.objectKey, result.object]]),
    );
    expect(tx.evidenceImage.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        storageEncodingVersion: 0,
        sanitizedAt: null,
        sha256: source.sha256,
      }),
      data: expect.objectContaining({
        sha256: result.object.sha256,
        storageEncodingVersion: 1,
        sanitizedAt: expect.any(Date),
      }),
    });
    tx.evidenceImage.updateMany.mockClear();
    tx.evidenceImage.findMany.mockResolvedValue([{ ...row, sha256: "b".repeat(64) }]);
    await expect(
      finalizeRestoredEvidence(
        db,
        new Map([[source.objectKey, source]]),
        new Map([[source.objectKey, result.object]]),
      ),
    ).rejects.toThrow("DATABASE_MISMATCH");
    expect(tx.evidenceImage.updateMany).not.toHaveBeenCalled();
    await expect(finalizeRestoredEvidence(db, new Map(), new Map())).rejects.toThrow(
      "MISSING_OBJECT",
    );
  });
});
