import { spawn } from "node:child_process";

const port = process.env.PLAYWRIGHT_PORT ?? "3000";
const appOrigin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`;

const env = {
  ...process.env,
  NODE_ENV: "development",
  SERVICE_MODE: "remote",
  NEXT_PUBLIC_SERVICE_MODE: "remote",
  // Never reuse a client bundle compiled for mock mode. Next embeds public
  // environment variables at compile time, so remote E2E needs its own cache.
  CREWQUAL_DIST_DIR: process.env.CREWQUAL_DIST_DIR ?? ".next-e2e-remote",
  SMS_ADAPTER: process.env.SMS_ADAPTER ?? "fake",
  FEISHU_ADAPTER: process.env.FEISHU_ADAPTER ?? "disabled",
  VLM_ADAPTER: process.env.VLM_ADAPTER ?? "disabled",
  CREWQUAL_TEST_NO_EXTERNAL: "1",
  // Remote mode requires an explicit session secret; e2e only enables the
  // dev helper endpoints (used to mint member access tokens).
  SESSION_SECRET:
    process.env.SESSION_SECRET ?? "remote-e2e-only-session-secret-0123456789abcdef0123",
  DEV_ENDPOINTS: process.env.DEV_ENDPOINTS ?? "true",
  DEV_ENDPOINTS_SECRET:
    process.env.DEV_ENDPOINTS_SECRET ?? "remote-e2e-dev-endpoint-secret-0123456789",
  APP_ORIGIN: appOrigin,
  DATABASE_URL:
    process.env.DATABASE_URL ?? "postgresql://crewqual:crewqual@127.0.0.1:55432/crewqual",
  DIRECT_URL: process.env.DIRECT_URL ?? "postgresql://crewqual:crewqual@127.0.0.1:55432/crewqual",
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://127.0.0.1:59000",
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "crewqual",
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? "crewqualpassword",
  S3_BUCKET: process.env.S3_BUCKET ?? "crewqual-private",
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE ?? "true",
};

const children = [
  spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", port],
    {
      env,
      stdio: "inherit",
    },
  ),
  spawn(process.execPath, ["--import", "tsx", "src/worker/index.ts"], {
    env,
    stdio: "inherit",
  }),
];

let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 1_500);
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
for (const child of children) child.on("exit", (code) => code && stop(code));
