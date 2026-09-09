import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  assertEvidenceBytes,
  assertEvidenceOwner,
  assertEvidenceProvenance,
} from "@/server/evidence-provenance";

const bytes = new Uint8Array([1, 2, 3]);
const evidence = {
  objectKey: "evidence/test.jpg",
  mimeType: "image/jpeg",
  byteSize: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  storageEncodingVersion: 1,
  sanitizedAt: new Date("2026-09-08T00:00:00Z"),
};

describe("evidence provenance", () => {
  it("requires both the supported source version and an actual reconstruction timestamp", () => {
    expect(() => assertEvidenceProvenance(evidence)).not.toThrow();
    for (const invalid of [
      null,
      { ...evidence, storageEncodingVersion: 0 },
      { ...evidence, storageEncodingVersion: 2 },
      { ...evidence, sanitizedAt: null },
      { ...evidence, sanitizedAt: new Date("invalid") },
    ]) {
      expect(() => assertEvidenceProvenance(invalid)).toThrow("Evidence not found");
    }
  });
  it("rejects content or length that conflicts with the database", () => {
    expect(() => assertEvidenceBytes(evidence, bytes)).not.toThrow();
    expect(() => assertEvidenceBytes(evidence, new Uint8Array([1, 2, 4]))).toThrow();
    expect(() => assertEvidenceBytes({ ...evidence, byteSize: 4 }, bytes)).toThrow();
  });
  it("denies missing owners and conflicting legacy/canonical identities", () => {
    const owner = { id: "pilot-a", personId: "person-a" };
    expect(() => assertEvidenceOwner({ pilotId: owner.id, personId: null }, owner)).not.toThrow();
    expect(() => assertEvidenceOwner({ pilotId: owner.id, personId: "person-b" }, owner)).toThrow();
    expect(() =>
      assertEvidenceOwner({ pilotId: "pilot-b", personId: owner.personId }, owner),
    ).toThrow();
    expect(() => assertEvidenceOwner({ pilotId: null, personId: null }, owner)).toThrow();
  });
});
