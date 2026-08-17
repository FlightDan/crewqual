import { spawn } from "node:child_process";

const env = {
  ...process.env,
  NODE_ENV: "development",
  SERVICE_MODE: "remote",
  NEXT_PUBLIC_SERVICE_MODE: "remote",
  SMS_ADAPTER: process.env.SMS_ADAPTER ?? "fake",
  FEISHU_ADAPTER: process.env.FEISHU_ADAPTER ?? "disabled",
  VLM_ADAPTER: process.env.VLM_ADAPTER ?? "disabled",
  CREWQUAL_TEST_NO_EXTERNAL: "1",
  APP_ORIGIN: process.env.APP_ORIGIN ?? "http://127.0.0.1:3000",
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
  spawn("corepack", ["pnpm", "dev", "--hostname", "127.0.0.1", "--port", "3000"], {
    env,
    stdio: "inherit",
  }),
  spawn("corepack", ["pnpm", "dev:worker"], { env, stdio: "inherit" }),
];

let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
for (const child of children) child.on("exit", (code) => code && stop(code));
