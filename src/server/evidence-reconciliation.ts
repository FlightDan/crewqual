import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  assertEvidenceBytes,
  assertEvidenceOwner,
  assertEvidenceProvenance,
  EVIDENCE_STORAGE_ENCODING_VERSION,
} from "@/server/evidence-provenance";
import {
  deletePrivateEvidence,
  putPrivateObjectAtKey,
  readPrivateEvidenceObject,
  rebuildEvidenceImage,
  type PrivateEvidenceObject,
} from "@/server/storage";

type ReconciliationDb = Pick<
  PrismaClient,
  "evidenceImage" | "pilot" | "galleryObjectTombstone" | "$transaction"
>;
type ObjectAccess = {
  read: (key: string) => Promise<PrivateEvidenceObject>;
  write: typeof putPrivateObjectAtKey;
  remove: typeof deletePrivateEvidence;
};

export type EvidenceReconciliationReport = {
  inspected: number;
  rebuilt: number;
  verified: number;
  conflicts: number;
  failures: Array<{ id: string; reason: "invalid_source" | "cleanup_failed" }>;
};

/**
 * Restarting is safe: source metadata forms a compare-and-swap, generated keys
 * are deterministic, and replaced objects have a durable deletion tombstone.
 * No original bytes or storage keys are included in the operator report.
 */
export async function reconcileEvidenceSources(
  db: ReconciliationDb,
  options: { batchSize?: number; objects?: ObjectAccess } = {},
): Promise<EvidenceReconciliationReport> {
  const objects = options.objects ?? {
    read: readPrivateEvidenceObject,
    write: putPrivateObjectAtKey,
    remove: deletePrivateEvidence,
  };
  const report: EvidenceReconciliationReport = {
    inspected: 0,
    rebuilt: 0,
    verified: 0,
    conflicts: 0,
    failures: [],
  };
  const batchSize = Math.min(100, Math.max(1, options.batchSize ?? 25));
  let cursor: string | undefined;
  while (true) {
    const images = await db.evidenceImage.findMany({
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { where: { id: { gt: cursor } } } : {}),
    });
    if (!images.length) break;
    for (const image of images) {
      cursor = image.id;
      report.inspected += 1;
      const unchangedSource = {
        id: image.id,
        objectKey: image.objectKey,
        sha256: image.sha256,
        updatedAt: image.updatedAt,
        storageEncodingVersion: image.storageEncodingVersion,
        sanitizedAt: image.sanitizedAt,
      };
      try {
        const owner = image.pilotId
          ? await db.pilot.findUnique({ where: { id: image.pilotId } })
          : image.personId
            ? await db.pilot.findUnique({ where: { personId: image.personId } })
            : null;
        if (!owner) throw new Error("MISSING_OWNER");
        assertEvidenceOwner(image, owner);
        const source = await objects.read(image.objectKey);
        assertEvidenceBytes(image, source.bytes);
        if (
          image.storageEncodingVersion === EVIDENCE_STORAGE_ENCODING_VERSION &&
          image.sanitizedAt
        ) {
          assertEvidenceProvenance(image);
          if (
            source.contentLength !== image.byteSize ||
            source.contentType !== image.mimeType ||
            source.sha256 !== image.sha256
          ) {
            throw new Error("OBJECT_METADATA_MISMATCH");
          }
          report.verified += 1;
          continue;
        }
        const rebuilt = await rebuildEvidenceImage(source.bytes, image.mimeType);
        const suffix = createHash("sha256")
          .update(`${image.objectKey}\0${image.sha256}\0${image.updatedAt.toISOString()}`)
          .digest("hex");
        const objectKey = `evidence/rebuilt-v1/${image.id}/${suffix}.jpg`;
        await objects.write(objectKey, rebuilt.storageBytes, "image/jpeg", rebuilt.storageSha256);
        const changed = await db.$transaction(async (tx) => {
          const result = await tx.evidenceImage.updateMany({
            where: unchangedSource,
            data: {
              objectKey,
              mimeType: "image/jpeg",
              width: rebuilt.width,
              height: rebuilt.height,
              byteSize: rebuilt.storageByteSize,
              sha256: rebuilt.storageSha256,
              storageEncodingVersion: EVIDENCE_STORAGE_ENCODING_VERSION,
              sanitizedAt: new Date(),
            },
          });
          if (result.count !== 1) return false;
          await tx.galleryObjectTombstone.upsert({
            where: { objectKey: image.objectKey },
            create: { objectKey: image.objectKey, deletedAt: new Date(), reason: "DELETED" },
            update: { deletedAt: new Date(), reason: "DELETED" },
          });
          return true;
        });
        if (!changed) {
          report.conflicts += 1;
          // Another reconciler may have published this same deterministic key.
          if (!(await db.evidenceImage.findUnique({ where: { objectKey } }))) {
            await objects.remove(objectKey);
          }
          continue;
        }
        report.rebuilt += 1;
      } catch {
        // A previously marked but inconsistent object must become unreadable too.
        await db.evidenceImage.updateMany({
          where: unchangedSource,
          data: { storageEncodingVersion: 0, sanitizedAt: null },
        });
        report.failures.push({ id: image.id, reason: "invalid_source" });
      }
    }
  }
  // Repeatable even after a crash between the database switch and object removal.
  let tombstoneCursor: string | undefined;
  while (true) {
    const tombstones = await db.galleryObjectTombstone.findMany({
      where: {
        reason: "DELETED",
        ...(tombstoneCursor ? { objectKey: { gt: tombstoneCursor } } : {}),
      },
      orderBy: { objectKey: "asc" },
      take: batchSize,
    });
    if (!tombstones.length) break;
    for (const tombstone of tombstones) {
      tombstoneCursor = tombstone.objectKey;
      if (await db.evidenceImage.findUnique({ where: { objectKey: tombstone.objectKey } }))
        continue;
      try {
        await objects.remove(tombstone.objectKey);
      } catch {
        report.failures.push({ id: "retired-object", reason: "cleanup_failed" });
      }
    }
  }
  return report;
}
