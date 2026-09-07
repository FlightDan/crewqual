import { describe, expect, it } from "vitest";
import {
  compileLinearRegex,
  LinearRegexValidationError,
  testLinearRegex,
} from "@/lib/regex-safety";

describe("linear-time qualification regex", () => {
  it("accepts the existing A320 rule and matches through RE2", () => {
    const pattern = "^A320-(I|II)$";
    expect(compileLinearRegex(pattern).test("A320-I")).toBe(true);
    expect(testLinearRegex(pattern, "A320-II")).toBe(true);
    expect(testLinearRegex(pattern, "A320-III")).toBe(false);
  });

  it("rejects lookaround and backreferences with a clear validation error", () => {
    for (const pattern of ["(?=a)a", "(a)\\1", "(?<!a)b", "(?<name>a)\\k<name>"]) {
      expect(() => compileLinearRegex(pattern)).toThrow(LinearRegexValidationError);
      expect(() => compileLinearRegex(pattern)).toThrow("不支持环视和反向引用");
    }
  });

  it("handles the ambiguous catastrophic-backtracking pattern quickly", () => {
    const pattern = "^(a|aa)+$";
    // Warm up the WASM module so this regression measures matching rather than
    // one-time engine initialization.
    expect(testLinearRegex("^", "")).toBe(true);
    const startedAt = performance.now();
    expect(testLinearRegex(pattern, `${"a".repeat(256)}b`)).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(250);
  });

  it("rejects invalid RE2 syntax instead of falling back to JavaScript RegExp", () => {
    expect(() => compileLinearRegex("[unterminated")).toThrow(LinearRegexValidationError);
  });
});
