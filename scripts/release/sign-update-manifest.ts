import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseKeyringJSON, type KeyringEntry } from "./keyring-utils.js";

async function loadKeyring(): Promise<KeyringEntry[]> {
  const configured = process.env.UPDATE_MANIFEST_KEYRING_JSON;
  const raw = configured
    ? configured
    : await readFile(
        new URL("../../security/update-manifest-keyring.json", import.meta.url),
        "utf8",
      );
  return parseKeyringJSON(raw, { requireActive: true }).keys;
}

/**
 * Validate the keyring mapping and sign the exact manifest bytes.
 * The private key is only accepted through the CI secret and is never written
 * to the repository.
 */
async function main() {
  const manifestPath =
    process.env.UPDATE_MANIFEST_INPUT ?? process.argv[2] ?? "update-manifest-v1.json";
  const signaturePath =
    process.env.UPDATE_MANIFEST_SIGNATURE_OUTPUT ?? process.argv[3] ?? `${manifestPath}.sig`;
  const privateKeyB64 = process.env.UPDATE_MANIFEST_PRIVATE_KEY_B64?.trim();
  if (!privateKeyB64) {
    throw new Error("UPDATE_MANIFEST_PRIVATE_KEY_B64 is required");
  }
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw new Error("UPDATE_MANIFEST_PRIVATE_KEY_B64 must be an Ed25519 private key");
  const publicKeyDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const derivedPublicKey = publicKeyDer.subarray(-32).toString("base64");
  const keyring = await loadKeyring();
  const parsedManifest = JSON.parse((await readFile(manifestPath)).toString("utf8")) as Record<
    string,
    unknown
  >;
  if (typeof parsedManifest.signingKeyId !== "string" || !parsedManifest.signingKeyId)
    throw new Error("manifest signingKeyId is required");
  const key = keyring.find((entry) => entry.id === parsedManifest.signingKeyId);
  if (!key || key.status !== "active" || key.publicKey !== derivedPublicKey)
    throw new Error("Ed25519 private key does not match the unique active keyring entry");
  if (parsedManifest.signingPublicKey !== undefined)
    throw new Error("signingPublicKey is forbidden; use signingKeyId");
  const signedManifest = Buffer.from(`${JSON.stringify(parsedManifest, null, 2)}\n`);
  await writeFile(manifestPath, signedManifest, { mode: 0o644 });
  const signature = sign(null, signedManifest, privateKey).toString("base64");
  await writeFile(signaturePath, `${signature}\n`, { mode: 0o644 });
  console.log(
    JSON.stringify({ manifestPath, signaturePath, signingKeyId: parsedManifest.signingKeyId }),
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
