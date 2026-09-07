-- Keep the database owner/migration role separate from the application login.
-- The migration entrypoint provisions crewqual_app before Prisma reaches this
-- migration. This migration owns the durable grants and invariants.
DO $$
DECLARE
  app_role oid;
BEGIN
  SELECT oid INTO app_role
  FROM pg_catalog.pg_roles
  WHERE rolname = 'crewqual_app';

  IF app_role IS NULL THEN
    RAISE EXCEPTION 'crewqual_app is missing; run the owner role provisioning step first';
  END IF;

  IF current_user = 'crewqual_app' THEN
    RAISE EXCEPTION 'database migrations must run as the owner/migration role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relowner = app_role
      AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
  ) THEN
    RAISE EXCEPTION 'crewqual_app must not own public database objects';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proowner = app_role
  ) THEN
    RAISE EXCEPTION 'crewqual_app must not own public database functions';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members membership
    WHERE membership.member = app_role
  ) THEN
    RAISE EXCEPTION 'crewqual_app must not be a member of another database role';
  END IF;
END;
$$;

-- The runtime login receives ordinary CRUD on business tables. The two
-- migration metadata tables and the audit table are explicit exceptions.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM crewqual_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crewqual_app;
REVOKE ALL PRIVILEGES ON TABLE "_prisma_migrations", "AuditEvent" FROM crewqual_app;
GRANT SELECT ON TABLE "_prisma_migrations" TO crewqual_app;
GRANT SELECT, INSERT ON TABLE "AuditEvent" TO crewqual_app;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM crewqual_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crewqual_app;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM crewqual_app;
GRANT USAGE ON SCHEMA public TO crewqual_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, crewqual_app;

-- New Prisma tables inherit the runtime CRUD contract. AuditEvent and
-- _prisma_migrations are already present and are re-tightened above.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crewqual_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO crewqual_app;

DO $$
BEGIN
  -- PostgreSQL grants TEMPORARY to PUBLIC by default. Revoking it only from
  -- crewqual_app would therefore leave the privilege reachable through PUBLIC.
  EXECUTE format('REVOKE CREATE, TEMP ON DATABASE %I FROM PUBLIC, %I', current_database(), 'crewqual_app');
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), 'crewqual_app');
END;
$$;

-- AuditEvent is append-only even for a role that accidentally retains table
-- privileges. The owner/migration role can still perform deliberate DBA
-- maintenance by changing the trigger under the normal PostgreSQL owner
-- controls; the application role cannot disable or drop it.
CREATE OR REPLACE FUNCTION crewqual_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_event_append_only ON "AuditEvent";
CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION crewqual_reject_audit_mutation();

DROP TRIGGER IF EXISTS audit_event_truncate_block ON "AuditEvent";
CREATE TRIGGER audit_event_truncate_block
  BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION crewqual_reject_audit_mutation();

REVOKE ALL PRIVILEGES ON FUNCTION crewqual_reject_audit_mutation() FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "AuditEvent" FROM PUBLIC, crewqual_app;
GRANT SELECT, INSERT ON "AuditEvent" TO crewqual_app;
