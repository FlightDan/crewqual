import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  acceptanceConfigIssues,
  acceptanceInputIssues,
  RELEASE_SANDBOX_INFRASTRUCTURE_SECRETS,
} from "../../scripts/release/acceptance-config";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const validPrivateKey = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const testKeyring = {
  schemaVersion: 1 as const,
  keys: [
    {
      id: "release-2026",
      publicKey: publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64"),
      status: "active" as const,
    },
  ],
};
const options = { scope: "full" as const, profile: "final" as const, keyring: testKeyring };

function validEnvironment(): Record<string, string | undefined> {
  return {
    RELEASE_TAG: "v1.0.6",
    RELEASE_UPGRADE_FROM_TAG: "",
    UPDATE_MANIFEST_PRIVATE_KEY_B64: validPrivateKey,
    UPDATE_MANIFEST_SIGNING_KEY_ID: "release-2026",
    RELEASE_TAG_SIGNING_PUBLIC_KEY_B64: Buffer.from(
      "-----BEGIN PGP PUBLIC KEY BLOCK-----\ntest\n-----END PGP PUBLIC KEY BLOCK-----",
    ).toString("base64"),
    RELEASE_SIGNER_FINGERPRINTS: "A".repeat(40),
    LICENSE_APPROVALS_JSON: JSON.stringify({ licenses: [] }),
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "acceptance-access-key",
    AWS_SECRET_ACCESS_KEY: "acceptance-secret-key",
    S3_ENDPOINT: "https://s3.example.test",
    EVIDENCE_S3_BUCKET: "crewqual-evidence",
    BACKUP_S3_BUCKET: "crewqual-backup",
    RESTORE_S3_BUCKET: "crewqual-restore",
    S3_KMS_KEY_ARN: "arn:aws:kms:us-east-1:123456789012:key/example",
    S3_FORBIDDEN_PREFIX: "forbidden",
    BACKUP_RECOVERY_SET_ID: "recovery-set",
    BACKUP_DATABASE_RUN_ID: "database-run",
    BACKUP_GALLERY_RUN_ID: "gallery-run",
    BACKUP_TAMPER_ARTIFACT_KEYS: JSON.stringify({
      database: "tamper/database",
      gallery: "tamper/gallery",
      blob: "tamper/blob",
    }),
    BACKUP_TAMPER_BLOB_SHA256: "b".repeat(64),
    DATABASE_URL: "postgresql://app:secret@db.example.test/crewqual",
    RESTORE_DATABASE_URL: "postgresql://restore:secret@restore.example.test/crewqual",
  };
}

