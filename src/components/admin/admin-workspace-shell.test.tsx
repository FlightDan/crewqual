import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminWorkspaceShell } from "@/components/admin/admin-workspace-shell";

const mocks = vi.hoisted(() => ({
  state: { reviews: [] as Array<{ humanStatus: string }> },
  list: vi.fn(),
}));

vi.mock("@/services/admin-state-provider", () => ({
  useAdminState: () => mocks.state,
}));

vi.mock("@/services/application-services-provider", () => ({
  useApplicationServices: () => ({ reviews: { list: mocks.list } }),
}));

vi.mock("@/components/layout/admin-shell", () => ({
  AdminShell: ({
    children,
    pendingReviewCount,
  }: {
    children: React.ReactNode;
    pendingReviewCount: number;
  }) => (
    <div data-testid="pending-review-count" data-count={pendingReviewCount}>
      {children}
    </div>
  ),
}));

function renderShell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminWorkspaceShell>content</AdminWorkspaceShell>
    </QueryClientProvider>,
  );
}

describe("AdminWorkspaceShell pending review count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.reviews = [];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the paginated total from a lightweight remote request", async () => {
    vi.stubEnv("NEXT_PUBLIC_SERVICE_MODE", "remote");
    mocks.list.mockResolvedValue({
      data: { items: [], total: 37, page: 1, pageSize: 1, totalPages: 37 },
      source: "remote",
    });
    renderShell();

    await waitFor(() =>
      expect(screen.getByTestId("pending-review-count")).toHaveAttribute("data-count", "37"),
    );
    expect(mocks.list).toHaveBeenCalledWith({ status: "pending", page: 1, pageSize: 1 });
  });

  it("derives the count locally in mock mode without requesting the service", () => {
    vi.stubEnv("NEXT_PUBLIC_SERVICE_MODE", "mock");
    mocks.state.reviews = [
      { humanStatus: "pending" },
      { humanStatus: "approved" },
      { humanStatus: "pending" },
    ];
    renderShell();

    expect(screen.getByTestId("pending-review-count")).toHaveAttribute("data-count", "2");
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
