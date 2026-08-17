-- actorId identifies either an admin or a pilot; actorType is the discriminator.
-- It must not be constrained to AdminUser because pilot submissions also audit here.
ALTER TABLE "AuditEvent" DROP CONSTRAINT IF EXISTS "AuditEvent_actorId_fkey";
