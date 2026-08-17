import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewListView } from "@/components/admin/review-list-view";
import { AdminStateProvider } from "@/services/admin-state-provider";
import { adminStateStore } from "@/services/admin-state-store";

const replace = vi.fn();
const params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/reviews",
  useRouter: () => ({ replace }),
  useSearchParams: () => params,
}));

describe("ReviewListView URL filters", () => {
  beforeEach(() => {
    replace.mockReset();
    params.forEach((_, key) => params.delete(key));
    window.sessionStorage.clear();
    adminStateStore.reset();
  });

  it("writes AI filters to the URL", async () => {
    const user = userEvent.setup();
    render(
      <AdminStateProvider>
        <ReviewListView />
      </AdminStateProvider>,
    );
    await screen.findByRole("table");
    await user.selectOptions(screen.getByLabelText("AI 结果"), "question");
    expect(replace).toHaveBeenCalledWith("/admin/reviews?ai=question");
  });
});
