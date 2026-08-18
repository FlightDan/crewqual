CREATE TYPE "AdminLoginMode" AS ENUM ('PASSWORD_TOTP', 'TOTP_ONLY', 'PASSWORD_ONLY');

ALTER TABLE "AdminUser"
  ADD COLUMN "totpVerifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN "lastTotpCounter" BIGINT;

ALTER TABLE "SecurityPolicy"
  ADD COLUMN "adminLoginMode" "AdminLoginMode" NOT NULL DEFAULT 'PASSWORD_TOTP';

UPDATE "SecurityPolicy"
SET "adminLoginMode" = CASE
  WHEN "requireTotp" THEN 'PASSWORD_TOTP'::"AdminLoginMode"
  ELSE 'PASSWORD_ONLY'::"AdminLoginMode"
END;

ALTER TABLE "SecurityPolicy" DROP COLUMN "requireTotp";
