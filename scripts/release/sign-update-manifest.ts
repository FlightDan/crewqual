import { createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

/**
 * Sign the exact bytes emitted by update-manifest.ts. The private key is only
 * accepted through the CI secret and is never written to the repository.
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
  const manifest = await readFile(manifestPath);
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const signature = sign(null, manifest, privateKey).toString("base64");
  await writeFile(signaturePath, `${signature}\n`, { mode: 0o644 });
  console.log(JSON.stringify({ manifestPath, signaturePath }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
