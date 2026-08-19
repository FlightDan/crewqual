import { describe, expect, it } from "vitest";
import { messageKeys, messages, translate } from "@/lib/messages";

describe("message dictionaries", () => {
  it("keeps the supported locale key sets identical", () => {
    expect(Object.keys(messages["en-US"]).sort()).toEqual(messageKeys());
  });

  it("interpolates values without changing business data", () => {
    expect(translate("en-US", "navigation.unit", { unit: "Flight Ops" })).toBe("Unit: Flight Ops");
  });
});
