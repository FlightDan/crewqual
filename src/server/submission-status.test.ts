import { describe, expect, it } from "vitest";
import { toSubmissionStatus } from "@/server/submission-status";

describe("submission status serialization", () => {
  it.each([
    ["PENDING", "processing"],
    ["APPROVED", "approved"],
    ["RETURNED", "returned"],
    ["unknown", "received"],
  ] as const)("maps %s to the pilot-facing status %s", (input, expected) => {
    expect(toSubmissionStatus(input)).toBe(expected);
  });
});
