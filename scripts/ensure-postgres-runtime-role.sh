#!/bin/sh
set -eu

: "${DIRECT_URL:?DIRECT_URL is required for database role provisioning}"

mode="${1:-provision}"
if [ "$mode" != "provision" ] && [ "$mode" != "grant" ] && [ "$mode" != "verify" ]; then
  echo "usage: ensure-postgres-runtime-role.sh [provision|grant|verify]" >&2
  exit 2
fi

# The role name is part of the checked-in permission contract, not a secret.
# Keeping it fixed prevents a deployment typo from silently granting the
# application URL the owner role's privileges.
app_user="${POSTGRES_APP_USER:-crewqual_app}"
if [ "$app_user" != "crewqual_app" ]; then
  echo "POSTGRES_APP_USER must be crewqual_app" >&2
  exit 1
fi

if [ "$mode" = "verify" ]; then
  : "${DATABASE_URL:?DATABASE_URL is required for runtime role verification}"
  runtime_ok="$(node --import tsx scripts/psql-from-url.ts DATABASE_URL --no-psqlrc -v ON_ERROR_STOP=1 -Atq <<'SQL'
SELECT current_user = 'crewqual_app'
  AND has_table_privilege(current_user, '"AuditEvent"', 'SELECT')
  AND has_table_privilege(current_user, '"AuditEvent"', 'INSERT')
  AND NOT has_table_privilege(current_user, '"AuditEvent"', 'UPDATE')
  AND NOT has_table_privilege(current_user, '"AuditEvent"', 'DELETE')
  AND NOT has_table_privilege(current_user, '"AuditEvent"', 'TRUNCATE')
  AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
  AND has_schema_privilege(current_user, 'pgboss', 'USAGE')
  AND NOT has_schema_privilege(current_user, 'pgboss', 'CREATE')
  AND NOT has_database_privilege(current_user, current_database(), 'CREATE')
  AND NOT has_database_privilege(current_user, current_database(), 'TEMP')
  AND COALESCE((
        SELECT bool_and(
          has_table_privilege(current_user, relation.oid, 'SELECT')
          AND has_table_privilege(current_user, relation.oid, 'INSERT')
          AND has_table_privilege(current_user, relation.oid, 'UPDATE')
          AND has_table_privilege(current_user, relation.oid, 'DELETE')
          AND NOT has_table_privilege(current_user, relation.oid, 'TRUNCATE')
          AND NOT has_table_privilege(current_user, relation.oid, 'REFERENCES')
          AND NOT has_table_privilege(current_user, relation.oid, 'TRIGGER')
        )
        FROM pg_catalog.pg_class relation
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'pgboss'
          AND relation.relkind IN ('r', 'p')
      ), false)
  AND has_function_privilege(
        current_user,
        'pgboss.create_queue(text,jsonb)'::regprocedure,
        'EXECUTE'
      )
  AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc procedure
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'pgboss'
          AND procedure.oid <> 'pgboss.create_queue(text,jsonb)'::regprocedure
          AND has_function_privilege(current_user, procedure.oid, 'EXECUTE')
      );
SQL
)"
  owner_ok="$(node --import tsx scripts/psql-from-url.ts DIRECT_URL --no-psqlrc -v ON_ERROR_STOP=1 -Atq <<'SQL'
SELECT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_roles runtime_role
         WHERE runtime_role.rolname = 'crewqual_app'
           AND runtime_role.rolcanlogin
           AND NOT runtime_role.rolsuper
           AND NOT runtime_role.rolinherit
           AND NOT runtime_role.rolcreaterole
           AND NOT runtime_role.rolcreatedb
           AND NOT runtime_role.rolreplication
           AND NOT runtime_role.rolbypassrls
       )
  AND NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_auth_members membership
         JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
         WHERE member_role.rolname = 'crewqual_app'
       )
  AND NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_class relation
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
         JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = relation.relowner
         WHERE namespace.nspname IN ('public', 'pgboss')
           AND owner_role.rolname = 'crewqual_app'
           AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
       )
  AND NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc procedure
         JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
         JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = procedure.proowner
         WHERE namespace.nspname IN ('public', 'pgboss')
           AND owner_role.rolname = 'crewqual_app'
       )
  AND NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_namespace namespace
         JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = namespace.nspowner
         WHERE namespace.nspname IN ('public', 'pgboss')
           AND owner_role.rolname = 'crewqual_app'
       )
  AND EXISTS (
         SELECT 1 FROM pg_catalog.pg_trigger
         WHERE tgrelid = '"AuditEvent"'::regclass
           AND tgname = 'audit_event_append_only'
           AND tgenabled <> 'D'
       )
  AND EXISTS (
         SELECT 1 FROM pg_catalog.pg_trigger
         WHERE tgrelid = '"AuditEvent"'::regclass
           AND tgname = 'audit_event_truncate_block'
           AND tgenabled <> 'D'
       );
