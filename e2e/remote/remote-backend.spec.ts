import { expect, test, type Page } from "@playwright/test";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import sharp from "sharp";
import { UPGRADE_STAGE_CODES } from "../../src/types/services";

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, index) =>
      Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2),
    ),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "change-me";
const adminTotpSecret = process.env.E2E_ADMIN_TOTP_SECRET ?? "JBSWY3DPEHPK3PXP";
const appOrigin = new URL(
  process.env.RELEASE_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
).origin;
const devEndpointSecret =
  process.env.DEV_ENDPOINTS_SECRET ?? "remote-e2e-dev-endpoint-secret-0123456789";
const mintPilotTokenThroughDatabase = process.env.E2E_DIRECT_DB_PILOT_TOKEN === "1";

const e2eRequestAddress = `crewqual-e2e-${randomUUID()}`;
const e2ePilotEmployeeNumber = process.env.E2E_PILOT_EMPLOYEE_NUMBER ?? "CQ-1049";
const e2eCredentialNumber =
  process.env.E2E_CREDENTIAL_NUMBER ??
  (e2ePilotEmployeeNumber === "CQ-1049" ? "E2E-CN-1049" : `E2E-CN-${e2ePilotEmployeeNumber}`);
const databaseUrl = mintPilotTokenThroughDatabase
  ? process.env.E2E_DATABASE_URL
  : (process.env.DIRECT_URL ??
    process.env.DATABASE_URL ??
    "postgresql://crewqual:crewqual@127.0.0.1:55432/crewqual");
if (!databaseUrl) {
  throw new Error("E2E_DATABASE_URL is required when E2E_DIRECT_DB_PILOT_TOKEN=1");
}
const auditDb = new Pool({ connectionString: databaseUrl, max: 2 });

test.afterAll(async () => auditDb.end());

