import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ApiError,
  assertExpectedVersion,
  assertSameOrigin,
  boundedPositiveInt,
  jsonData,
  jsonError,
  parseJson,
} from "@/server/api";
import { resetServerConfigForTests } from "@/server/config";

describe("API transport contract", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ORIGIN", "http://crewqual.test");
    resetServerConfigForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetServerConfigForTests();
  });

  it("returns data and request IDs in both the body and response headers", async () => {
    const response = jsonData({ ok: true }, "request-123", 201);

    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toBe("request-123");
    await expect(response.json()).resolves.toEqual({
      data: { ok: true },
      requestId: "request-123",
    });
  });

  it("normalizes validation, conflict, not-found and image failures without leaking details", async () => {
    const cases = [
      [new z.ZodError([]), 422, "VALIDATION_ERROR"],
      [new Error("VERSION_CONFLICT"), 409, "VERSION_CONFLICT"],
      [new Error("pilot not found"), 404, "NOT_FOUND"],
      [new Error("Only image/jpeg is accepted"), 422, "INVALID_IMAGE"],
      [new Error("database password=secret"), 500, "INTERNAL_ERROR"],
    ] as const;

    for (const [error, status, code] of cases) {
      const response = jsonError(error, "request-error");
      expect(response.status).toBe(status);
      expect(response.headers.get("x-request-id")).toBe("request-error");
      const body = await response.json();
      expect(body.error.code).toBe(code);
      expect(body.error.requestId).toBe("request-error");
      expect(JSON.stringify(body)).not.toContain("password=secret");
    }
  });

  it("preserves structured field errors for ApiError and Zod failures", async () => {
    const apiResponse = jsonError(
      new ApiError("VALIDATION_ERROR", "输入不合法", 422, { email: ["邮箱格式不正确"] }),
      "request-fields",
    );
    expect(await apiResponse.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        fieldErrors: { email: ["邮箱格式不正确"] },
        requestId: "request-fields",
      },
    });

    const schema = z.object({ email: z.string().email() });
    const request = new Request("http://crewqual.test/api/example", {
      method: "POST",
      body: JSON.stringify({ email: "bad" }),
      headers: { "content-type": "application/json" },
    });
    await expect(parseJson(request, schema)).rejects.toMatchObject({ name: "ZodError" });
  });

  it("rejects cross-origin mutations and accepts the configured origin", () => {
    let originError: unknown;
    try {
      assertSameOrigin(
        new Request("http://crewqual.test/api/example", {
          method: "POST",
          headers: { origin: "https://attacker.test" },
        }),
      );
    } catch (error) {
      originError = error;
    }
    expect(originError).toMatchObject({ code: "ORIGIN_MISMATCH", status: 403 });

    expect(() =>
      assertSameOrigin(
        new Request("http://crewqual.test/api/example", {
          method: "POST",
          headers: { origin: "http://crewqual.test" },
        }),
      ),
    ).not.toThrow();

    expect(() =>
      assertSameOrigin(
        new Request("http://crewqual.test/api/example", {
          method: "GET",
        }),
      ),
    ).not.toThrow();
  });

  it("bounds pagination and enforces optimistic versions", () => {
    expect(boundedPositiveInt("0", 7)).toBe(7);
    expect(boundedPositiveInt("9.5", 7)).toBe(7);
    expect(boundedPositiveInt("999", 7, 100)).toBe(100);
    expect(boundedPositiveInt("12", 7)).toBe(12);

    let versionError: unknown;
    try {
      assertExpectedVersion(3, 2);
    } catch (error) {
      versionError = error;
    }
    expect(versionError).toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    expect(() => assertExpectedVersion(3, 3)).not.toThrow();
    expect(() => assertExpectedVersion(3, undefined)).not.toThrow();
  });
});
