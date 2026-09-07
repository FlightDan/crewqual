import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("production standalone serves liveness with its RE2 asset @standalone", async ({
  request,
}) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION !== "1", "standalone smoke only");
  const [packageWasm, standaloneWasm] = await Promise.all([
    readFile("node_modules/re2-wasm/build/wasm/re2.wasm"),
    readFile(".next/standalone/.next/server/chunks/re2.wasm"),
  ]);
  expect(standaloneWasm).toEqual(packageWasm);

  const response = await request.get("/api/health?probe=liveness");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toMatch(/no-store/);
  await expect(response.json()).resolves.toMatchObject({
    data: { status: "ok", probe: "liveness" },
  });

  const readinessStartedAt = Date.now();
  const anonymousReadiness = await request.get("/api/health?probe=readiness");
  expect(anonymousReadiness.status()).toBe(401);
  expect(await anonymousReadiness.text()).not.toContain("postgresql://");

  const readiness = await request.get("/api/health?probe=readiness", {
    headers: {
      "x-crewqual-readiness-secret": "standalone-readiness-probe-secret-0123456789",
    },
  });
  const readinessBody = await readiness.text();
  expect(readiness.status()).toBe(503);
  expect(Date.now() - readinessStartedAt).toBeLessThan(10_000);
  expect(JSON.parse(readinessBody)).toMatchObject({
    error: { code: "HEALTHCHECK_FAILED" },
  });
  expect(readinessBody).not.toContain("postgresql://");
  expect(readinessBody).not.toContain("standalone-smoke");

  const devEndpoint = await request.get("/api/dev/pilot-access?employeeNumber=CQ-0001");
  expect(devEndpoint.status()).toBe(404);
});
