-- A pilot may keep draft/cancelled/completed history, but can have only one
-- plan that is not_started, active, or paused. This closes the race between
-- two concurrent start requests after the application-level check.
CREATE UNIQUE INDEX "UpgradePlan_one_active_per_pilot_key"
ON "UpgradePlan" ("pilotId")
WHERE "lifecycleStatus" IN ('NOT_STARTED', 'ACTIVE', 'PAUSED');