describe("release acceptance configuration", () => {
  it("accepts a complete, isolated final release configuration", () => {
    expect(acceptanceConfigIssues(validEnvironment(), options)).toEqual([]);
  });

  it("reports every missing full acceptance setting in one issue", () => {
    const issues = acceptanceConfigIssues(
      { RELEASE_TAG: "v1.0.6", RELEASE_UPGRADE_FROM_TAG: "" },
      options,
    );
    expect(issues).toHaveLength(1);
    for (const name of [
      "UPDATE_MANIFEST_PRIVATE_KEY_B64",
      "RELEASE_TAG_SIGNING_PUBLIC_KEY_B64",
      "LICENSE_APPROVALS_JSON",
      ...RELEASE_SANDBOX_INFRASTRUCTURE_SECRETS,
    ]) {
      expect(issues[0]).toContain(name);
    }
  });

  it("keeps local RC acceptance independent of S3 and disaster-recovery infrastructure", () => {
    const environment = validEnvironment();
    for (const name of RELEASE_SANDBOX_INFRASTRUCTURE_SECRETS) delete environment[name];
    delete environment.LICENSE_APPROVALS_JSON;
    environment.RELEASE_TAG = "v1.0.6-rc.1";
    expect(
      acceptanceConfigIssues(environment, {
        scope: "local",
        profile: "rc",
        keyring: testKeyring,
      }),
    ).toEqual([]);
  });

  it("requires full acceptance for a final release", () => {
    const environment = validEnvironment();
    for (const name of RELEASE_SANDBOX_INFRASTRUCTURE_SECRETS) delete environment[name];
    expect(
      acceptanceConfigIssues(environment, {
        scope: "local",
        profile: "final",
        keyring: testKeyring,
      }).join("\n"),
    ).toContain("final releases require full acceptance");
  });

  it("aggregates malformed and non-isolated full acceptance values", () => {
    const environment = validEnvironment();
    environment.S3_ENDPOINT = "http://s3.example.test";
    environment.RESTORE_DATABASE_URL = environment.DATABASE_URL;
    environment.RESTORE_S3_BUCKET = environment.BACKUP_S3_BUCKET;
    environment.BACKUP_TAMPER_ARTIFACT_KEYS = '{"database":""}';
    environment.BACKUP_TAMPER_BLOB_SHA256 = "not-a-hash";
    environment.RELEASE_SIGNER_FINGERPRINTS = "short";
    environment.LICENSE_APPROVALS_JSON = '{"licenses":[""]}';
    const message = acceptanceConfigIssues(environment, options).join("\n");
    expect(message).toContain("S3_ENDPOINT 必须使用 https:");
    expect(message).toContain("RESTORE_DATABASE_URL 不得指向在线 DATABASE_URL 的同一数据库");
    expect(message).toContain("必须彼此隔离");
    expect(message).toContain("BACKUP_TAMPER_ARTIFACT_KEYS 缺少非空字段");
    expect(message).toContain("BACKUP_TAMPER_BLOB_SHA256");
    expect(message).toContain("RELEASE_SIGNER_FINGERPRINTS");
    expect(message).toContain("LICENSE_APPROVALS_JSON");
  });

  it("recognizes the same database despite credentials, aliases, and URL options", () => {
    const environment = validEnvironment();
    environment.DATABASE_URL = "postgresql://app:first@DB.EXAMPLE.TEST/crewqual?schema=public";
    environment.RESTORE_DATABASE_URL = "postgres://restore:second@db.example.test:5432/crewqual";
    expect(acceptanceConfigIssues(environment, options).join("\n")).toContain(
      "RESTORE_DATABASE_URL 不得指向在线 DATABASE_URL 的同一数据库",
    );
  });

  it("rejects a well-formed manifest private key that does not match the active keyring", () => {
    const environment = validEnvironment();
    const { privateKey: otherKey } = generateKeyPairSync("ed25519");
    environment.UPDATE_MANIFEST_PRIVATE_KEY_B64 = otherKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64");
    expect(acceptanceConfigIssues(environment, options).join("\n")).toContain(
      "UPDATE_MANIFEST_PRIVATE_KEY_B64 必须匹配 manifest keyring 的 active key",
    );
  });

  it("rejects stable local releases in the local orchestrator", () => {
    const script = path.resolve(process.cwd(), "scripts/release/crewqual-release-publish");
    const result = spawnSync(
      "bash",
      ["-c", 'source "$1"; validate_release_args v1.0.5 "" local', "test", script],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("final releases require full acceptance");
  });

  it("aggregates missing release-sandbox secret names without printing values", () => {
    const script = path.resolve(process.cwd(), "scripts/release/crewqual-release-publish");
    const result = spawnSync(
      "bash",
      [
        "-c",
        'source "$1"; gh() { printf "AWS_REGION\\tconfigured-secret-value\\n"; }; validate_release_environment_secrets full',
        "test",
        script,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("S3_ENDPOINT");
    expect(result.stderr).toContain("DATABASE_URL");
    expect(result.stderr).not.toContain("configured-secret-value");
  });
});

describe("release input safeguards", () => {
  const script = path.resolve("scripts/release/crewqual-release-publish");
  const helper = path.resolve("scripts/release/validate-release-inputs.sh");
  it.each([
    ["v1.0.6-rc.1", "rc", "local", "", "fresh"],
    ["v1.0.6", "final", "full", "", "fresh"],
    ["v1.0.6-rc.2", "rc", "local", "v1.0.6-rc.1", "upgrade"],
    ["v1.0.6", "final", "full", "v1.0.5", "upgrade"],
    ["v1.0.6-rc.100000000000000000000", "rc", "local", "v1.0.6-rc.99999999999999999999", "upgrade"],
  ])("accepts %s as %s / %s from %s", (tag, profile, scope, baseline, mode) => {
    const result = spawnSync("bash", [helper, tag, profile, scope, baseline], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(mode);
  });

  it.each([
    ["v1.0.6-rc.1", "final", ""],
    ["v1.0.6", "rc", ""],
    ["v1.0.6", "final", "v1.0.5-rc.1"],
    ["v1.0.6-rc.1", "rc", "v1.0.5"],
    ["v1.0.6-rc.1", "rc", "v1.0.6-rc.1"],
    ["v1.0.6", "final", "v1.0.7"],
    ["v1.0.06", "final", ""],
    ["v1.0.6-rc.01", "rc", ""],
    ["v1.0.6", "final", " "],
  ])("rejects invalid combination %s %s %s before secret validation", (tag, profile, baseline) => {
    const issues = acceptanceInputIssues(
      { RELEASE_TAG: tag, RELEASE_UPGRADE_FROM_TAG: baseline },
      { scope: "local", profile: profile as "rc" | "final" },
    );
    expect(issues).toHaveLength(1);
    const result = spawnSync("bash", [helper, tag, profile, "local", baseline]);
    expect(result.status).toBe(1);
  });

  it("requires an explicit baseline and rejects invalid scope", () => {
    expect(acceptanceInputIssues({}, options).join()).toContain("显式设置");
    expect(spawnSync("bash", [helper, "v1.0.6", "final", "local"]).status).toBe(1);
    expect(spawnSync("bash", [helper, "v1.0.6", "final", "other", ""]).status).toBe(1);
  });

  it("validates CLI arguments without keys, repository, or dependencies", () => {
    const result = spawnSync(
      "bash",
      [script, "release", "v1.0.6-rc.1", "--upgrade-from", "", "--validate-only"],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          CREWQUAL_REPO_DIR: "/missing-repo",
          CREWQUAL_RELEASE_KEY_DIR: "/missing-keys",
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("fresh");
    const invalid = spawnSync("bash", [script, "release", "invalid", "--first-release"], {
      encoding: "utf8",
    });
    expect(invalid.stderr).toContain("invalid release tag");
    expect(invalid.stderr).not.toContain("签名目录");
  });

  it("defaults both tag and asset replacement to opt-in", () => {
    const result = spawnSync(
      "bash",
      [
        "-c",
        'source "$1"; release() { printf "%s" "$5"; }; parse_release v1.0.6-rc.1 --first-release',
        "test",
        script,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("0");
    const optIn = spawnSync(
      "bash",
      [
        "-c",
        'source "$1"; release() { printf "%s" "$5"; }; parse_release v1.0.6-rc.1 --first-release --replace-existing-tag',
        "test",
        script,
      ],
      { encoding: "utf8" },
    );
    expect(optIn.stdout).toBe("1");
  });

  it.each(["local", "remote"])(
    "refuses an existing %s tag before secrets are synced",
    (location) => {
      const result = spawnSync(
        "bash",
        [
          "-c",
          `
      source "$1"
      ensure_secure_dir() { :; }
      ensure_repo() { :; }
      current_branch() { printf main; }
      git() { printf fake-commit; }
      # Capture location outside function positional arguments.
      location="$2"
      tag_exists_local() { [[ "$location" == local ]]; }
      tag_exists_remote() { [[ "$location" == remote ]]; }
      sync_secrets() { printf 'unexpected secret access'; exit 99; }
      parse_release v1.0.6-rc.1 --first-release
    `,
          "test",
          script,
          location,
        ],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--replace-existing-tag");
      expect(result.stdout).not.toContain("unexpected secret access");
    },
  );

  it("fails closed when remote tag lookup fails", () => {
    const result = spawnSync(
      "bash",
      [
        "-c",
        'source "$1"; git() { return 128; }; if tag_exists_remote v1.0.6; then :; fi; printf unsafe',
        "test",
        script,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("无法确认远端 tag");
    expect(result.stdout).not.toContain("unsafe");
  });

  it.each([
    ["--first-release", "--upgrade-from", ""],
    ["--upgrade-from", "", "--first-release"],
  ])("rejects conflicting fresh and upgrade options", (...args) => {
    expect(
      spawnSync("bash", [script, "release", "v1.0.6", ...args, "--validate-only"]).status,
    ).toBe(1);
  });
});
