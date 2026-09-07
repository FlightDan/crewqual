import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  activeKey,
  keyringJSON,
  nextKey,
  parseKeyring,
  parseKeyringJSON,
  type KeyringDocument,
  type KeyStatus,
} from "./keyring-utils.js";

const execFileAsync = promisify(execFile);
const defaultRepo = "/root/crewqual";
const defaultKeyDir = "/root/crewqual-release-keys";
const expectedRepository = "FlightDan/crewqual";
const publicSpkiPrefix = Buffer.from("302a300506032b6570032100", "hex");

export type KeyMaterial = {
  id: string;
  fingerprint: string;
  privatePem: string;
  privateDerB64: string;
  publicPem: string;
  publicRawB64: string;
};

export type ManagerOptions = {
  repoDir: string;
  keyDir: string;
  github: boolean;
  githubRepo: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function assertSafeName(value: string, label: string) {
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(value)) fail(`${label} is invalid`);
}

async function assertNoSymlink(path: string, label: string) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) fail(`${label} must not be a symbolic link`);
    return info;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function ensureSecureKeyDir(keyDir: string) {
  await mkdir(keyDir, { recursive: true, mode: 0o700 });
  const info = await assertNoSymlink(keyDir, "key directory");
  if (!info?.isDirectory()) fail("key directory must be a directory");
  await chmod(keyDir, 0o700);
  await inspectSecureKeyDir(keyDir);
}

async function inspectSecureKeyDir(keyDir: string) {
  const info = await assertNoSymlink(keyDir, "key directory");
  if (!info?.isDirectory()) fail("key directory must be a directory");
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid !== undefined && info.uid !== uid)
    fail("key directory must be owned by the current user");
  if (resolve(keyDir).startsWith("/root/") && uid !== 0) {
    fail("a key directory under /root must be managed by root");
  }
  if ((info.mode & 0o777) !== 0o700) fail("key directory must have mode 0700");
  const keysDir = await assertNoSymlink(join(keyDir, "keys"), "key material root");
  if (keysDir && (!keysDir.isDirectory() || (keysDir.mode & 0o777) !== 0o700)) {
    fail("key material root must be a directory with mode 0700");
  }
}

async function readRegular(path: string, label: string) {
  const info = await assertNoSymlink(path, label);
  if (!info?.isFile()) fail(`${label} must be a regular file`);
  return readFile(path, "utf8");
}

