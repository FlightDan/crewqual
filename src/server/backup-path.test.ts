import { describe, expect, it } from "vitest";
import { normalizeLocalBackupLocation } from "@/server/backup-path";

describe("local backup path policy", () => {
  it("confines local targets to the mounted /backups volume", () => {
    expect(normalizeLocalBackupLocation("/backups", "crewqual/daily")).toEqual({
      endpoint: "/backups",
      basePath: "crewqual/daily",
    });
  });

  it.each([
    ["/tmp", "crewqual"],
    ["/backups", "../escape"],
    ["/backups", "/absolute"],
    ["/backups", "crewqual/./daily"],
  ])("rejects unsafe local location %s/%s", (endpoint, basePath) => {
    expect(() => normalizeLocalBackupLocation(endpoint, basePath)).toThrow();
  });
});
