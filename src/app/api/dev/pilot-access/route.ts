import { NextRequest, NextResponse } from "next/server";
import { assertRemoteMode } from "@/server/api";
import { getServerConfig } from "@/server/config";
import { createOpaqueToken, safeEqualHex, sha256 } from "@/server/crypto";
import { getPrisma } from "@/server/prisma";

/** Development/test-only bridge for exercising the fake SMS adapter. */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({}, { status: 404 });
  // Minting real access tokens requires an explicit opt-in so that a
  // non-production server pointed at real data cannot be a silent takeover
  // path for anyone with network reach.
  const config = getServerConfig();
  if (!config.DEV_ENDPOINTS) return NextResponse.json({}, { status: 404 });
  const providedSecret = request.headers.get("x-crewqual-dev-secret") ?? "";
  if (!safeEqualHex(sha256(providedSecret), sha256(config.DEV_ENDPOINTS_SECRET))) {
    return NextResponse.json({}, { status: 404 });
  }
  try {
    assertRemoteMode();
  } catch {
    return NextResponse.json({}, { status: 404 });
  }
  const employeeNumber = new URL(request.url).searchParams.get("employeeNumber");
  if (!employeeNumber) return NextResponse.json({ error: "EMPLOYEE_REQUIRED" }, { status: 400 });
  const pilot = await getPrisma().pilot.findUnique({ where: { employeeNumber } });
  if (!pilot?.active) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const token = createOpaqueToken();
  await getPrisma().$transaction(async (tx) => {
    await tx.pilotAccessToken.deleteMany({ where: { pilotId: pilot.id, consumedAt: null } });
    await tx.pilotAccessToken.create({
      data: {
        pilotId: pilot.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
  });
  return NextResponse.json({ data: { accessUrl: `/pilot/access/${token}`, token } });
}
