ALTER TABLE "SecurityPolicy"
  ADD COLUMN "allowPublicAccess" BOOLEAN NOT NULL DEFAULT true;

-- Existing official deployments already expose a configured domain. Preserve
-- that behavior for existing rows while new policies default to LAN-only.
ALTER TABLE "SecurityPolicy"
  ALTER COLUMN "allowPublicAccess" SET DEFAULT false;
