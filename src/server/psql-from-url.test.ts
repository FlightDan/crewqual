import { describe, expect, it } from "vitest";

import {
  minimalSubprocessEnvironment,
  postgresEnvironmentFromUrl,
} from "@/server/postgres-client-environment";

describe("postgresEnvironmentFromUrl", () => {
  it("decomposes credentials without forwarding complete URLs or inherited libpq state", () => {
    const result = postgresEnvironmentFromUrl(
      "postgresql://crewqual%5Fowner:p%40ss%2Fword@db.internal:6543/crew%2Fqual?schema=public&sslmode=verify-full&connect_timeout=7",
      {
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://should:not@leak.invalid/db",
        DIRECT_URL: "postgresql://should:not@leak.invalid/db",
        PGHOST: "attacker.invalid",
        PGSERVICEFILE: "/tmp/attacker.conf",
        POSTGRES_APP_PASSWORD: "kept-for-psql-getenv",
      },
    );

    expect(result).toMatchObject({
      PGHOST: "db.internal",
      PGPORT: "6543",
      PGDATABASE: "crew/qual",
      PGUSER: "crewqual_owner",
      PGPASSWORD: "p@ss/word",
      PGSSLMODE: "verify-full",
      PGCONNECT_TIMEOUT: "7",
      POSTGRES_APP_PASSWORD: "kept-for-psql-getenv",
    });
    expect(result.DATABASE_URL).toBeUndefined();
    expect(result.DIRECT_URL).toBeUndefined();
    expect(result.PGSERVICEFILE).toBeUndefined();
  });

  it("rejects ambiguous or unsupported connection options", () => {
    expect(() =>
      postgresEnvironmentFromUrl("postgresql://user:pass@db/app?sslmode=require&sslmode=disable"),
    ).toThrow("repeats option sslmode");
    expect(() =>
      postgresEnvironmentFromUrl("postgresql://user:pass@db/app?unknown_option=true"),
    ).toThrow("unknown_option is not supported");
    expect(() => postgresEnvironmentFromUrl("https://user:pass@db/app")).toThrow(
      "must use postgres:// or postgresql://",
    );
  });

  it("passes only explicitly allowed operating-system variables to child processes", () => {
    const result = minimalSubprocessEnvironment(
      {
        NODE_ENV: "test",
        PATH: "/usr/bin",
        HOME: "/home/node",
        DATABASE_URL: "postgresql://user:secret@db/app",
        SESSION_SECRET: "do-not-forward",
        AWS_SECRET_ACCESS_KEY: "do-not-forward",
        POSTGRES_APP_PASSWORD: "explicit-only",
      },
      ["POSTGRES_APP_PASSWORD"],
    );

    expect(result).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/node",
      POSTGRES_APP_PASSWORD: "explicit-only",
    });
  });
});
