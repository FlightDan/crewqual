import { NextRequest } from "next/server";
import { assertRemoteMode, getRequestId, jsonData, jsonError } from "@/server/api";
import { hasSettingsReadAccess } from "@/server/admin-guard";
import { getSetupOverview, isSetupRequired } from "@/server/setup";
import { isSetupAuthorized } from "@/server/setup-request";
import type { SetupOverview } from "@/types/setup";

function overviewWithoutDisclosure(required: boolean) {
  // Setup is already finished: an unauthenticated caller only learns that
  // fact. Version, organization name, templates and dependency health are
  // reserved for authorized viewers.
  return {
    required,
    mode: "remote",
    environment: {
      database: "unknown",
      storage: "unknown",
      worker: "unknown",
      workerDetail: "",
      version: "",
    },
    templates: [],
    defaults: {
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      organizationName: "",
      backupPath: "",
    },
  } satisfies SetupOverview;
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertRemoteMode();
    const required = await isSetupRequired();
    const authorized =
      (await isSetupAuthorized().catch(() => false)) ||
      (!required && (await hasSettingsReadAccess(request).catch(() => false)));
    if (!authorized) {
      return jsonData(overviewWithoutDisclosure(required), requestId);
    }
    const overview = await getSetupOverview();
    // Re-check after the full probe so a concurrent setup completion cannot
    // expose its resulting organization metadata to the original caller.
    if (!overview.required && required) {
      const stillAuthorized =
        (await isSetupAuthorized().catch(() => false)) ||
        (await hasSettingsReadAccess(request).catch(() => false));
      if (!stillAuthorized) return jsonData(overviewWithoutDisclosure(false), requestId);
    }
    return jsonData(overview, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
