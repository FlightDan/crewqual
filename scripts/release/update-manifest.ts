import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { parseKeyringJSON, activeKey } from "./keyring-utils.js";

const sha256 = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

const repository = process.env.GITHUB_REPOSITORY ?? "FlightDan/crewqual";
const releaseAsset = (version: string, asset: string) =>
  `https://github.com/${repository}/releases/download/${version}/${asset}`;

function normalizeUtcTimestamp(value: string, source = "publishedAt") {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    throw new Error(`${source} must be an RFC3339 timestamp with a timezone`);
  }
  const epoch = Date.parse(trimmed);
  if (Number.isNaN(epoch)) throw new Error(`${source} is not a valid timestamp`);
  return new Date(epoch).toISOString();
}

function tagPublishedAt(version: string) {
  const configured = process.env.RELEASE_PUBLISHED_AT?.trim();
  if (configured) return normalizeUtcTimestamp(configured, "RELEASE_PUBLISHED_AT");
  const tagResult = spawnSync(
    "git",
    ["for-each-ref", "--format=%(taggerdate:iso8601-strict)", `refs/tags/${version}`],
    { encoding: "utf8" },
  );
  const result =
    tagResult.status === 0 && tagResult.stdout?.trim()
      ? tagResult
      : spawnSync("git", ["log", "-1", "--format=%cI", version], { encoding: "utf8" });
  const value = result.stdout?.trim();
  if (!value || result.status !== 0)
    throw new Error("RELEASE_PUBLISHED_AT is required when the release tag is unavailable locally");
  return normalizeUtcTimestamp(value, `publishedAt for ${version}`);
}

async function main() {
  const version = process.env.RELEASE_TAG ?? process.argv[2];
  if (
    !version ||
    !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-rc\.(?:[1-9]\d*))?$/.test(version)
  )
    throw new Error("RELEASE_TAG must be a SemVer tag");
  const webImage = process.env.RELEASE_WEB_IMAGE;
  const runtimeImage = process.env.RELEASE_RUNTIME_IMAGE;
  if (
    !webImage ||
    !/^ghcr\.io\/flightdan\/crewqual-web@sha256:[a-f0-9]{64}$/.test(webImage) ||
    !runtimeImage ||
    !/^ghcr\.io\/flightdan\/crewqual-runtime@sha256:[a-f0-9]{64}$/.test(runtimeImage)
  ) {
    throw new Error(
      "RELEASE_WEB_IMAGE and RELEASE_RUNTIME_IMAGE must be immutable digest references",
    );
  }
  const output = process.env.UPDATE_MANIFEST_OUTPUT ?? process.argv[3] ?? "update-manifest-v1.json";
  const updater = {
    amd64: process.env.UPDATER_AMD64_SHA256 ?? "",
    arm64: process.env.UPDATER_ARM64_SHA256 ?? "",
    amd64Url: releaseAsset(version, "crewqual-updater-linux-amd64"),
    arm64Url: releaseAsset(version, "crewqual-updater-linux-arm64"),
  };
  for (const [arch, checksum] of Object.entries({ amd64: updater.amd64, arm64: updater.arm64 })) {
    if (!/^[a-f0-9]{64}$/i.test(checksum)) {
      throw new Error(
        `UPDATER_${arch.toUpperCase()}_SHA256 must be a 64-character SHA-256 checksum`,
      );
    }
  }
  const manifest = {
    schemaVersion: 1,
    version,
    channel: version.includes("-") ? "rc" : "stable",
    signingKeyId: await signingKeyId(),
    publishedAt: tagPublishedAt(version),
    releaseNotesUrl: `https://github.com/${repository}/releases/tag/${version}`,
    composeUrl: releaseAsset(version, "docker-compose.install.yml"),
    composeSha256: await sha256(join(process.cwd(), "docker-compose.install.yml")),
    caddyUrl: releaseAsset(version, "Caddyfile"),
    caddySha256: await sha256(join(process.cwd(), "Caddyfile")),
    configureDomainUrl: releaseAsset(version, "configure-domain.sh"),
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

async function signingKeyId() {
  const keyring = parseKeyringJSON(
    await readFile(join(process.cwd(), "security/update-manifest-keyring.json"), "utf8"),
    { requireActive: true },
  );
  const active = activeKey(keyring).id;
  const configured = process.env.UPDATE_MANIFEST_SIGNING_KEY_ID?.trim();
  if (configured && configured !== active) {
    throw new Error(`UPDATE_MANIFEST_SIGNING_KEY_ID must match the active keyring key ${active}`);
  }
  return configured ?? active;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
