import { createHash } from "node:crypto";
import { ApiError } from "@/server/api-error";

/** Version 1 means the stored object was encoded by the server from decoded pixels. */
export const EVIDENCE_STORAGE_ENCODING_VERSION = 1;

export type EvidenceProvenance = {
  objectKey: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  storageEncodingVersion: number;
  sanitizedAt: Date | null;
};

export function evidenceUnavailable(): ApiError {
  return new ApiError("NOT_FOUND", "Evidence not found", 404);
}

export function assertEvidenceProvenance(
  evidence: EvidenceProvenance | null | undefined,
): asserts evidence is EvidenceProvenance {
  if (
    !evidence ||
    evidence.storageEncodingVersion !== EVIDENCE_STORAGE_ENCODING_VERSION ||
    !(evidence.sanitizedAt instanceof Date) ||
    !Number.isFinite(evidence.sanitizedAt.getTime()) ||
    !evidence.objectKey ||
    !["image/jpeg", "image/avif"].includes(evidence.mimeType) ||
    !Number.isSafeInteger(evidence.byteSize) ||
    evidence.byteSize <= 0 ||
    !/^[a-f0-9]{64}$/.test(evidence.sha256)
  ) {
    throw evidenceUnavailable();
  }
}

export function assertEvidenceBytes(
  evidence: Pick<EvidenceProvenance, "sha256" | "byteSize">,
  bytes: Uint8Array,
) {
  if (
    evidence.byteSize !== bytes.byteLength ||
    createHash("sha256").update(bytes).digest("hex") !== evidence.sha256
  ) {
    throw evidenceUnavailable();
  }
}

/** The owner must be resolved from a session or a loaded parent, never request fields. */
export function assertEvidenceOwner(
  evidence: { pilotId: string | null; personId: string | null },
  owner: { id: string; personId: string | null },
) {
  if (
    (!evidence.pilotId && !evidence.personId) ||
    (evidence.pilotId !== null && evidence.pilotId !== owner.id) ||
    (evidence.personId !== null && evidence.personId !== owner.personId)
  )
    throw evidenceUnavailable();
}
