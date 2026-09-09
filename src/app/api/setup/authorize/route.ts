import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import {
  authorizeSetup,
  assertSetupAuthorized,
  SETUP_AUTH_COOKIE,
  setupAuthorizationCookie,
} from "@/server/setup-request";
import { assertSetupOpen } from "@/server/setup";

const schema = z.object({ code: z.string().trim().max(32) });

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await assertSetupOpen();
    const input = await parseJson(request, schema);
    await authorizeSetup(request, input.code);
    const response = NextResponse.json(
      { data: { authorized: true }, requestId },
      { status: 200, headers: { "x-request-id": requestId, "cache-control": "no-store" } },
    );
    response.cookies.set(setupAuthorizationCookie());
    return response;
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await assertSetupAuthorized();
    const response = jsonData({ authorized: false }, requestId);
    response.cookies.set({ name: SETUP_AUTH_COOKIE, value: "", maxAge: 0, path: "/" });
    return response;
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
