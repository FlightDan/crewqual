import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteAdminStateProvider } from "@/services/admin-state-provider";

const pathname = vi.hoisted(() => ({ value: "/admin/qualification-config" }));
const serviceMocks = vi.hoisted(() => ({
  pilotDirectory: { list: vi.fn() },
  reviews: { list: vi.fn() },
  upgradePlans: { list: vi.fn() },
  qualificationConfigs: { list: vi.fn() },
  notifications: { list: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
}));

vi.mock("@/services/application-services-provider", () => ({
  useApplicationServices: () => serviceMocks,
}));

const emptyPage = {
  data: { items: [], total: 0, page: 1, pageSize: 100, totalPages: 1 },
  source: "remote" as const,
};

describe("RemoteAdminStateProvider route loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathname.value = "/admin/qualification-config";
    serviceMocks.pilotDirectory.list.mockResolvedValue(emptyPage);
    serviceMocks.reviews.list.mockResolvedValue(emptyPage);
    serviceMocks.upgradePlans.list.mockResolvedValue(emptyPage);
    serviceMocks.qualificationConfigs.list.mockResolvedValue({ data: [], source: "remote" });
    serviceMocks.notifications.list.mockResolvedValue(emptyPage);
  });

  it("does not preload unrelated admin collections on the qualification config route", async () => {
    render(
      <RemoteAdminStateProvider>
        <div>content</div>
      </RemoteAdminStateProvider>,
    );

    await Promise.resolve();
    expect(serviceMocks.pilotDirectory.list).not.toHaveBeenCalled();
    expect(serviceMocks.reviews.list).not.toHaveBeenCalled();
    expect(serviceMocks.upgradePlans.list).not.toHaveBeenCalled();
    expect(serviceMocks.qualificationConfigs.list).not.toHaveBeenCalled();
    expect(serviceMocks.notifications.list).not.toHaveBeenCalled();
  });

  it("keeps the existing preload behavior on other admin routes", async () => {
    pathname.value = "/admin/calendar";
    render(
      <RemoteAdminStateProvider>
        <div>content</div>
      </RemoteAdminStateProvider>,
    );

    await waitFor(() => expect(serviceMocks.pilotDirectory.list).toHaveBeenCalledTimes(1));
    expect(serviceMocks.reviews.list).toHaveBeenCalledWith({ page: 1, pageSize: 100 });
    expect(serviceMocks.upgradePlans.list).toHaveBeenCalledTimes(1);
    expect(serviceMocks.qualificationConfigs.list).toHaveBeenCalledTimes(1);
    expect(serviceMocks.notifications.list).toHaveBeenCalledTimes(1);
  });
});
