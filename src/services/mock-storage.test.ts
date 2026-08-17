import { beforeEach, describe, expect, it } from "vitest";
import { clearMockStorage, mockStorageKey } from "@/services/temp-storage";

describe("instance-scoped mock storage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    document.body.dataset.mockInstanceId = "instance-a";
  });

  it("does not restore data from a previous instance", () => {
    window.sessionStorage.setItem(mockStorageKey("admin-state"), "old-state");
    document.body.dataset.mockInstanceId = "instance-b";

    expect(window.sessionStorage.getItem(mockStorageKey("admin-state"))).toBeNull();
    expect(window.sessionStorage.getItem("crewqual:mock:instance-a:admin-state")).toBe("old-state");
  });

  it("clears only namespaced mock data", () => {
    window.sessionStorage.setItem(mockStorageKey("admin-state"), "state");
    window.sessionStorage.setItem("unrelated-key", "keep");

    clearMockStorage();

    expect(window.sessionStorage.getItem(mockStorageKey("admin-state"))).toBeNull();
    expect(window.sessionStorage.getItem("unrelated-key")).toBe("keep");
  });
});
