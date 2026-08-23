import { createPrivateKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

async function main() {
  const input = process.env.SIGN_FILE_INPUT ?? process.argv[2];
  const output = process.env.SIGN_FILE_OUTPUT ?? process.argv[3] ?? `${input}.sig`;
  const privateKeyB64 = process.env.UPDATE_MANIFEST_PRIVATE_KEY_B64?.trim();
  if (!input || !privateKeyB64)
    throw new Error("SIGN_FILE_INPUT and UPDATE_MANIFEST_PRIVATE_KEY_B64 are required");
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw new Error("release signing key must be Ed25519");
  const signature = sign(null, await readFile(input), privateKey).toString("base64");
  await writeFile(output, `${signature}\n`, { mode: 0o644 });
  console.log(JSON.stringify({ input, output }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
