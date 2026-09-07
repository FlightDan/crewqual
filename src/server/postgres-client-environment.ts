const CONNECTION_ENV_KEYS = [
  "PGAPPNAME",
  "PGCHANNELBINDING",
  "PGCLIENTENCODING",
  "PGCONNECT_TIMEOUT",
  "PGDATABASE",
  "PGGSSENCMODE",
  "PGGSSLIB",
  "PGHOST",
  "PGHOSTADDR",
  "PGKRBSRVNAME",
  "PGLOADBALANCEHOSTS",
  "PGOPTIONS",
  "PGPASSFILE",
  "PGPASSWORD",
  "PGPORT",
  "PGREQUIREPEER",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGSSLCERT",
  "PGSSLCOMPRESSION",
  "PGSSLCRL",
  "PGSSLCRLDIR",
  "PGSSLKEY",
  "PGSSLMAXPROTOCOLVERSION",
  "PGSSLMINPROTOCOLVERSION",
  "PGSSLMODE",
  "PGSSLPASSWORD",
  "PGSSLROOTCERT",
  "PGSSLSNI",
  "PGTARGETSESSIONATTRS",
  "PGUSER",
] as const;

const SAFE_SUBPROCESS_ENV_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TMPDIR",
  "TZ",
] as const;

const QUERY_ENV_MAP = new Map<string, (typeof CONNECTION_ENV_KEYS)[number]>([
  ["application_name", "PGAPPNAME"],
  ["channel_binding", "PGCHANNELBINDING"],
  ["client_encoding", "PGCLIENTENCODING"],
  ["connect_timeout", "PGCONNECT_TIMEOUT"],
  ["dbname", "PGDATABASE"],
  ["gssencmode", "PGGSSENCMODE"],
  ["gsslib", "PGGSSLIB"],
  ["host", "PGHOST"],
  ["hostaddr", "PGHOSTADDR"],
  ["krbsrvname", "PGKRBSRVNAME"],
  ["load_balance_hosts", "PGLOADBALANCEHOSTS"],
  ["options", "PGOPTIONS"],
  ["password", "PGPASSWORD"],
  ["port", "PGPORT"],
  ["requirepeer", "PGREQUIREPEER"],
  ["sslcert", "PGSSLCERT"],
  ["sslcompression", "PGSSLCOMPRESSION"],
  ["sslcrl", "PGSSLCRL"],
  ["sslcrldir", "PGSSLCRLDIR"],
  ["sslkey", "PGSSLKEY"],
  ["ssl_max_protocol_version", "PGSSLMAXPROTOCOLVERSION"],
  ["ssl_min_protocol_version", "PGSSLMINPROTOCOLVERSION"],
  ["sslmode", "PGSSLMODE"],
  ["sslpassword", "PGSSLPASSWORD"],
  ["sslrootcert", "PGSSLROOTCERT"],
  ["sslsni", "PGSSLSNI"],
  ["target_session_attrs", "PGTARGETSESSIONATTRS"],
  ["user", "PGUSER"],
]);

// Prisma-only connection options are intentionally irrelevant to libpq tools.
const IGNORED_PRISMA_OPTIONS = new Set([
  "connection_limit",
  "pgbouncer",
  "pool_timeout",
  "schema",
  "socket_timeout",
  "statement_cache_size",
]);

function decodeUrlComponent(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`PostgreSQL URL contains an invalid ${label}`);
  }
}

/** Build an explicit child environment without forwarding application secrets. */
export function minimalSubprocessEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  additionalKeys: readonly string[] = [],
): NodeJS.ProcessEnv {
  const environment = {} as NodeJS.ProcessEnv;
  for (const key of [...SAFE_SUBPROCESS_ENV_KEYS, ...additionalKeys]) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export function postgresEnvironmentFromUrl(
  rawUrl: string,
  baseEnvironment: NodeJS.ProcessEnv = minimalSubprocessEnvironment(),
): NodeJS.ProcessEnv {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("PostgreSQL connection URL is invalid");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("PostgreSQL connection URL must use postgres:// or postgresql://");
  }
  if (parsed.hash) {
    throw new Error("PostgreSQL connection URL must not contain a fragment");
  }

  const environment: NodeJS.ProcessEnv = { ...baseEnvironment };
  for (const key of CONNECTION_ENV_KEYS) delete environment[key];
  delete environment.DATABASE_URL;
  delete environment.DIRECT_URL;

  const queryHost = parsed.searchParams.get("host");
  const host = queryHost ?? parsed.hostname.replace(/^\[|\]$/g, "");
  const database = decodeUrlComponent(parsed.pathname.replace(/^\//, ""), "database name");
  const user = decodeUrlComponent(parsed.username, "user name");

  if (!host) throw new Error("PostgreSQL connection URL must include a host");
  if (!database) throw new Error("PostgreSQL connection URL must include a database name");
  if (!user) throw new Error("PostgreSQL connection URL must include a user name");

  environment.PGHOST = host;
  environment.PGPORT = parsed.port || "5432";
  environment.PGDATABASE = database;
  environment.PGUSER = user;
  environment.PGPASSWORD = decodeUrlComponent(parsed.password, "password");

  const seen = new Set<string>();
  for (const [key, value] of parsed.searchParams) {
    if (seen.has(key)) {
      throw new Error(`PostgreSQL connection URL repeats option ${key}`);
    }
    seen.add(key);

    if (IGNORED_PRISMA_OPTIONS.has(key)) continue;
    if (key === "ssl") {
      if (value === "true" || value === "1") environment.PGSSLMODE = "require";
      else if (value === "false" || value === "0") environment.PGSSLMODE = "disable";
      else throw new Error("PostgreSQL URL ssl option must be true or false");
      continue;
    }

    const environmentKey = QUERY_ENV_MAP.get(key);
    if (!environmentKey) {
      throw new Error(`PostgreSQL URL option ${key} is not supported by the libpq client`);
    }
    environment[environmentKey] = value;
  }

  return environment;
}
