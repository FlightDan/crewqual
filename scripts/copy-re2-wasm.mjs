import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const distDir = process.env.CREWQUAL_DIST_DIR ?? ".next";
const source = resolve("node_modules/re2-wasm/build/wasm/re2.wasm");
const sourceStat = await stat(source);
if (!sourceStat.isFile() || sourceStat.size === 0) {
  throw new Error(`re2-wasm binary is missing or empty: ${source}`);
}

// re2-wasm's generated loader resolves re2.wasm relative to the bundled
// server chunk's __dirname. Next cannot infer that runtime file reference, so
// copy the verified package asset into both the normal server output and the
// standalone output after every production build.
const destinations = [
  resolve(join(distDir, "server/chunks/re2.wasm")),
  resolve(join(distDir, "standalone", distDir, "server/chunks/re2.wasm")),
];

for (const destination of destinations) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  const destinationStat = await stat(destination);
  if (destinationStat.size !== sourceStat.size) {
    throw new Error(`re2-wasm binary copy is incomplete: ${destination}`);
  }
}

console.log(`Copied re2.wasm (${sourceStat.size} bytes) into Next server outputs.`);
