import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { EVIDENCE_STORAGE_ENCODING_VERSION } from "@/server/evidence-provenance";
import { rebuildEvidenceImage } from "@/server/storage";

export type RestorableEvidenceObject = {
  objectKey: string;
  mimeType: "image/jpeg" | "image/avif";
  sha256: string;
  storageEncodingVersion?: number;
  sanitizedAt?: string | null;
};

export type RebuiltRestoreObject = RestorableEvidenceObject & {
  mimeType: "image/jpeg";
  byteSize: number;
  width: number;
  height: number;
  storageEncodingVersion: number;
  sanitizedAt: string;
};

/** Archive provenance alone is not trusted: every restored image is reconstructed. */
export async function prepareRestoredEvidence(source: RestorableEvidenceObject, bytes: Uint8Array) {
  if (
    ![0, EVIDENCE_STORAGE_ENCODING_VERSION].includes(source.storageEncodingVersion ?? 0) ||
    createHash("sha256").update(bytes).digest("hex") !== source.sha256
  )
    throw new Error("RESTORE_EVIDENCE_SOURCE_MISMATCH");
  const rebuilt = await rebuildEvidenceImage(bytes, source.mimeType);
  const object: RebuiltRestoreObject = {
    objectKey: source.objectKey,
    mimeType: "image/jpeg",
    sha256: rebuilt.storageSha256,
    byteSize: rebuilt.storageByteSize,
    width: rebuilt.width,
    height: rebuilt.height,
    storageEncodingVersion: EVIDENCE_STORAGE_ENCODING_VERSION,
    sanitizedAt: new Date().toISOString(),
  };
  return { object, bytes: rebuilt.storageBytes };
}

/** Run immediately after pg_restore, before a restored instance can issue a URL. */
export async function resetRestoredEvidenceTrust(db: Pick<PrismaClient, "$executeRaw">) {
  // Old backups predate these additive columns. Keep their objects closed until
  // the gallery has been reconstructed, regardless of any marker in the dump.
  await db.$executeRaw`ALTER TABLE "EvidenceImage"
    ADD COLUMN IF NOT EXISTS "storageEncodingVersion" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "sanitizedAt" TIMESTAMPTZ(3)`;
  await db.$executeRaw`UPDATE "EvidenceImage" SET "storageEncodingVersion" = 0, "sanitizedAt" = NULL`;
}

/** Called only after verifying and promoting the reconstructed object set. */
export async function finalizeRestoredEvidence(
  db: Pick<PrismaClient, "$transaction">,
  source: ReadonlyMap<string, RestorableEvidenceObject>,
  rebuilt: ReadonlyMap<string, RebuiltRestoreObject>,
) {
  await db.$transaction(
    async (tx) => {
      const images = await tx.evidenceImage.findMany();
      for (const image of images) {
        const original = source.get(image.objectKey);
        const restored = rebuilt.get(image.objectKey);
        if (!original || !restored) {
          if (image.status !== "orphaned") throw new Error("RESTORE_EVIDENCE_MISSING_OBJECT");
          continue;
        }
        if (image.sha256 !== original.sha256 || image.mimeType !== original.mimeType) {
          throw new Error("RESTORE_EVIDENCE_DATABASE_MISMATCH");
        }
        const result = await tx.evidenceImage.updateMany({
          where: {
            id: image.id,
            objectKey: image.objectKey,
            sha256: image.sha256,
            storageEncodingVersion: 0,
            sanitizedAt: null,
          },
          data: {
            mimeType: restored.mimeType,
            width: restored.width,
            height: restored.height,
            byteSize: restored.byteSize,
            sha256: restored.sha256,
            storageEncodingVersion: restored.storageEncodingVersion,
            sanitizedAt: new Date(restored.sanitizedAt),
          },
        });
        if (result.count !== 1) throw new Error("RESTORE_EVIDENCE_CHANGED");
      }
    },
    { timeout: 120_000 },
  );
}
