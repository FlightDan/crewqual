import { readFile } from "node:fs/promises";
import { parseKeyring, parseKeyringJSON, sameKeyring } from "./keyring-utils.js";

const sourcePath = "security/update-manifest-keyring.json";

async function main() {
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const updater = JSON.parse(await readFile("updater/keyring.json", "utf8"));
  const sourceKeyring = parseKeyring(source, {
    requireActive: process.env.RELEASE_REQUIRE_ACTIVE_KEY === "1",
  });
  const updaterKeyring = parseKeyring(updater, {
    requireActive: process.env.RELEASE_REQUIRE_ACTIVE_KEY === "1",
  });
  if (!sameKeyring(sourceKeyring, updaterKeyring))
    throw new Error("security/update-manifest-keyring.json and updater/keyring.json drifted");
  const installer = await readFile("install.sh", "utf8");
  const match = installer.match(/BUILTIN_UPDATE_KEYRING_JSON='([^']+)'/);
  if (!match) throw new Error("install.sh does not contain the embedded update keyring");
  const embeddedKeyring = parseKeyringJSON(match[1], {
    requireActive: process.env.RELEASE_REQUIRE_ACTIVE_KEY === "1",
  });
  if (!sameKeyring(embeddedKeyring, sourceKeyring))
    throw new Error("install.sh embedded update keyring drifted");
  console.log(
    JSON.stringify({
      keyCount: sourceKeyring.keys.length,
      activeKeyId: sourceKeyring.keys.find((key) => key.status === "active")?.id ?? null,
      nextKeyId: sourceKeyring.keys.find((key) => key.status === "next")?.id ?? null,
      status: "aligned",
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
