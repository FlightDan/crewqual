-- This migration deliberately refuses to drop credentials that were not
-- encrypted by scripts/migrate-totp-secrets.ts first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "AdminUser"
    WHERE "totpSecret" <> ''
       OR "totpSecretCiphertext" IS NULL
       OR "totpSecretCiphertext" = ''
  ) THEN
    RAISE EXCEPTION 'plaintext TOTP removal blocked: run scripts/migrate-totp-secrets.ts and verify ciphertext first';
  END IF;
END $$;

ALTER TABLE "AdminUser" ALTER COLUMN "totpSecretCiphertext" SET NOT NULL;
ALTER TABLE "AdminUser" DROP COLUMN "totpSecret";
ALTER TABLE "PilotSession" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
