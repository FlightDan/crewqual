import { Prisma } from "@/generated/prisma/client";
import type { Clock } from "@/types/services";
import type { AuthenticatedAdmin } from "@/server/auth";
import { getPrisma } from "@/server/prisma";
import { requireAssignedUnit } from "@/server/admin-permissions";
import { fixedClock, systemClock } from "@/lib/qualification-date-status";
import { dateOnlyForTimezone, isValidTimezone } from "@/lib/date-only";
import { normalizePilotRoleCode, pilotRoleLabel } from "@/lib/domain-i18n";
import { pilotQualificationInclude, pilotQualificationStates } from "@/server/pilot-qualifications";

export type AdminPilotDirectoryQuery = {
  q?: string;
  health?: string;
  upgrade?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

type UnitDay = { id: string; today: string | null };

/** SQL counterpart of resolveMemberQualifications and evaluateStoredQualification.
 * Only compact unit/date metadata enters JS before filtering. Dates are computed
 * with the same Intl timezone implementation as the domain, including invalid zones.
 * JSON casts are guarded CASE branches: malformed evidence must never abort a page.
 */
export function adminPilotDirectorySql(input: {
  unitId: string | null;
  query: AdminPilotDirectoryQuery;
  unitDays: UnitDay[];
  page: number;
  pageSize: number;
}) {
  const { unitId, query, page, pageSize } = input;
  const days = input.unitDays.length
    ? Prisma.join(input.unitDays.map((unit) => Prisma.sql`(${unit.id}::uuid, ${unit.today}::date)`))
    : Prisma.sql`(NULL::uuid, NULL::date)`;
  const filters = [Prisma.sql`TRUE`];
  if (unitId) filters.push(Prisma.sql`p."unitId" = ${unitId}::uuid`);
  if (query.q)
    filters.push(
      Prisma.sql`(p."displayName" ILIKE ${`%${query.q}%`} OR p."employeeNumber" ILIKE ${`%${query.q}%`})`,
    );
  if (query.status && query.status !== "all")
    filters.push(Prisma.sql`p.active = ${query.status === "active"}`);
  if (query.upgrade && query.upgrade !== "all") {
    const exists = Prisma.sql`EXISTS (SELECT 1 FROM "UpgradePlan" up WHERE up."pilotId" = p.id AND up."lifecycleStatus" IN ('ACTIVE', 'PAUSED', 'NOT_STARTED'))`;
    filters.push(query.upgrade === "none" ? Prisma.sql`NOT ${exists}` : exists);
  }
  const healthFilter =
    query.health && query.health !== "all"
      ? Prisma.sql`health = ${query.health}`
      : Prisma.sql`TRUE`;
  return Prisma.sql`
    WITH unit_days(id, today) AS (VALUES ${days}),
    scoped AS (
      SELECT p.id, p."displayName", p."personId",
        CASE WHEN u.id = person."unitId"
          AND (u."organizationId" IS NULL OR u."organizationId" = person."organizationId")
          AND p."unitId" = person."unitId" THEN ud.today ELSE NULL END AS today
      FROM "Pilot" p
      LEFT JOIN "Person" person ON person.id = p."personId"
      LEFT JOIN "OrganizationUnit" u ON u.id = person."unitId"
      LEFT JOIN unit_days ud ON ud.id = u.id
      WHERE ${Prisma.join(filters, " AND ")}
    ), assigned AS (
      SELECT s.id AS pilot_id, s."personId" AS person_id, s.today,
        d.id AS definition_id, d.code, d."legacyQualificationTypeId" AS legacy_type_id,
        bool_or(COALESCE(req.required, TRUE)) AS required
      FROM scoped s
      JOIN "QualificationAssignment" a ON a."personId" = s."personId" AND a.active
      JOIN "QualificationDefinition" d ON d.id = a."qualificationDefinitionId" AND d.active
      LEFT JOIN "QualificationRequirement" req ON req.id = a."requirementId"
      LEFT JOIN "Position" rp ON rp.id = req."positionId"
      LEFT JOIN "PersonPositionAssignment" pa ON pa.id = a."positionAssignmentId"
      LEFT JOIN "Position" ap ON ap.id = pa."positionId"
      WHERE (req.id IS NULL OR (req.active AND rp.active))
        AND (pa.id IS NULL OR (pa.status = 'ACTIVE' AND ap.active IS DISTINCT FROM FALSE
          AND (s.today IS NULL OR ((pa."effectiveFrom" IS NULL OR pa."effectiveFrom" <= s.today)
            AND (pa."effectiveTo" IS NULL OR pa."effectiveTo" >= s.today)))))
      GROUP BY s.id, s."personId", s.today, d.id, d.code, d."legacyQualificationTypeId"
    ), candidates AS (
      SELECT a.*, r.id AS record_id, r."expiryDate" AS expiry, r."qualificationRuleSnapshot" AS snapshot,
        count(r.id) OVER (PARTITION BY a.pilot_id, a.definition_id) AS record_count
      FROM assigned a
      LEFT JOIN "QualificationRecord" r ON r.status = 'ACTIVE' AND (
        (r."personId" = a.person_id AND r."qualificationDefinitionId" = a.definition_id)
        OR (NOT EXISTS (SELECT 1 FROM "QualificationRecord" cr WHERE cr.status = 'ACTIVE'
              AND cr."personId" = a.person_id AND cr."qualificationDefinitionId" = a.definition_id)
          AND r."pilotId" = a.pilot_id
          AND (r."personId" IS NULL OR r."personId" = a.person_id)
          AND (r."qualificationDefinitionId" IS NULL OR r."qualificationDefinitionId" = a.definition_id)
          AND (r."qualificationTypeId" = a.legacy_type_id OR EXISTS (
            SELECT 1 FROM "QualificationType" qt WHERE qt.id = r."qualificationTypeId" AND qt.code = a.code)))
      )
    ), evidence AS (
      SELECT *, CASE WHEN jsonb_typeof(snapshot) = 'object'
        AND jsonb_typeof(snapshot->'version') = 'number'
        THEN CASE WHEN (snapshot->>'version')::numeric BETWEEN 0.5 AND 9007199254740992
          THEN (snapshot->>'version')::double precision BETWEEN 1 AND 9007199254740991
            AND trunc((snapshot->>'version')::double precision) = (snapshot->>'version')::double precision
          ELSE FALSE END
        ELSE FALSE END
        AND (NOT (snapshot ? 'snapshotSource') OR snapshot->>'snapshotSource' IN ('captured', 'reviewer_confirmed'))
        AND jsonb_typeof(snapshot->'validityRule') = 'object'
        AND (snapshot->'validityRule'->>'kind' IN ('manual_expiry', 'non_expiring')
          OR (snapshot->'validityRule'->>'kind' = 'fixed_months'
            AND snapshot->'validityRule'->>'baseDateField' IN ('issueDate', 'trainingDate')
            AND CASE WHEN jsonb_typeof(snapshot->'validityRule'->'months') = 'number'
              THEN CASE WHEN (snapshot->'validityRule'->>'months')::numeric BETWEEN 0.5 AND 121
                THEN (snapshot->'validityRule'->>'months')::double precision BETWEEN 1 AND 120
                  AND trunc((snapshot->'validityRule'->>'months')::double precision) = (snapshot->'validityRule'->>'months')::double precision
                ELSE FALSE END
              ELSE FALSE END)) AS valid_evidence
      FROM candidates
    ), states AS (
      SELECT DISTINCT pilot_id, definition_id, required,
        CASE WHEN record_count = 0 THEN 'missing'
          WHEN record_count > 1 OR today IS NULL OR valid_evidence IS DISTINCT FROM TRUE THEN 'incomplete'
          WHEN snapshot->'validityRule'->>'kind' = 'non_expiring'
            THEN CASE WHEN expiry IS NULL THEN 'normal' ELSE 'incomplete' END
          WHEN expiry IS NULL OR expiry < DATE '0001-01-01' OR expiry > DATE '9999-12-31' THEN 'incomplete'
          WHEN expiry < today THEN 'expired'
          WHEN expiry - today <= 90 THEN 'expiring'
          ELSE 'normal' END AS state
      FROM evidence
    ), health_rows AS (
      SELECT s.id, s."displayName", CASE
        WHEN count(st.definition_id) = 0 THEN 'unconfigured'
        WHEN bool_or(st.required AND st.state = 'missing') THEN 'missing'
        WHEN bool_or(st.required AND st.state = 'incomplete') THEN 'incomplete'
        WHEN bool_or(st.required AND st.state = 'expired') THEN 'expired'
        WHEN bool_or(st.required AND st.state = 'expiring') THEN 'expiring'
        ELSE 'normal' END AS health
      FROM scoped s LEFT JOIN states st ON st.pilot_id = s.id
      GROUP BY s.id, s."displayName"
    ), filtered AS (SELECT * FROM health_rows WHERE ${healthFilter}),
    page_rows AS (SELECT * FROM filtered ORDER BY "displayName", id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize})
    SELECT (SELECT count(*)::integer FROM filtered) AS total,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'health', health) ORDER BY "displayName", id) FROM page_rows), '[]'::jsonb) AS rows
  `;
}

export async function listAdminPilotDirectory(
  admin: AuthenticatedAdmin,
  query: AdminPilotDirectoryQuery,
  clock: Clock = systemClock,
) {
  const unitId = requireAssignedUnit(admin);
  const capturedClock = fixedClock(clock);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 20)));
  const db = getPrisma();
  return db.$transaction(
    async (tx) => {
      const units = await tx.organizationUnit.findMany({
        where: unitId ? { id: unitId } : {},
        select: { id: true, timezone: true },
      });
      const unitDays = units.map((unit) => ({
        id: unit.id,
        today: isValidTimezone(unit.timezone)
          ? dateOnlyForTimezone(capturedClock.now(), unit.timezone)
          : null,
      }));
      const [projection] = await tx.$queryRaw<
        Array<{ total: number; rows: Array<{ id: string; health: string }> }>
      >(adminPilotDirectorySql({ unitId, query, unitDays, page, pageSize }));
      const { total, rows } = projection!;
      const pilots = rows.length
        ? await tx.pilot.findMany({
            where: { id: { in: rows.map((row) => row.id) }, ...(unitId ? { unitId } : {}) },
            include: {
              ...pilotQualificationInclude,
              unit: true,
              upgradePlans: {
                where: { lifecycleStatus: { in: ["ACTIVE", "PAUSED", "NOT_STARTED"] } },
                orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
                take: 1,
              },
            },
          })
        : [];
      const byId = new Map(pilots.map((pilot) => [pilot.id, pilot]));
      const items = rows.map((row) => {
        const pilot = byId.get(row.id)!;
        const summary = pilotQualificationStates(pilot, capturedClock);
        // Detect domain/SQL drift rather than returning a silently misfiltered page.
        if (summary.health !== row.health)
          throw new Error("Pilot directory health projection disagrees with domain state");
        return {
          id: pilot.id,
          employeeNumber: pilot.employeeNumber,
          displayName: pilot.displayName,
          initials: pilot.initials,
          mobile: pilot.mobile,
          roleCode: normalizePilotRoleCode(pilot.roleCode),
          role: pilotRoleLabel(pilot.roleCode),
          aircraftType: pilot.aircraftType,
          unit: pilot.unit.name,
          unitCode: pilot.unit.code,
          rankCode: pilot.rankLabel,
          active: pilot.active,
          version: pilot.version,
          health: summary.health,
          expiredCount: summary.items.filter((item) => item.state.status === "expired").length,
          expiringCount: summary.items.filter(
            (item) => item.state.status === "due_30" || item.state.status === "due_90",
          ).length,
          missingCount: summary.requiredQualificationCounts.missing,
          incompleteCount: summary.requiredQualificationCounts.incomplete,
          activeUpgradeTitle: pilot.upgradePlans[0]?.title ?? null,
        };
      });
      return {
        timezones: [...new Set(units.map((unit) => unit.timezone).filter(isValidTimezone))],
        evaluatedAt: capturedClock.now().toISOString(),
        items,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
