-- Preflight: every existing plan must have its fixed first stage so the
-- backwards-compatible item snapshot can be assigned deterministically.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "UpgradePlan" p
    WHERE NOT EXISTS (
      SELECT 1 FROM "UpgradeStage" s WHERE s."planId" = p.id AND s."order" = 0
    )
  ) THEN
    RAISE EXCEPTION 'upgrade inspection migration blocked: plan without stage 0';
  END IF;
END $$;

CREATE TYPE "UpgradeInspectionItemStatus" AS ENUM ('PENDING', 'COMPLETED');

CREATE TABLE "InspectionItem" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "ruleVersion" INTEGER NOT NULL DEFAULT 1,
  "rule" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InspectionItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InspectionItem_code_key" ON "InspectionItem"("code");

CREATE TABLE "UpgradePlanInspectionItem" (
  "id" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "inspectionItemId" UUID NOT NULL,
  "stageId" UUID NOT NULL,
  "nameSnapshot" TEXT NOT NULL,
  "ruleVersionSnapshot" INTEGER NOT NULL,
  "ruleSnapshot" JSONB NOT NULL,
  "status" "UpgradeInspectionItemStatus" NOT NULL DEFAULT 'PENDING',
  "completedOn" DATE,
  "resultSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UpgradePlanInspectionItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UpgradePlanInspectionItem_planId_inspectionItemId_key"
  ON "UpgradePlanInspectionItem"("planId", "inspectionItemId");
CREATE INDEX "UpgradePlanInspectionItem_stageId_status_idx"
  ON "UpgradePlanInspectionItem"("stageId", "status");

ALTER TABLE "UpgradePlanInspectionItem"
  ADD CONSTRAINT "UpgradePlanInspectionItem_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "UpgradePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UpgradePlanInspectionItem"
  ADD CONSTRAINT "UpgradePlanInspectionItem_inspectionItemId_fkey"
  FOREIGN KEY ("inspectionItemId") REFERENCES "InspectionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UpgradePlanInspectionItem"
  ADD CONSTRAINT "UpgradePlanInspectionItem_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "UpgradeStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "InspectionItem" ("id", "code", "name", "description", "ruleVersion", "rule") VALUES
  ('11111111-1111-4111-8111-111111111111', 'oral-theory', '理论口试检查', '核验理论知识与口试结论', 1, '{"kind":"completion_record","required":true}'),
  ('22222222-2222-4222-8222-222222222222', 'simulator-skill', '模拟机技能检查', '记录模拟机场景与检查结论', 1, '{"kind":"completion_record","required":true}'),
  ('33333333-3333-4333-8333-333333333333', 'line-operation', '航线运行检查', '记录航线运行检查结论', 1, '{"kind":"completion_record","required":true}');

-- Historical plans did not expose a selection. Preserve that fact through a
-- deterministic minimum snapshot instead of pretending all three were chosen.
INSERT INTO "UpgradePlanInspectionItem" (
  "id", "planId", "inspectionItemId", "stageId", "nameSnapshot",
  "ruleVersionSnapshot", "ruleSnapshot", "status", "completedOn", "resultSummary"
)
SELECT
  gen_random_uuid(), p.id, i.id, s.id, i.name, i."ruleVersion", i.rule,
  CASE WHEN s.status = 'COMPLETED' THEN 'COMPLETED'::"UpgradeInspectionItemStatus"
       ELSE 'PENDING'::"UpgradeInspectionItemStatus" END,
  s."completedOn", s."resultSummary"
FROM "UpgradePlan" p
JOIN "UpgradeStage" s ON s."planId" = p.id AND s."order" = 0
JOIN "InspectionItem" i ON i.code = 'oral-theory';