SQL
)"
  if [ "$runtime_ok" != "t" ]; then
    echo "database runtime-role privilege verification failed" >&2
    exit 1
  fi
  if [ "$owner_ok" != "t" ]; then
    echo "AuditEvent ownership or trigger integrity verification failed" >&2
    exit 1
  fi
  exit 0
fi

if [ "$mode" = "grant" ]; then
  # pg-boss schema migrations and queue creation have already run as the owner.
  # The application login receives data-plane access only; all queue DDL stays
  # in this privileged, one-shot migration container.
  node --import tsx scripts/psql-from-url.ts DIRECT_URL --no-psqlrc -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  schema_owner name;
BEGIN
  SELECT owner_role.rolname INTO schema_owner
  FROM pg_catalog.pg_namespace namespace
  JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = namespace.nspowner
  WHERE namespace.nspname = 'pgboss';

  IF schema_owner IS NULL THEN
    RAISE EXCEPTION 'pgboss schema is missing; run the privileged queue migration first';
  END IF;
  IF current_user = 'crewqual_app' OR schema_owner = 'crewqual_app' THEN
    RAISE EXCEPTION 'pgboss schema must be owned and migrated by the owner role';
  END IF;
END;
$$;

REVOKE ALL PRIVILEGES ON SCHEMA pgboss FROM PUBLIC, crewqual_app;
GRANT USAGE ON SCHEMA pgboss TO crewqual_app;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA pgboss FROM PUBLIC, crewqual_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO crewqual_app;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA pgboss FROM PUBLIC, crewqual_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO crewqual_app;

-- PostgreSQL grants function EXECUTE to PUBLIC by default. PgBoss runtime
-- startup only requires create_queue for its idempotent internal queue check.
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC, crewqual_app;
GRANT EXECUTE ON FUNCTION pgboss.create_queue(text, jsonb) TO crewqual_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crewqual_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  GRANT USAGE, SELECT ON SEQUENCES TO crewqual_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC;
SQL
  exit 0
fi

: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD is required for database role provisioning}"
# The connection URL is decomposed into libpq environment variables, so it is
# never exposed in psql's argv. The application password is read from the
# environment and quoted by PostgreSQL format(%L), never shell-interpolated.
node --import tsx scripts/psql-from-url.ts DIRECT_URL --no-psqlrc -v ON_ERROR_STOP=1 \
  <<'SQL'
\getenv app_password POSTGRES_APP_PASSWORD
SELECT CASE
  WHEN current_user = 'crewqual_app' THEN 'SELECT 1/0'
  ELSE 'SELECT 1'
END \gexec

SELECT CASE
  WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'crewqual_app')
    THEN format('ALTER ROLE %I LOGIN PASSWORD %L', 'crewqual_app', :'app_password')
  ELSE format('CREATE ROLE %I LOGIN PASSWORD %L', 'crewqual_app', :'app_password')
END \gexec

-- NOINHERIT alone does not prevent SET ROLE. Remove every direct membership
-- so a pre-existing or drifted application login cannot assume another role.
SELECT format('REVOKE %I FROM %I', granted_role.rolname, 'crewqual_app')
FROM pg_catalog.pg_auth_members membership
JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = membership.roleid
JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
WHERE member_role.rolname = 'crewqual_app'
\gexec

SELECT format(
  'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  'crewqual_app'
) \gexec
SQL