async function createPilotAccessTokenInDatabase() {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const client = await auditDb.connect();
  try {
    await client.query("BEGIN");
    const pilot = (
      await client.query<{ id: string }>(
        `SELECT id FROM "Pilot" WHERE "employeeNumber" = $1 AND active = true FOR UPDATE`,
        [e2ePilotEmployeeNumber],
      )
    ).rows[0];
    if (!pilot) throw new Error(`active E2E pilot not found: ${e2ePilotEmployeeNumber}`);
    await client.query(
      `DELETE FROM "PilotAccessToken" WHERE "pilotId" = $1 AND "consumedAt" IS NULL`,
      [pilot.id],
    );
    await client.query(
      `INSERT INTO "PilotAccessToken" (id, "pilotId", "tokenHash", "expiresAt")
       VALUES ($1, $2, $3, now() + interval '15 minutes')`,
      [randomUUID(), pilot.id, tokenHash],
    );
    await client.query("COMMIT");
    return token;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loginPilot(page: Page) {
  let token: string;
  if (mintPilotTokenThroughDatabase) {
    token = await createPilotAccessTokenInDatabase();
  } else {
    const tokenResponse = await page.request.get(
      `/api/dev/pilot-access?employeeNumber=${encodeURIComponent(e2ePilotEmployeeNumber)}`,
      {
        headers: {
          "x-forwarded-for": e2eRequestAddress,
          "x-crewqual-dev-secret": devEndpointSecret,
        },
      },
    );
    const tokenBody = await tokenResponse.json();
    expect(tokenResponse.ok(), JSON.stringify(tokenBody)).toBeTruthy();
    token = tokenBody.data.token as string;
  }
  await page.goto(`/pilot/access/${token}`);
  await expect(page).toHaveURL(/\/pilot\/qualifications$/);
  // Compile the dynamic submission page before post-submit navigation.
  await page.request.get("/pilot/submissions/e2e-warmup");
  // Compile the polling route before the upload starts the asynchronous job.
  await page.request.get("/api/recognitions/00000000-0000-0000-0000-000000000000");
}

async function loginAdmin(page: Page) {
  // Each test gets a fresh browser context. Reset the replay counter and only
  // this fixture's rate-limit buckets in the disposable candidate database so
  // repeated release-gate logins do not mask later workflow assertions.
  await auditDb.query(
    `UPDATE "AdminUser" SET "lastTotpCounter" = NULL, "failedAttempts" = 0, "lockedUntil" = NULL WHERE email = $1`,
    [adminEmail],
  );
  await auditDb.query(`DELETE FROM "RateLimitBucket" WHERE "key" IN ($1, $2)`, [
    `admin-login:address:${e2eRequestAddress}`,
    `admin-login:account:${adminEmail.toLowerCase()}`,
  ]);
  const response = await page.request.post("/api/admin/login", {
    headers: {
      origin: appOrigin,
      "x-forwarded-for": e2eRequestAddress,
    },
    data: {
      email: adminEmail,
      password: adminPassword,
      totpCode: totp(adminTotpSecret),
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.request.get("/api/admin/reviews?page=1&pageSize=1");
}

async function adminCsrf(page: Page) {
  const cookie = (await page.context().cookies()).find(
    (item) => item.name === "crewqual_admin_session_csrf",
  );
  expect(cookie, "admin CSRF cookie").toBeTruthy();
  return cookie!.value;
}

test.describe("remote PostgreSQL/S3/pg-boss workflow", () => {
  test.describe.configure({ timeout: 90_000 });

  test("pilot upload and submit reaches the admin review queue", async ({ page }) => {
    await loginPilot(page);
    await page.getByTestId("qualification-chinese-language-assessment").getByRole("link").click();
    await expect(page).toHaveURL(/chinese-language-assessment\/update$/);

    const source = await sharp({
      create: { width: 640, height: 400, channels: 4, background: "#eef6ff" },
    })
      .png()
      .toBuffer();
    await page.getByTestId("credential-file").setInputFiles({
      name: "credential.png",
      mimeType: "image/png",
      buffer: source,
    });
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "确认裁切并上传" }).click();
    await expect(page.getByText("已成功上传")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("AI识别系统繁忙")).toBeVisible({ timeout: 30_000 });

    await page.getByLabel("证件编号").fill(e2eCredentialNumber);
    await page.getByLabel("签发日期").fill("2026-08-14");
    await page.getByLabel("到期日期").fill("2028-08-14");
    await page.getByLabel("签发机构").fill("中国民航运行单位");
    await page.getByLabel("等级/参数").fill("四级标准");
    await page.getByRole("button", { name: "提交更新" }).click();
    await expect(page).toHaveURL(/\/pilot\/submissions\//);
    await expect(page.getByRole("heading", { name: "提交成功" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "已提交至服务器" })).toBeVisible();
  });

  test("admin can review and approve with a durable versioned action", async ({ page }) => {
    await loginAdmin(page);
    const reviewsResponse = await page.request.get(
      `/api/admin/reviews?status=pending&q=${encodeURIComponent(e2ePilotEmployeeNumber)}&page=1&pageSize=20`,
    );
    expect(reviewsResponse.ok(), await reviewsResponse.text()).toBeTruthy();
    const reviews = (await reviewsResponse.json()).data.items as Array<{
      id: string;
      submittedFields?: { credentialNumber?: string };
    }>;
    const review = reviews.find(
      (item) => item.submittedFields?.credentialNumber === e2eCredentialNumber,
    );
    expect(review, `pending review for ${e2eCredentialNumber}`).toBeTruthy();
    await page.goto(`/admin/reviews/${review!.id}`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/reviews\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "机组资质审核工作台" })).toBeVisible();
    await expect(page.locator('img[alt$="上传凭证"]').first()).toBeVisible();
    await page.getByRole("button", { name: "审核通过" }).click();
    await page.getByLabel("已核对凭证与提交信息").check();
    await page.getByRole("button", { name: "确认通过" }).click();
    await expect(page.getByText("此申请已处理")).toBeVisible({ timeout: 30_000 });
  });

  test("qualification config loads only required data and switches without navigation", async ({
    page,
  }) => {
    await loginAdmin(page);
    const requests: string[] = [];
    const captureRequest = (request: { url(): string }) => {
      const url = request.url();
      if (url.includes("/api/admin/")) requests.push(url);
    };
    page.on("request", captureRequest);
    await page.goto("/admin/qualification-config", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("qualification-config-editor")).toBeVisible({ timeout: 30_000 });

    const initialPaths = requests.map((url) => {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    });
    expect(
      initialPaths.some((path) => path === "/api/admin/qualification-configs?positionCode=PILOT"),
    ).toBe(true);
    expect(
      initialPaths.some(
        (path) =>
          path.startsWith("/api/admin/reviews?") &&
          path.includes("status=pending") &&
          path.includes("pageSize=1"),
      ),
    ).toBe(true);
    expect(initialPaths.some((path) => path.startsWith("/api/admin/pilots"))).toBe(false);
    expect(initialPaths.some((path) => path.startsWith("/api/admin/upgrade-plans"))).toBe(false);
    expect(initialPaths.some((path) => path.startsWith("/api/admin/notifications"))).toBe(false);

    requests.length = 0;
    await page.locator('[data-testid^="qualification-config-"]').nth(1).click();
    await expect(page).toHaveURL(/\?config=/);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    page.off("request", captureRequest);
    expect(requests.filter((url) => url.includes("_rsc=") || url.includes("/api/admin/"))).toEqual(
      [],
    );
  });

  test("authenticated pages remain usable at mobile and desktop widths", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginPilot(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.setViewportSize({ width: 1440, height: 1024 });
    const frame = await page.getByTestId("pilot-content-frame").boundingBox();
    expect(frame?.width).toBeLessThanOrEqual(430);
    expect(Math.abs((frame?.x ?? 0) + (frame?.width ?? 0) / 2 - 720)).toBeLessThanOrEqual(1);
  });

  test("four validity rules are enforced by the remote server", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "single durable mutation is enough");
    await loginAdmin(page);
    const csrf = await adminCsrf(page);
    const pilotsResponse = await page.request.get(
      `/api/admin/pilots?q=${encodeURIComponent(e2ePilotEmployeeNumber)}&page=1&pageSize=10`,
    );
    const pilot = (await pilotsResponse.json()).data.items[0] as { id: string };
    const base = {
      credentialNumber: `RULE-${Date.now()}`,
      issueDate: "2027-01-31",
      trainingDate: "",
      expiryDate: "",
      issuingAuthority: "CrewQual E2E",
      levelOrParameter: "合格",
    };
    const cases = [
      ["e2e-fixed-issue", base, "2027-02-28"],
      [
        "e2e-fixed-training",
        { ...base, credentialNumber: `${base.credentialNumber}-T`, trainingDate: "2027-01-31" },
        "2027-02-28",
      ],
      [
        "e2e-manual",
        { ...base, credentialNumber: `${base.credentialNumber}-M`, expiryDate: "2027-06-30" },
        "2027-06-30",
      ],
      ["e2e-nonexp", { ...base, credentialNumber: `${base.credentialNumber}-N` }, ""],
    ] as const;
    for (const [code, data, expectedExpiry] of cases) {
      const existing = (
        await auditDb.query<{ version: number }>(
          `SELECT record.version
             FROM "QualificationRecord" record
             JOIN "QualificationType" type ON type.id = record."qualificationTypeId"
            WHERE record."pilotId" = $1 AND type.code = $2 AND record.status = 'ACTIVE'
            LIMIT 1`,
          [pilot.id, code],
        )
      ).rows[0];
      const url = `/api/admin/pilots/${pilot.id}/qualifications/${code}`;
      const options = {
        headers: { origin: appOrigin, "x-csrf-token": csrf },
        data: existing ? { ...data, expectedVersion: existing.version } : data,
      };
      const response = existing
        ? await page.request.patch(url, options)
        : await page.request.post(url, options);
      const responseBody = await response.json();
      expect(
        response.ok(),
        `${code}: HTTP ${response.status()} ${JSON.stringify(responseBody)}`,
      ).toBeTruthy();
      expect(responseBody.data.expiryDate).toBe(expectedExpiry);
    }
  });

  test("inspection-item plan persists, edits, reaches calendar and completes", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "single durable mutation is enough");
    await loginAdmin(page);
    const csrf = await adminCsrf(page);
    const pilots = await page.request.get(
      `/api/admin/pilots?q=${encodeURIComponent(e2ePilotEmployeeNumber)}&page=1&pageSize=10`,
    );
    const pilot = (await pilots.json()).data.items[0] as { id: string };
    const definitions = await page.request.get("/api/admin/upgrade-plans/inspection-items");
    const item = (await definitions.json()).data[0] as { id: string; name: string };
    const ranges = [
      ["2027-01-01", "2027-01-10"],
      ["2027-01-11", "2027-01-20"],
      ["2027-01-21", "2027-01-31"],
      ["2027-02-01", "2027-02-10"],
      ["2027-02-11", "2027-02-20"],
      ["2027-02-21", "2027-02-28"],
    ];
    const names = ["理论口试", "中队评估", "大队评估", "模拟机检查", "航线检查", "实践考试"];
    const draft = {
      pilotId: pilot.id,
      title: `E2E 升级计划 ${Date.now()}`,
      type: "captain_upgrade",
      startDate: "2027-01-01",
      endDate: "2027-02-28",
      overallOwner: "E2E 责任人",
      leadDepartment: "E2E 中队",
      supplementalRequirements: ["E2E 补充要求"],
      inspectionItemSelections: [{ inspectionItemId: item.id, stageOrder: 0 }],
      stages: names.map((name, index) => ({
        id: `draft-${index}`,
        code: UPGRADE_STAGE_CODES[index],
        name,
        status: "not_started",
        plannedStart: ranges[index]![0],
        plannedEnd: ranges[index]![1],
        owner: `责任人 ${index + 1}`,
        notes: "E2E",
      })),
    };
    const create = await page.request.post("/api/admin/upgrade-plans", {
      headers: { origin: appOrigin, "x-csrf-token": csrf },
      data: { ...draft, action: "save" },
    });
    const createBody = await create.json();
    expect(
      create.ok(),
      `create plan HTTP ${create.status()} ${JSON.stringify(createBody)}`,
    ).toBeTruthy();
    let plan = createBody.data as {
      id: string;
      version: number;
      inspectionItems: Array<{ status: string; name: string }>;
      stages: Array<{ id: string }>;
    };
    expect(plan.inspectionItems[0]?.name).toBe(item.name);

    const patch = await page.request.patch(`/api/admin/upgrade-plans/${plan.id}`, {
      headers: { origin: appOrigin, "x-csrf-token": csrf },
      data: { ...draft, title: `${draft.title} 已编辑`, expectedVersion: plan.version },
    });
    expect(patch.ok(), `patch plan HTTP ${patch.status()}`).toBeTruthy();
    plan = (await patch.json()).data;
    const start = await page.request.post(`/api/admin/upgrade-plans/${plan.id}/start`, {
      headers: { origin: appOrigin, "x-csrf-token": csrf },
      data: { expectedVersion: plan.version },
    });
    expect(start.ok(), `start plan HTTP ${start.status()}`).toBeTruthy();
    plan = (await start.json()).data;

    const calendar = await page.request.get(
      "/api/admin/calendar?from=2027-01-01&to=2027-01-31&type=upgrade_stage",
    );
    const firstEvent = ((await calendar.json()).data as Array<{ inspectionItems?: string[] }>).find(
      (event) => event.inspectionItems?.includes(item.name),
    );
    expect(firstEvent).toBeTruthy();

    const complete = await page.request.post(
      `/api/admin/upgrade-plans/${plan.id}/stages/${plan.stages[0]!.id}/complete`,
      {
        headers: { origin: appOrigin, "x-csrf-token": csrf },
        data: {
          completedOn: "2027-01-10",
          resultSummary: "E2E 检查完成",
          expectedVersion: plan.version,
        },
      },
    );
    expect(complete.ok(), `complete plan HTTP ${complete.status()}`).toBeTruthy();
    const completedPlan = (await complete.json()).data as {
      version: number;
      inspectionItems: Array<{ status: string }>;
    };
    expect(completedPlan.inspectionItems[0]?.status).toBe("completed");

    const cancel = await page.request.post(`/api/admin/upgrade-plans/${plan.id}/cancel`, {
      headers: { origin: appOrigin, "x-csrf-token": csrf },
      data: {
        expectedVersion: completedPlan.version,
        reason: "E2E 轮次完成后释放活动计划约束",
      },
    });
    const cancelledPlan = await cancel.json();
    expect(
      cancel.ok(),
      `cancel plan HTTP ${cancel.status()} ${JSON.stringify(cancelledPlan)}`,
    ).toBeTruthy();
    expect(cancelledPlan.data.lifecycleStatus).toBe("cancelled");
  });

  test("adversarial conflicts, duplicate constraints and credential reset hold remotely", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "one durable adversarial mutation is enough");
    await loginAdmin(page);
    const csrf = await adminCsrf(page);
    const pilot = (
      await auditDb.query<{ id: string }>(`SELECT id FROM "Pilot" WHERE "employeeNumber" = $1`, [
        e2ePilotEmployeeNumber,
      ])
    ).rows[0]!;
    const suffix = randomUUID().slice(0, 8);
    const snapshot = {
      snapshotSource: "captured",
      version: 1,
      validityRule: { kind: "manual_expiry" },
      reminders: { firstDays: 90, secondDays: 30 },
      parameterRestriction: {
        enabled: false,
        description: "",
        version: 1,
        enforcement: { mode: "none", allowedValues: [], pattern: "" },
      },
      ocrChecks: {
        enabled: false,
        credentialNumber: false,
        holderMatch: false,
        expiryDate: false,
        issuingAuthoritySeal: false,
      },
    } as const;
    const createType = async (code: string) => {
      const id = randomUUID();
      await auditDb.query(
        `INSERT INTO "QualificationType" (id, code, name, core, active, "parameterRestriction", "validityRule", reminders, "ocrChecks", version, "updatedAt")
         VALUES ($1, $2, $3, false, true, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, 1, now())`,
        [
          id,
          code,
          `E2E 对抗资质 ${code}`,
          JSON.stringify(snapshot.parameterRestriction),
          JSON.stringify(snapshot.validityRule),
          JSON.stringify(snapshot.reminders),
          JSON.stringify(snapshot.ocrChecks),
        ],
      );
      return { id };
    };
    const createRequest = async (qualificationTypeId: string, expectedVersion: number) => {
      const id = randomUUID();
      await auditDb.query(
        `INSERT INTO "QualificationUpdateRequest" (id, "pilotId", "qualificationTypeId", "credentialNumber", "issueDate", "expiryDate", "issuingAuthority", "levelOrParameter", "submittedFields", "qualificationRuleSnapshot", "expectedVersion", "expectedQualificationRecordId", "baselineCapturedAt")
         VALUES ($1, $2, $3, $4, DATE '2026-01-01', DATE '2028-01-01', $5, $6, $7::jsonb, $8::jsonb, $9, (SELECT id FROM "QualificationRecord" WHERE "pilotId" = $2 AND "qualificationTypeId" = $3 AND status = 'ACTIVE'), now())`,
        [
          id,
          pilot.id,
          qualificationTypeId,
          `REQUEST-${suffix}`,
          "CrewQual E2E",
          "合格",
          JSON.stringify({
            credentialNumber: `REQUEST-${suffix}`,
            issueDate: "2026-01-01",
            trainingDate: "",
            expiryDate: "2028-01-01",
            issuingAuthority: "CrewQual E2E",
            levelOrParameter: "合格",
          }),
          JSON.stringify(snapshot),
          expectedVersion,
        ],
      );
      return { id, version: 1 };
    };
    const currentAdmin = (
      await auditDb.query<{ id: string; passwordHash: string }>(
        `SELECT id, "passwordHash" FROM "AdminUser" WHERE email = $1`,
        [adminEmail],
      )
    ).rows[0]!;
    const conflictType = await createType(`e2e-conflict-${suffix}`);
    const raceType = await createType(`e2e-race-${suffix}`);
    try {
      const original = { id: randomUUID(), version: 1 };
      await auditDb.query(
        `INSERT INTO "QualificationRecord" (id, "pilotId", "qualificationTypeId", "credentialNumber", "issueDate", "expiryDate", "issuingAuthority", "levelOrParameter", "qualificationRuleSnapshot", "lineageId", version, "updatedAt")
         VALUES ($1, $2, $3, $4, DATE '2026-01-01', DATE '2028-01-01', $5, $6, $7::jsonb, $1, 1, now())`,
        [
          original.id,
          pilot.id,
          conflictType.id,
          `ORIGINAL-${suffix}`,
          "CrewQual E2E",
          "合格",
          JSON.stringify(snapshot),
        ],
      );
      const staleRequest = await createRequest(conflictType.id, original.version);
      await auditDb.query(
        `UPDATE "QualificationRecord" SET "credentialNumber" = $1, version = version + 1, "updatedAt" = now() WHERE id = $2`,
        [`ADMIN-NEW-${suffix}`, original.id],
      );
      const staleApproval = await page.request.post(
        `/api/admin/reviews/${staleRequest.id}/approve`,
        {
          headers: { origin: appOrigin, "x-csrf-token": csrf },
          data: { expectedVersion: staleRequest.version, confirmed: true },
        },
      );
      expect(staleApproval.status()).toBe(409);
      expect((await staleApproval.json()).error.code).toBe(
        "QUALIFICATION_CHANGED_SINCE_SUBMISSION",
      );
      expect(
        (
          await auditDb.query<{ credentialNumber: string }>(
            `SELECT "credentialNumber" FROM "QualificationRecord" WHERE id = $1`,
            [original.id],
          )
        ).rows[0]!.credentialNumber,
      ).toBe(`ADMIN-NEW-${suffix}`);

      const raceRequest = await createRequest(raceType.id, 0);
      const approveRace = () =>
        page.request.post(`/api/admin/reviews/${raceRequest.id}/approve`, {
          headers: { origin: appOrigin, "x-csrf-token": csrf },
          data: { expectedVersion: raceRequest.version, confirmed: true },
        });
      const raceResponses = await Promise.all([approveRace(), approveRace()]);
      expect(raceResponses.map((response) => response.status()).sort()).toEqual([200, 409]);
      expect(
        Number(
          (
            await auditDb.query<{ count: string }>(
              `SELECT count(*) FROM "QualificationRecord" WHERE "pilotId" = $1 AND "qualificationTypeId" = $2 AND status = 'ACTIVE'`,
              [pilot.id, raceType.id],
            )
          ).rows[0]!.count,
        ),
      ).toBe(1);
      await expect(
        auditDb.query(
          `INSERT INTO "QualificationRecord" (id, "pilotId", "qualificationTypeId", "credentialNumber", "issueDate", "expiryDate", "issuingAuthority", "levelOrParameter", "qualificationRuleSnapshot", "lineageId", version, "updatedAt")
           VALUES ($1, $2, $3, $4, DATE '2026-01-01', DATE '2028-01-01', $5, $6, $7::jsonb, $1, 1, now())`,
          [
            randomUUID(),
            pilot.id,
            raceType.id,
            `DUPLICATE-${suffix}`,
            "CrewQual E2E",
            "合格",
            JSON.stringify(snapshot),
          ],
        ),
      ).rejects.toMatchObject({ code: "23505" });

      const reset = await page.request.post("/api/admin/settings", {
        headers: { origin: appOrigin, "x-csrf-token": csrf },
        data: {
          action: "admin.action",
          input: {
            id: currentAdmin.id,
            action: "resetPassword",
            value: "Temporary-E2E-Password-2026!",
          },
        },
      });
      expect(reset.ok(), `reset password HTTP ${reset.status()}`).toBeTruthy();
      expect((await page.request.get("/api/admin/session")).status()).toBe(401);
    } finally {
      await auditDb.query(
        `UPDATE "AdminUser" SET "passwordHash" = $1, "failedAttempts" = 0, "lockedUntil" = NULL, "updatedAt" = now() WHERE email = $2`,
        [currentAdmin.passwordHash, adminEmail],
      );
      const typeIds = [conflictType.id, raceType.id];
      await auditDb.query(
        `DELETE FROM "QualificationUpdateRequest" WHERE "qualificationTypeId" = ANY($1::uuid[])`,
        [typeIds],
      );
      await auditDb.query(
        `DELETE FROM "QualificationRecord" WHERE "qualificationTypeId" = ANY($1::uuid[])`,
        [typeIds],
      );
      await auditDb.query(`DELETE FROM "QualificationType" WHERE id = ANY($1::uuid[])`, [typeIds]);
    }
  });

  test("pilot inbox exposes only scoped in-app deliveries and supports read state", async ({
    page,
  }) => {
    await loginPilot(page);
    const otherPilot = (
      await auditDb.query<{ id: string }>(
        `SELECT id FROM "Pilot" WHERE "employeeNumber" <> $1 LIMIT 1`,
        [e2ePilotEmployeeNumber],
      )
    ).rows[0]!;
    const otherDelivery = {
      id: randomUUID(),
    };
    await auditDb.query(
      `INSERT INTO "NotificationDelivery" (id, "dedupeKey", type, channel, status, "pilotId", target, locale, "templateKey", "templateParams", "sentAt")
       VALUES ($1, $2, 'REVIEW_APPROVED', 'IN_APP', 'SENT', $3, $4, 'zh-CN', 'legacy.raw', $5::jsonb, now())`,
      [
        otherDelivery.id,
        `e2e-idor:${randomUUID()}`,
        otherPilot.id,
        otherPilot.id,
        JSON.stringify({ summary: "他人通知", message: "该通知不得被当前 Pilot 读取" }),
      ],
    );
    const csrf = (await page.context().cookies()).find(
      (item) => item.name === "crewqual_pilot_session_csrf",
    )!.value;
    expect((await page.request.get(`/api/pilot/notifications/${otherDelivery.id}`)).status()).toBe(
      404,
    );
    expect(
      (
        await page.request.patch(`/api/pilot/notifications/${otherDelivery.id}`, {
          headers: { origin: appOrigin, "x-csrf-token": csrf },
          data: { read: true },
        })
      ).status(),
    ).toBe(404);
    await auditDb.query(`DELETE FROM "NotificationDelivery" WHERE id = $1`, [otherDelivery.id]);
    const response = await page.request.get("/api/pilot/notifications?page=1&pageSize=20");
    expect(response.ok(), `inbox HTTP ${response.status()}`).toBeTruthy();
    const payload = (await response.json()).data as {
      items: Array<{ id: string; readAt: string | null }>;
      unreadCount: number;
    };
    if (payload.items[0]) {
      const read = await page.request.patch(`/api/pilot/notifications/${payload.items[0].id}`, {
        headers: { origin: appOrigin, "x-csrf-token": csrf },
        data: { read: true },
      });
      expect(read.ok(), `mark read HTTP ${read.status()}`).toBeTruthy();
      expect((await read.json()).data.readAt).toBeTruthy();
    }
  });
});
