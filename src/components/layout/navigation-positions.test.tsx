import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAdminPositions } from "@/components/layout/navigation";
import {
  adminSettingsService,
  adminSettingsStorageKey,
  defaultAdminSettingsSnapshot,
} from "@/services/admin-settings-service";
import { mockStorageKey } from "@/services/temp-storage";

function PositionProbe() {
  const positions = useAdminPositions("/admin/settings");
  return (
    <div>
      {positions.map((position) => (
        <span key={position.id}>{position.name}</span>
      ))}
    </div>
  );
}

describe("position navigation source", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.sessionStorage.setItem(
      mockStorageKey(adminSettingsStorageKey),
      JSON.stringify(defaultAdminSettingsSnapshot),
    );
  });

  it("tracks delete and active-state changes from position settings", async () => {
    render(<PositionProbe />);
    expect(await screen.findByText("飞行员")).toBeVisible();
    expect(screen.getByText("乘务员")).toBeVisible();
    expect(screen.queryByText("机务人员")).toBeNull();

    const cabinCrew = defaultAdminSettingsSnapshot.positions.find(
      (position) => position.code === "CABIN_CREW",
    )!;
    await act(async () => {
      await adminSettingsService.deletePosition({
        id: cabinCrew.id,
        version: cabinCrew.version,
      });
    });
    await waitFor(() => expect(screen.queryByText("乘务员")).toBeNull());

    const maintenance = defaultAdminSettingsSnapshot.positions.find(
      (position) => position.code === "MAINTENANCE",
    )!;
    await act(async () => {
      await adminSettingsService.savePosition({ ...maintenance, active: true });
    });
    expect(await screen.findByText("机务人员")).toBeVisible();
  });
});