function deriveMaterial(privatePem: string): KeyMaterial {
  let privateKey;
  try {
    privateKey = createPrivateKey({ key: privatePem, format: "pem", type: "pkcs8" });
  } catch (error) {
    fail(`invalid PKCS#8 private key: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (privateKey.asymmetricKeyType !== "ed25519") fail("private key must be Ed25519");
  const publicKey = createPublicKey(privateKey);
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  if (
    publicDer.length !== 44 ||
    !publicDer.subarray(0, publicSpkiPrefix.length).equals(publicSpkiPrefix)
  ) {
    fail("unexpected Ed25519 SPKI public key encoding");
  }
  const rawPublic = publicDer.subarray(publicSpkiPrefix.length);
  const fingerprint = createHash("sha256").update(rawPublic).digest("hex");
  return {
    id: `manifest-${fingerprint.slice(0, 16)}`,
    fingerprint,
    privatePem,
    privateDerB64: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    publicRawB64: rawPublic.toString("base64"),
  };
}

export function generateKeyMaterial(): KeyMaterial {
  const { privateKey } = generateKeyPairSync("ed25519");
  return deriveMaterial(privateKey.export({ format: "pem", type: "pkcs8" }).toString());
}

async function loadKeyMaterial(keyDir: string, keyId: string) {
  assertSafeName(keyId, "key id");
  const directory = join(keyDir, "keys", keyId);
  const privatePem = await readRegular(join(directory, "private.pk8.pem"), "private key");
  const material = deriveMaterial(privatePem);
  if (material.id !== keyId) fail(`private key does not derive the expected key id ${keyId}`);
  const publicPath = join(directory, "public.raw.b64");
  const storedPublic = (await readRegular(publicPath, "public key")).trim();
  if (storedPublic !== material.publicRawB64) fail(`stored public key does not match ${keyId}`);
  return material;
}

async function writeNewKeyDirectory(keyDir: string, material: KeyMaterial) {
  const directory = join(keyDir, "keys", material.id);
  if (await assertNoSymlink(directory, "key material directory")) {
    fail(`key material already exists for ${material.id}; refusing to overwrite`);
  }
  const keysDir = join(keyDir, "keys");
  const keysInfo = await assertNoSymlink(keysDir, "key material root");
  if (keysInfo && !keysInfo.isDirectory()) fail("key material root must be a directory");
  await mkdir(keysDir, { recursive: true, mode: 0o700 });
  await chmod(keysDir, 0o700);
  const temporary = await mkdtemp(join(keyDir, ".key-"));
  try {
    await writeFile(join(temporary, "private.pk8.pem"), material.privatePem, { mode: 0o600 });
    await writeFile(join(temporary, "public.pem"), material.publicPem, { mode: 0o600 });
    await writeFile(join(temporary, "public.raw.b64"), `${material.publicRawB64}\n`, {
      mode: 0o600,
    });
    await writeFile(
      join(temporary, "metadata.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          id: material.id,
          algorithm: "Ed25519",
          fingerprint: `sha256:${material.fingerprint}`,
          publicKey: material.publicRawB64,
          createdAt: new Date().toISOString(),
        },
        null,
      )}\n`,
      { mode: 0o600 },
    );
    await rename(temporary, directory);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function parseRepoKeyring(raw: string) {
  return parseKeyringJSON(raw, { requireActive: false });
}

async function readRepoKeyring(repoDir: string) {
  return parseRepoKeyring(
    await readRegular(join(repoDir, "security/update-manifest-keyring.json"), "source keyring"),
  );
}

function keyringWithStatus(
  keyring: KeyringDocument,
  keyId: string,
  status: KeyStatus,
  requireActive = true,
): KeyringDocument {
  let found = false;
  const keys = keyring.keys.map((key) => {
    if (key.id !== keyId) return key;
    found = true;
    return { ...key, status };
  });
  if (!found) fail(`keyring key ${keyId} was not found`);
  return parseKeyring({ schemaVersion: 1, keys }, { requireActive });
}

function addKey(
  keyring: KeyringDocument,
  material: KeyMaterial,
  status: KeyStatus,
): KeyringDocument {
  if (
    keyring.keys.some((key) => key.id === material.id || key.publicKey === material.publicRawB64)
  ) {
    fail(`keyring already contains key ${material.id} or its public key`);
  }
  return parseKeyring(
    {
      schemaVersion: 1,
      keys: [...keyring.keys, { id: material.id, publicKey: material.publicRawB64, status }],
    },
    { requireActive: true },
  );
}

async function writeAtomic(path: string, content: string, mode: number) {
  const directory = dirname(path);
  const temporary = join(
    directory,
    `.${path.split("/").pop()}tmp-${process.pid}-${Math.random().toString(16).slice(2)}`,
  );
  try {
    await writeFile(temporary, content, { mode });
    await chmod(temporary, mode);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function syncRepoFiles(repoDir: string, keyring: KeyringDocument) {
  const normalized = parseKeyring(keyring, { requireActive: true });
  const sourcePath = join(repoDir, "security/update-manifest-keyring.json");
  const updaterPath = join(repoDir, "updater/keyring.json");
  const installerPath = join(repoDir, "install.sh");
  const sourceInfo = await assertNoSymlink(sourcePath, "source keyring");
  const updaterInfo = await assertNoSymlink(updaterPath, "updater keyring");
  const installerInfo = await assertNoSymlink(installerPath, "installer");
  if (!sourceInfo?.isFile() || !updaterInfo?.isFile() || !installerInfo?.isFile()) {
    fail("repository keyring files must be regular files");
  }
  const installer = await readFile(installerPath, "utf8");
  const matches = [...installer.matchAll(/BUILTIN_UPDATE_KEYRING_JSON='([^']+)'/g)];
  if (matches.length !== 1) fail("install.sh must contain exactly one embedded update keyring");
  const compact = JSON.stringify(normalized);
  const replacement = installer.replace(matches[0][0], `BUILTIN_UPDATE_KEYRING_JSON='${compact}'`);
  const desired = new Map<string, { content: string; mode: number }>([
    [sourcePath, { content: keyringJSON(normalized), mode: 0o644 }],
    [updaterPath, { content: keyringJSON(normalized), mode: 0o644 }],
    [installerPath, { content: replacement, mode: installerInfo.mode & 0o777 }],
  ]);
  const originals = new Map<string, string>();
  const changed: string[] = [];
  for (const [path, target] of desired) {
    const current = await readFile(path, "utf8");
    originals.set(path, current);
    if (current !== target.content) changed.push(path);
  }
  try {
    for (const path of changed) {
      const target = desired.get(path)!;
      await writeAtomic(path, target.content, target.mode);
    }
  } catch (error) {
    for (const path of changed) {
      const original = originals.get(path);
      if (original !== undefined) {
        const mode = path === installerPath ? installerInfo.mode & 0o777 : 0o644;
        await writeAtomic(path, original, mode);
      }
    }
    throw error;
  }
  return { changed: changed.length, activeKeyId: activeKey(normalized).id };
}

function releaseEnv(material: KeyMaterial) {
  return [
    "# Generated by crewqual-manifest-key; mode 0600; do not commit.",
    `export UPDATE_MANIFEST_PRIVATE_KEY_B64='${material.privateDerB64}'`,
    `export UPDATE_MANIFEST_SIGNING_KEY_ID='${material.id}'`,
    `export RELEASE_MANIFEST_SIGNING_PUBLIC_KEY_B64='${material.publicRawB64}'`,
    "",
  ].join("\n");
}

async function writeReleaseEnv(keyDir: string, material: KeyMaterial) {
  await writeAtomic(join(keyDir, "release.env"), releaseEnv(material), 0o600);
  await chmod(join(keyDir, "release.env"), 0o600);
}

async function writeReadme(keyDir: string) {
  const path = join(keyDir, "README.txt");
  const existing = await assertNoSymlink(path, "key directory README");
  if (existing && !existing.isFile()) fail("key directory README must be a regular file");
  await writeAtomic(
    path,
    [
      "CrewQual 发布签名密钥目录",
      "",
      "本目录保存 CrewQual manifest 和 Release tag 的签名材料。目录权限必须为 0700。",
      "私钥不会复制到 Git 仓库；请使用加密方式制作离线备份。",
      "",
      "一、Manifest Ed25519 密钥",
      "  ./crewqual-manifest-key status",
      "  ./crewqual-manifest-key sync",
      "  ./crewqual-manifest-key rotate-stage",
      "  ./crewqual-manifest-key rotate-activate",
      "  ./crewqual-manifest-key github-sync",
      "",
      "二、GPG Release tag 签名",
      "  ./crewqual-release-tag setup",
      "  ./crewqual-release-tag configure-git",
      "  ./crewqual-release-tag unlock",
      "  ./crewqual-release-tag sign",
      "  ./crewqual-release-tag verify v1.0.1",
      "  ./crewqual-release-tag github-sync",
      "",
      "直接运行 sign 会交互询问 tag，例如 v1.0.1 或 v1.0.1-rc.1。",
      "setup 会为 CrewQual 仓库配置本地 Git commit 签名；configure-git 可单独修复 pinentry/TTY 错误。",
      "默认允许脏工作区，但签名 tag 只包含当前 HEAD，不包含未提交改动。",
      "如需严格禁止脏工作区，使用 sign --strict-clean。",
      "",
      "三、本地密码文件",
      "  gpg-passphrase",
      "  文件权限必须为 0600，只写入一行 GPG 密码。留空则使用 gpg-agent。",
      "  密码文件是本地明文敏感文件，绝不能提交或复制到 Git 仓库。",
      "",
    ].join("\n"),
    0o600,
  );
  await chmod(path, 0o600);
}

function verifyRoundTrip(material: KeyMaterial) {
  const privateKey = createPrivateKey({
    key: Buffer.from(material.privateDerB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey);
  const message = Buffer.from("CrewQual manifest signing key self-test");
  const signature = sign(null, message, privateKey);
  if (!verify(null, message, publicKey, signature)) fail("manifest signing self-test failed");
  const tampered = Buffer.from(message);
  tampered[0] ^= 1;
  if (verify(null, tampered, publicKey, signature)) fail("manifest signing tamper test failed");
}

async function runGithubSecret(githubRepo: string, name: string, value: string) {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("gh", ["secret", "set", name, "--repo", githubRepo], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`gh secret set ${name} failed with exit code ${code}`)),
    );
    child.stdin.end(value);
  });
}

async function syncGithub(options: ManagerOptions, material: KeyMaterial) {
  await execFileAsync("gh", ["auth", "status", "--hostname", "github.com"]);
  await runGithubSecret(
    options.githubRepo,
    "RELEASE_MANIFEST_SIGNING_PUBLIC_KEY_B64",
    material.publicRawB64,
  );
  await runGithubSecret(options.githubRepo, "UPDATE_MANIFEST_SIGNING_KEY_ID", material.id);
  await runGithubSecret(
    options.githubRepo,
    "UPDATE_MANIFEST_PRIVATE_KEY_B64",
    material.privateDerB64,
  );
}

async function prepareKeyDir(options: ManagerOptions) {
  await ensureSecureKeyDir(options.keyDir);
  await writeReadme(options.keyDir);
}

async function init(options: ManagerOptions) {
  await prepareKeyDir(options);
  const current = await readRepoKeyring(options.repoDir);
  let keyring = current;
  let material: KeyMaterial;
  if (current.keys.length === 0) {
    const entries = await readdir(join(options.keyDir, "keys"), { withFileTypes: true }).catch(
      () => [],
    );
    const materialEntries = entries.filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith("."),
    );
    if (materialEntries.length > 1) {
      fail("keyring is empty but multiple external keys exist; refusing to guess");
    }
    if (materialEntries.length === 1) {
      assertSafeName(materialEntries[0].name, "external key id");
      material = await loadKeyMaterial(options.keyDir, materialEntries[0].name);
    } else {
      material = generateKeyMaterial();
      await writeNewKeyDirectory(options.keyDir, material);
    }
    keyring = parseKeyring(
      {
        schemaVersion: 1,
        keys: [{ id: material.id, publicKey: material.publicRawB64, status: "active" }],
      },
      { requireActive: true },
    );
  } else {
    const active = activeKey(current);
    material = await loadKeyMaterial(options.keyDir, active.id);
    if (active.publicKey !== material.publicRawB64)
      fail("active keyring public key does not match the external private key");
  }
  verifyRoundTrip(material);
  const syncResult = await syncRepoFiles(options.repoDir, keyring);
  await writeReleaseEnv(options.keyDir, material);
  console.log(
    JSON.stringify({ command: "init", activeKeyId: material.id, changedFiles: syncResult.changed }),
  );
  if (options.github) await syncGithub(options, material);
}

async function sync(options: ManagerOptions) {
  await prepareKeyDir(options);
  const keyring = parseKeyring(await readRepoKeyring(options.repoDir), { requireActive: true });
  const active = activeKey(keyring);
  const material = await loadKeyMaterial(options.keyDir, active.id);
  if (active.publicKey !== material.publicRawB64)
    fail("active keyring public key does not match the external private key");
  verifyRoundTrip(material);
  const syncResult = await syncRepoFiles(options.repoDir, keyring);
  await writeReleaseEnv(options.keyDir, material);
  console.log(
    JSON.stringify({ command: "sync", activeKeyId: active.id, changedFiles: syncResult.changed }),
  );
}

async function rotateStage(options: ManagerOptions) {
  await prepareKeyDir(options);
  const current = parseKeyring(await readRepoKeyring(options.repoDir), { requireActive: true });
  const active = activeKey(current);
  if (current.keys.some((key) => key.status === "next")) fail("a next key is already staged");
  const activeMaterial = await loadKeyMaterial(options.keyDir, active.id);
  if (active.publicKey !== activeMaterial.publicRawB64)
    fail("active key does not match external material");
  const nextMaterial = generateKeyMaterial();
  await writeNewKeyDirectory(options.keyDir, nextMaterial);
  const staged = addKey(current, nextMaterial, "next");
  await syncRepoFiles(options.repoDir, staged);
  console.log(
    JSON.stringify({ command: "rotate-stage", activeKeyId: active.id, nextKeyId: nextMaterial.id }),
  );
}

async function rotateActivate(options: ManagerOptions) {
  await prepareKeyDir(options);
  const current = parseKeyring(await readRepoKeyring(options.repoDir), { requireActive: true });
  const oldActive = activeKey(current);
  const staged = nextKey(current);
  const material = await loadKeyMaterial(options.keyDir, staged.id);
  if (staged.publicKey !== material.publicRawB64) fail("next key does not match external material");
  const retired = keyringWithStatus(current, oldActive.id, "retired", false);
  const activated = keyringWithStatus(retired, staged.id, "active");
  verifyRoundTrip(material);
  const syncResult = await syncRepoFiles(options.repoDir, activated);
  await writeReleaseEnv(options.keyDir, material);
  console.log(
    JSON.stringify({
      command: "rotate-activate",
      oldActiveKeyId: oldActive.id,
      activeKeyId: staged.id,
      changedFiles: syncResult.changed,
    }),
  );
  if (options.github) await syncGithub(options, material);
}

async function status(options: ManagerOptions) {
  await inspectSecureKeyDir(options.keyDir);
  const keyring = parseRepoKeyring(
    await readRegular(
      join(options.repoDir, "security/update-manifest-keyring.json"),
      "source keyring",
    ),
  );
  const keys = await Promise.all(
    keyring.keys.map(async (key) => {
      let external = false;
      try {
        const material = await loadKeyMaterial(options.keyDir, key.id);
        external = material.publicRawB64 === key.publicKey;
      } catch {
        external = false;
      }
      return { id: key.id, status: key.status, externalPrivateKeyPresent: external };
    }),
  );
  console.log(JSON.stringify({ repository: expectedRepository, keyring: keys }));
}

async function githubSync(options: ManagerOptions) {
  const keyring = parseKeyring(await readRepoKeyring(options.repoDir), { requireActive: true });
  const material = await loadKeyMaterial(options.keyDir, activeKey(keyring).id);
  verifyRoundTrip(material);
  await syncGithub(options, material);
  console.log(JSON.stringify({ command: "github-sync", activeKeyId: material.id }));
}

function usage(exitCode = 2): never {
  console.error(
    `Usage: crewqual-manifest-key <init|status|sync|rotate-stage|rotate-activate|github-sync> [--repo PATH] [--key-dir PATH] [--github]`,
  );
  process.exit(exitCode);
}

function parseArgs(argv: string[]): { command: string; options: ManagerOptions } {
  const command = argv.shift();
  if (!command) usage();
  if (command === "--help" || command === "-h") usage(0);
  const options: ManagerOptions = {
    repoDir: defaultRepo,
    keyDir: defaultKeyDir,
    github: false,
    githubRepo: expectedRepository,
  };
  while (argv.length > 0) {
    const arg = argv.shift();
    if (arg === "--github") options.github = true;
    else if (arg === "--repo") options.repoDir = resolve(argv.shift() ?? usage());
    else if (arg === "--key-dir") options.keyDir = resolve(argv.shift() ?? usage());
    else if (arg === "--github-repo") options.githubRepo = argv.shift() ?? usage();
    else usage();
  }
  return { command, options };
}

export async function run(argv: string[]) {
  const { command, options } = parseArgs([...argv]);
  if (
    options.github &&
    command !== "init" &&
    command !== "rotate-activate" &&
    command !== "github-sync"
  ) {
    fail("--github is only supported by init, rotate-activate, and github-sync");
  }
  if (command === "init") return init(options);
  if (command === "status") return status(options);
  if (command === "sync") return sync(options);
  if (command === "rotate-stage") return rotateStage(options);
  if (command === "rotate-activate") return rotateActivate(options);
  if (command === "github-sync") return githubSync(options);
  usage();
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
