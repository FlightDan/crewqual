import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getAdminCalendarDayQualificationRoster } from "@/server/admin-calendar";
import type { CalendarDayQualificationQuery } from "@/types/services";

const querySchema = z.object({
  date: z.string().date(),
  type: z.enum(["all", "qualification_expiry", "upgrade_stage"]).optional(),
  qualification: z.string().optional(),
  units: z.string().optional(),
  positions: z.string().optional(),
  q: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "operations.read");
    const url = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const roster = await getAdminCalendarDayQualificationRoster(
      admin,
      query as CalendarDayQualificationQuery,
    );
    return jsonData(roster, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
