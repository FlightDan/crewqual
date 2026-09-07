import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";

// Only a disposable, explicitly opted-in test stack may receive fixtures.
// DIRECT_URL is the fixture owner connection; HTTP still uses the app's runtime role.
const testOwned = process.env.CREWQUAL_SCOPE_E2E === "1" || process.env.E2E_CANDIDATE_STACK === "1";
const appOrigin = new URL(
  process.env.RELEASE_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
).origin;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const session = () => ({ token: randomBytes(32).toString("base64url"), csrf: randomUUID() });
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
};

function memberFixture() {
  const id = randomUUID();
  return {
    pilotId: id,
    personId: randomUUID(),
    unitId: randomUUID(),
    typeId: randomUUID(),
    typeCode: `scope-${id}`,
    recordId: randomUUID(),
    submissionId: randomUUID(),
    imageId: randomUUID(),
    orphanId: randomUUID(),
    recognitionId: randomUUID(),
    session: session(),
  };
}

async function expectNotFound(response: APIResponse) {
  expect(response.status()).toBe(404);
  const body = await response.json();
  expect(body.error?.code).toBe("NOT_FOUND");
  expect(body.data === undefined).toBe(true);
}

async function dataFrom(response: APIResponse) {
  // Never print response bodies: successful material responses contain signed URLs.
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

function expectSignedImageUrl(value: unknown, imageId: string) {
  let matches = false;
  try {
    const url = new URL(typeof value === "string" ? value : "");
    matches =
      decodeURIComponent(url.pathname).endsWith(`/${imageId}.jpg`) &&
      url.searchParams.has("X-Amz-Signature");
  } catch {
    // Keep malformed URLs out of assertion output as well.
  }
  expect(matches, "private URL is signed for the owned image").toBe(true);
}

async function authenticatedContext(
  request: typeof import("@playwright/test").request,
  realm: "member" | "admin",
  credentials: ReturnType<typeof session>,
) {
  const context = await request.newContext({
    baseURL: appOrigin,
    extraHTTPHeaders: { origin: appOrigin, "x-csrf-token": credentials.csrf },
    storageState: {
      origins: [],
      cookies: [
        {
          name: `crewqual_${realm}_session`,
          value: credentials.token,
          domain: new URL(appOrigin).hostname,
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: appOrigin.startsWith("https:"),
          sameSite: "Lax",
        },
      ],
    },
  });
  const safeRequest =
    (method: APIRequestContext["get"]): APIRequestContext["get"] =>
    async (...args) => {
      try {
        return await method(...args);
      } catch {
        // Playwright transport errors include authentication headers in their call log.
        throw new Error("Scope HTTP transport failed before receiving a response");
      }
    };
  context.get = safeRequest(context.get.bind(context));
  context.post = safeRequest(context.post.bind(context));
  return context;
}

// Tokens and signed URLs must not enter trace/video artifacts, including on retry.
test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe("qualification material scope over HTTP and PostgreSQL", () => {
  test("members and unit administrators cannot read or claim another member's material", async ({
    playwright,
  }) => {
    test.skip(!testOwned, "requires an explicitly opted-in disposable database");
    test.setTimeout(120_000);
    const fixtureOwnerUrl = process.env.DIRECT_URL;
    if (!fixtureOwnerUrl) throw new Error("Scope fixtures require DIRECT_URL");
    const db = new Pool({ connectionString: fixtureOwnerUrl, max: 1 });
    const organizationId = randomUUID();
    const adminId = randomUUID();
    const adminSession = session();
    const members = [memberFixture(), memberFixture()];
    const contexts: APIRequestContext[] = [];
    let seeded = false;
    try {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO "Organization" (id, code, name, "updatedAt") VALUES ($1::uuid, $1::text, 'Scope E2E', now())`,
          [organizationId],
        );
        for (const member of members) {
          await client.query(
            `INSERT INTO "OrganizationUnit" (id, code, name, "organizationId", "updatedAt")
             VALUES ($1::uuid, $1::text, 'Scope unit', $2, now())`,
            [member.unitId, organizationId],
          );
          await client.query(
            `INSERT INTO "Person" (id, "organizationId", "unitId", "employeeNumber", mobile, "displayName", initials, "updatedAt")
             VALUES ($1, $2, $3, $4, '13800000000', $4, 'SE', now())`,
            [member.personId, organizationId, member.unitId, member.pilotId],
          );
          await client.query(
            `INSERT INTO "Pilot" (id, "personId", "unitId", "employeeNumber", mobile, "displayName", initials, "roleCode", "aircraftType", "rankLabel", "updatedAt")
             VALUES ($1::uuid, $2, $3, $1::text, '13800000000', $1::text, 'SE', 'CAPTAIN', 'A320', 'E2E', now())`,
            [member.pilotId, member.personId, member.unitId],
          );
          await client.query(
            `INSERT INTO "QualificationType" (id, code, name, "validityRule", reminders, "parameterRestriction", "ocrChecks", "updatedAt")
             VALUES ($1, $2, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, now())`,
            [
              member.typeId,
              member.typeCode,
              JSON.stringify(snapshot.validityRule),
              JSON.stringify(snapshot.reminders),
              JSON.stringify(snapshot.parameterRestriction),
              JSON.stringify(snapshot.ocrChecks),
            ],
          );
          await client.query(
            `INSERT INTO "QualificationRecord" (id, "pilotId", "personId", "qualificationTypeId", "credentialNumber", "issueDate", "expiryDate", "issuingAuthority", "levelOrParameter", "qualificationRuleSnapshot", "lineageId", "updatedAt")
             VALUES ($1::uuid, $2, $3, $4, $1::text, DATE '2026-01-01', DATE '2030-01-01', 'Scope E2E', 'E2E', $5::jsonb, $1, now())`,
            [
              member.recordId,
              member.pilotId,
              member.personId,
              member.typeId,
              JSON.stringify(snapshot),
            ],
          );
          await client.query(
            `INSERT INTO "QualificationUpdateRequest" (id, "pilotId", "personId", "qualificationTypeId", "credentialNumber", "issueDate", "expiryDate", "issuingAuthority", "levelOrParameter", "qualificationRuleSnapshot", "submittedFields", "expectedVersion", "expectedQualificationRecordId", "baselineCapturedAt")
             VALUES ($1::uuid, $2, $3, $4, $1::text, DATE '2026-01-01', DATE '2030-01-01', 'Scope E2E', 'E2E', $5::jsonb, '{}'::jsonb, 1, $6, now())`,
            [
              member.submissionId,
              member.pilotId,
              member.personId,
              member.typeId,
              JSON.stringify(snapshot),
              member.recordId,
            ],
          );
          // Authorization/signing only: object bytes are covered by the upload workflow spec.
          for (const imageId of [member.imageId, member.orphanId]) {
            await client.query(
              `INSERT INTO "EvidenceImage" (id, "pilotId", "personId", "objectKey", "mimeType", width, height, "byteSize", sha256, status, "expiresAt", "updatedAt")
               VALUES ($1, $2, $3, $4, 'image/jpeg', 1, 1, 1, $5, $6, now() + interval '1 day', now())`,
              [
                imageId,
                member.pilotId,
                member.personId,
                `scope-e2e/${organizationId}/${imageId}.jpg`,
                hash(imageId),
                imageId === member.imageId ? "linked" : "orphaned",
              ],
            );
          }
          await client.query(
            `INSERT INTO "QualificationEvidence" (id, "evidenceImageId", "qualificationRecordId", "updateRequestId") VALUES ($1, $2, $3, $4)`,
            [randomUUID(), member.imageId, member.recordId, member.submissionId],
          );
          // Completed fixtures avoid enqueuing jobs or requiring a recognition worker.
          await client.query(
            `INSERT INTO "RecognitionTask" (id, "evidenceImageId", status, result) VALUES ($1, $2, 'COMPLETED', $3::jsonb)`,
            [member.recognitionId, member.imageId, JSON.stringify({ marker: member.imageId })],
          );
          await client.query(
            `INSERT INTO "PilotSession" (id, "pilotId", "tokenHash", "csrfTokenHash", "expiresAt") VALUES ($1, $2, $3, $4, now() + interval '15 minutes')`,
            [randomUUID(), member.pilotId, hash(member.session.token), hash(member.session.csrf)],
          );
        }
        // The persisted role is ADMIN plus unitId (there is no UNIT_ADMIN enum).
        await client.query(
          `INSERT INTO "AdminUser" (id, email, "displayName", "passwordHash", "totpSecretCiphertext", "unitId", "organizationId", "updatedAt")
           VALUES ($1, $2, 'Scope unit admin', 'unused-session-fixture', 'unused-session-fixture', $3, $4, now())`,
          [adminId, `${adminId}@example.invalid`, members[0]!.unitId, organizationId],
        );
        const role = await client.query<{ id: string }>(
          `SELECT id FROM "Role" WHERE code = 'ADMIN'`,
        );
        if (!role.rows[0]) throw new Error("Scope fixtures require seeded ADMIN permissions");
        await client.query(`INSERT INTO "AdminUserRole" ("userId", "roleId") VALUES ($1, $2)`, [
          adminId,
          role.rows[0].id,
        ]);
        await client.query(
          `INSERT INTO "AdminSession" (id, "userId", "tokenHash", "csrfTokenHash", "expiresAt") VALUES ($1, $2, $3, $4, now() + interval '15 minutes')`,
          [randomUUID(), adminId, hash(adminSession.token), hash(adminSession.csrf)],
        );
        await client.query("COMMIT");
        seeded = true;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      for (const [index, member] of members.entries()) {
        const other = members[1 - index]!;
        const http = await authenticatedContext(playwright.request, "member", member.session);
        contexts.push(http);
        for (const portal of ["member", "pilot"]) {
          const sections = await dataFrom(await http.get(`/api/${portal}/qualifications`));
          const ids = sections.flatMap((section: { qualifications: Array<{ id: string }> }) =>
            section.qualifications.map((item) => item.id),
          );
          expect(ids).toContain(member.typeCode);
          expect(ids).not.toContain(other.typeCode);
          const own = await dataFrom(
            await http.get(`/api/${portal}/qualifications/${member.typeCode}`),
          );
          expect(own.id).toBe(member.typeCode);
          await expectNotFound(await http.get(`/api/${portal}/qualifications/${other.typeCode}`));
          const submission = await dataFrom(
            await http.get(`/api/${portal}/submissions/${member.submissionId}`),
          );
          expect(submission.id).toBe(member.submissionId);
          await expectNotFound(await http.get(`/api/${portal}/submissions/${other.submissionId}`));
          await expectNotFound(
            await http.post(`/api/${portal}/submissions`, {
              data: {
                qualificationId: member.typeCode,
                evidenceId: other.orphanId,
                credentialNumber: "Scope E2E",
                issueDate: "2026-01-01",
                expiryDate: "2030-01-01",
                issuingAuthority: "Scope E2E",
                levelOrParameter: "E2E",
                expectedVersion: 1,
              },
            }),
          );
        }
        const ownUrl = await dataFrom(await http.get(`/api/evidence-images/${member.imageId}/url`));
        expectSignedImageUrl(ownUrl.url, member.imageId);
        await expectNotFound(await http.get(`/api/evidence-images/${other.imageId}/url`));
        const recognition = await dataFrom(
          await http.get(`/api/recognitions/${member.recognitionId}`),
        );
        expect(recognition.id).toBe(member.recognitionId);
        expect(recognition.result?.marker).toBe(member.imageId);
        await expectNotFound(await http.get(`/api/recognitions/${other.recognitionId}`));
        const ownRecognition = await http.post(
          `/api/evidence-images/${member.imageId}/recognitions`,
        );
        expect(ownRecognition.status()).toBe(202);
        expect((await ownRecognition.json()).data.id).toBe(member.recognitionId);
        await expectNotFound(
          await http.post(`/api/evidence-images/${other.orphanId}/recognitions`),
        );
      }

      const admin = await authenticatedContext(playwright.request, "admin", adminSession);
      contexts.push(admin);
      const [own, other] = members as [
        ReturnType<typeof memberFixture>,
        ReturnType<typeof memberFixture>,
      ];
      const ownPilot = await dataFrom(await admin.get(`/api/admin/pilots/${own.pilotId}`));
      expect(ownPilot.id).toBe(own.pilotId);
      await expectNotFound(await admin.get(`/api/admin/pilots/${other.pilotId}`));
      const ownReview = await dataFrom(await admin.get(`/api/admin/reviews/${own.submissionId}`));
      expect(ownReview.id).toBe(own.submissionId);
      expect(typeof ownReview.documentUrl === "string" && ownReview.documentUrl.length > 0).toBe(
        true,
      );
      await expectNotFound(await admin.get(`/api/admin/reviews/${other.submissionId}`));
      const reviews = await dataFrom(await admin.get("/api/admin/reviews?status=all&pageSize=100"));
      expect(reviews.items.map((item: { id: string }) => item.id)).toEqual([own.submissionId]);
      // Denied writes must not claim evidence, create tasks, or create submissions.
      for (const member of members) {
        const image = await db.query<{ status: string; tasks: string }>(
          `SELECT image.status, (SELECT count(*) FROM "RecognitionTask" WHERE "evidenceImageId" = image.id) AS tasks FROM "EvidenceImage" image WHERE image.id = $1`,
          [member.orphanId],
        );
        expect(image.rows[0]).toEqual({ status: "orphaned", tasks: "0" });
        const submissions = await db.query<{ id: string }>(
          `SELECT id FROM "QualificationUpdateRequest" WHERE "pilotId" = $1`,
          [member.pilotId],
        );
        expect(submissions.rows.map((row) => row.id)).toEqual([member.submissionId]);
      }
    } finally {
      await Promise.allSettled(contexts.map((context) => context.dispose()));
      try {
        if (seeded) {
          const pilotIds = members.map((member) => member.pilotId);
          const imageIds = members.flatMap((member) => [member.imageId, member.orphanId]);
          const cleanup = await db.connect();
          try {
            await cleanup.query("BEGIN");
            // Reads and rejected writes should create no audit events. Preserve
            // unexpected audit records and fixtures for diagnosis; never bypass integrity triggers.
            const audit = await cleanup.query<{ count: string }>(
              `SELECT count(*) FROM "AuditEvent" WHERE "actorId" = ANY($1::uuid[]) OR "pilotId" = ANY($2::uuid[])`,
              [[adminId, ...pilotIds], pilotIds],
            );
            expect(audit.rows[0]?.count, "scope operations must not emit mutation audit").toBe("0");
            await cleanup.query(
              `DELETE FROM "RecognitionTask" WHERE "evidenceImageId" = ANY($1::uuid[])`,
              [imageIds],
            );
            await cleanup.query(`DELETE FROM "PilotSession" WHERE "pilotId" = ANY($1::uuid[])`, [
              pilotIds,
            ]);
            await cleanup.query(`DELETE FROM "AdminSession" WHERE "userId" = $1`, [adminId]);
            await cleanup.query(`DELETE FROM "AdminUserRole" WHERE "userId" = $1`, [adminId]);
            await cleanup.query(
              `DELETE FROM "QualificationEvidence" WHERE "evidenceImageId" = ANY($1::uuid[])`,
              [imageIds],
            );
            await cleanup.query(`DELETE FROM "EvidenceImage" WHERE id = ANY($1::uuid[])`, [
              imageIds,
            ]);
            await cleanup.query(
              `DELETE FROM "QualificationUpdateRequest" WHERE "pilotId" = ANY($1::uuid[])`,
              [pilotIds],
            );
            await cleanup.query(
              `DELETE FROM "QualificationRecord" WHERE "pilotId" = ANY($1::uuid[])`,
              [pilotIds],
            );
            await cleanup.query(`DELETE FROM "QualificationType" WHERE id = ANY($1::uuid[])`, [
              members.map((member) => member.typeId),
            ]);
            await cleanup.query(`DELETE FROM "AdminUser" WHERE id = $1`, [adminId]);
            await cleanup.query(`DELETE FROM "Pilot" WHERE id = ANY($1::uuid[])`, [pilotIds]);
            await cleanup.query(`DELETE FROM "Person" WHERE id = ANY($1::uuid[])`, [
              members.map((member) => member.personId),
            ]);
            await cleanup.query(`DELETE FROM "OrganizationUnit" WHERE id = ANY($1::uuid[])`, [
              members.map((member) => member.unitId),
            ]);
            await cleanup.query(`DELETE FROM "Organization" WHERE id = $1`, [organizationId]);
            await cleanup.query("COMMIT");
          } catch (error) {
            await cleanup.query("ROLLBACK");
            throw error;
          } finally {
            cleanup.release();
          }
        }
      } finally {
        await db.end();
      }
    }
  });
});
