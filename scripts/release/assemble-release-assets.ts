import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const assetDir = process.env.RELEASE_ASSET_DIR ?? ".artifacts/release-assets";
const evidencePath =
  process.env.RELEASE_EVIDENCE_PATH ??
  join(
    process.env.RELEASE_EVIDENCE_DIR ?? ".artifacts/release",
    process.env.RELEASE_RUN_ID ?? "",
    "evidence.json",
  );

async function digest(path: string) {
  const bytes = await readFile(path);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength };
}

async function main() {
  const names = (await readdir(assetDir)).filter((name) => !name.endsWith(".tmp"));
  const required = [
    "update-manifest-v1.json",
    "update-manifest-v1.json.sig",
    "SHA256SUMS",
    "SHA256SUMS.sig",
    "crewqual-updater-linux-amd64",
    "crewqual-updater-linux-arm64",
    "docker-compose.install.yml",
    "Caddyfile",
    "configure-domain.sh",
    "evidence.json",
  ];
  for (const name of required)
    if (!names.includes(name)) throw new Error(`release asset is missing: ${name}`);
  const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as Record<string, unknown>;
  const artifacts = [] as Array<Record<string, string | number>>;
  for (const name of names) {
    // Evidence files contain this list, so hashing them would create a
    // self-referential artifact. They are covered by their signatures.
    if (name === "evidence.json" || name.startsWith("evidence.")) continue;
    const info = await stat(join(assetDir, name));
    if (!info.isFile()) continue;
    const file = await digest(join(assetDir, name));
    artifacts.push({ path: name, ...file });
  }
  artifacts.sort((left, right) => String(left.path).localeCompare(String(right.path)));
  evidence.artifacts = artifacts;
  evidence.releaseTag = process.env.RELEASE_TAG ?? "";
  evidence.commit = process.env.RELEASE_COMMIT ?? evidence.commit;
  evidence.manifestSigningKeyId = process.env.UPDATE_MANIFEST_SIGNING_KEY_ID ?? "";
  evidence.imageDigests = {
    web: process.env.RELEASE_WEB_IMAGE ?? "",
    runtime: process.env.RELEASE_RUNTIME_IMAGE ?? "",
  };
  await writeFile(join(assetDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(JSON.stringify({ assetDir, artifacts: artifacts.length }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
