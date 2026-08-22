import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";

const sha256 = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

async function main() {
  const version = process.env.RELEASE_TAG ?? process.argv[2];
  if (!version || !/^v\d+\.\d+\.\d+$/.test(version))
    throw new Error("RELEASE_TAG must be a stable SemVer tag");
  const webImage = process.env.RELEASE_WEB_IMAGE;
  const runtimeImage = process.env.RELEASE_RUNTIME_IMAGE;
  if (!webImage?.includes("@sha256:") || !runtimeImage?.includes("@sha256:")) {
    throw new Error(
      "RELEASE_WEB_IMAGE and RELEASE_RUNTIME_IMAGE must be immutable digest references",
    );
  }
  const output = process.env.UPDATE_MANIFEST_OUTPUT ?? process.argv[3] ?? "update-manifest-v1.json";
  const rawBase = `https://raw.githubusercontent.com/FlightDan/crewqual/${version}`;
  const updater = {
    amd64: process.env.UPDATER_AMD64_SHA256 ?? "",
    arm64: process.env.UPDATER_ARM64_SHA256 ?? "",
  };
  for (const [arch, checksum] of Object.entries(updater)) {
    if (!/^[a-f0-9]{64}$/i.test(checksum)) {
      throw new Error(
        `UPDATER_${arch.toUpperCase()}_SHA256 must be a 64-character SHA-256 checksum`,
      );
    }
  }
  const manifest = {
    schemaVersion: 1,
    version,
    channel: "stable",
    publishedAt: process.env.RELEASE_PUBLISHED_AT ?? new Date().toISOString(),
    releaseNotesUrl: `https://github.com/FlightDan/crewqual/releases/tag/${version}`,
    composeUrl: `${rawBase}/docker-compose.install.yml`,
    composeSha256: await sha256(join(process.cwd(), "docker-compose.install.yml")),
    caddyUrl: `${rawBase}/Caddyfile`,
    caddySha256: await sha256(join(process.cwd(), "Caddyfile")),
    configureDomainUrl: `${rawBase}/scripts/configure-domain.sh`,
    configureDomainSha256: await sha256(join(process.cwd(), "scripts/configure-domain.sh")),
    webImage,
    runtimeImage,
    updater,
    minimumVersion: process.env.UPDATE_MINIMUM_VERSION ?? "",
    minimumUpdaterVersion: process.env.MINIMUM_UPDATER_VERSION ?? "0.1.0",
    migrationPolicy: process.env.UPDATE_MIGRATION_POLICY ?? "backward-compatible",
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  console.log(JSON.stringify({ output, version }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
