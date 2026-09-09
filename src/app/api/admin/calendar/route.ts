import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { listAdminCalendarEvents } from "@/server/admin-calendar";
import type { CalendarQuery } from "@/types/services";

const querySchema = z.object({
  type: z.enum(["all", "qualification_expiry", "upgrade_stage"]).optional(),
  qualification: z.string().trim().max(128).optional(),
  units: z.string().trim().max(2000).optional(),
  positions: z.string().trim().max(512).optional(),
  q: z.string().trim().max(256).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "operations.read");
    const url = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const events = await listAdminCalendarEvents(admin, {
      type: query.type as CalendarQuery["type"],
      qualification: query.qualification as CalendarQuery["qualification"],
      units: query.units,
      positions: query.positions,
      q: query.q,
      from: query.from,
      to: query.to,
    });
    return jsonData(events, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
