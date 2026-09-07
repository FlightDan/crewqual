import { describe, expect, it } from "vitest";
import { pgBossMigrationEnvironment } from "../../scripts/migrate-pg-boss";

describe("pg-boss privileged migration", () => {
  it("passes only the owner URL and safe process settings to the migration CLI", () => {
    const directUrl = "postgresql://owner:secret@postgres:5432/crewqual";
    const environment = pgBossMigrationEnvironment(directUrl, {
      NODE_ENV: "test",
      PATH: "/usr/bin",
      LANG: "C.UTF-8",
      DATABASE_URL: "postgresql://runtime:secret@postgres:5432/crewqual",
      DIRECT_URL: directUrl,
      SESSION_SECRET: "must-not-leak",
      S3_SECRET_ACCESS_KEY: "must-not-leak",
    });

    expect(environment).toEqual({
      PATH: "/usr/bin",
      LANG: "C.UTF-8",
      PGBOSS_DATABASE_URL: directUrl,
      PGBOSS_SCHEMA: "pgboss",
    });
  });
});
