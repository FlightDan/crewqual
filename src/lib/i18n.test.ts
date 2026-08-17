import { describe, expect, it } from "vitest";
import { createMessageHelper, translatedValue } from "@/lib/i18n";

describe("message translation seam", () => {
  it("prefers the requested locale and falls back to stable key/default text", () => {
    const message = createMessageHelper(
      { "en-US.member.title": "Members", "member.title": "成员" },
      "en-US",
    );
    expect(message("member.title", "成员管理")).toBe("Members");
    expect(createMessageHelper({ "member.title": "成员" })("member.title", "成员管理")).toBe(
      "成员",
    );
    expect(message("missing", "默认")).toBe("默认");
  });

  it("reads organization translation JSON without failing on malformed values", () => {
    expect(translatedValue({ "zh-CN": "飞行员", "en-US": "Pilot" }, "en-US", "成员")).toBe("Pilot");
    expect(translatedValue(null, "en-US", "成员")).toBe("成员");
  });
});
