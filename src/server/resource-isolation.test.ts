import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBoss } from "@/server/jobs";
import { getPrisma } from "@/server/prisma";
import { putPrivateEvidence } from "@/server/storage";
import { resetServerConfigForTests } from "@/server/config";

describe("mock backend resource isolation", () => {
  beforeEach(() => {
    process.env.SERVICE_MODE = "mock";
    process.env.NEXT_PUBLIC_SERVICE_MODE = "mock";
    process.env.DATABASE_URL = "postgresql://crewqual:secret@db/crewqual";
    resetServerConfigForTests();
  });

  afterEach(() => {
    delete process.env.SERVICE_MODE;
    delete process.env.NEXT_PUBLIC_SERVICE_MODE;
    delete process.env.DATABASE_URL;
    resetServerConfigForTests();
  });

  it("refuses Prisma and pg-boss initialization", () => {
    expect(() => getPrisma()).toThrow("Database access is disabled in mock mode");
    expect(() => createBoss()).toThrow("Queue access is disabled in mock mode");
  });

  it("refuses object storage access before constructing an S3 client", async () => {
    await expect(putPrivateEvidence(new Uint8Array([1]), "sha256")).rejects.toThrow(
      "Object storage access is disabled in mock mode",
    );
  });
});
