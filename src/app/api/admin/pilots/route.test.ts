import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
const mocks = vi.hoisted(() => ({ list: vi.fn().mockResolvedValue({ items: [], total: 0 }) }));
vi.mock("@/server/admin-guard", () => ({ getAdmin: () => ({ id: "admin" }) }));
vi.mock("@/server/admin-repository", () => ({ listAdminPilots: mocks.list }));
vi.mock("@/server/pilot-management", () => ({ createAdminPilot: vi.fn() }));
describe("pilot directory health filters", () => {
  it.each(["missing", "incomplete"])(
    "accepts %s and forwards it before pagination",
    async (health) => {
      const response = await GET(
        new NextRequest(`http://localhost/api/admin/pilots?health=${health}&page=2&pageSize=10`),
      );
      expect(response.status).toBe(200);
      expect(mocks.list).toHaveBeenLastCalledWith(
        { id: "admin" },
        expect.objectContaining({ health, page: 2, pageSize: 10 }),
      );
    },
  );
});
