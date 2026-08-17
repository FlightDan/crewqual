import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PilotQualificationsView } from "@/components/pilot/pilot-qualifications-view";
import { pilotProfileFixture } from "@/mocks/fixtures";
import { pilotProfileRepository } from "@/services/session-repository";

describe("PilotQualificationsView identity", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    pilotProfileRepository.remove("active");
  });

  it("shows the active Pilot profile written by identity verification", async () => {
    pilotProfileRepository.set("active", pilotProfileFixture);
    render(<PilotQualificationsView />);
    expect(await screen.findByText(pilotProfileFixture.displayName)).toBeVisible();
    expect(screen.getByText(new RegExp(pilotProfileFixture.employeeNumber))).toBeVisible();
  });

  it("uses an explicitly anonymous Mock fallback for direct development access", async () => {
    render(<PilotQualificationsView />);
    expect(await screen.findByText("匿名 Mock 预览")).toBeVisible();
    expect(screen.getByText(/不代表安全鉴权状态/)).toBeVisible();
  });
});
