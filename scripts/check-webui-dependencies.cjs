#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const platform = process.platform;
const arch = process.arch;

function linuxLibc() {
  if (platform !== "linux") return undefined;

  try {
    const report = process.report?.getReport();
    return report?.header?.glibcVersionRuntime ? "gnu" : "musl";
  } catch {
    return "gnu";
  }
}

function swcTarget() {
  if (platform === "win32" && (arch === "x64" || arch === "arm64")) {
    return {
      packageName: `@next/swc-win32-${arch}-msvc`,
      binaryName: `next-swc.win32-${arch}-msvc.node`,
    };
  }

  if (platform === "linux" && (arch === "x64" || arch === "arm64")) {
    const libc = linuxLibc();
    return {
      packageName: `@next/swc-linux-${arch}-${libc}`,
      binaryName: `next-swc.linux-${arch}-${libc}.node`,
    };
  }

  if (platform === "darwin" && (arch === "x64" || arch === "arm64")) {
    return {
      packageName: `@next/swc-darwin-${arch}`,
      binaryName: `next-swc.darwin-${arch}.node`,
    };
  }

  return undefined;
}

const nextEntry = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const target = swcTarget();
const missing = [];

if (!fs.existsSync(nextEntry)) {
  missing.push("Next.js");
}

if (target) {
  const packageDirectory = path.join(projectRoot, "node_modules", ...target.packageName.split("/"));
  const packageManifest = path.join(packageDirectory, "package.json");
  const nativeBinary = path.join(packageDirectory, target.binaryName);

  if (!fs.existsSync(packageManifest) || !fs.existsSync(nativeBinary)) {
    missing.push(target.packageName);
  } else {
    try {
      require(nativeBinary);
    } catch {
      missing.push(`${target.packageName} (native binary cannot be loaded)`);
    }
  }
}

if (missing.length > 0) {
  console.error(
    `[ERROR] Dependencies for ${platform}/${arch} are incomplete: ${missing.join(", ")}.`,
  );
  console.error("        node_modules may have been installed on another operating system.");
  process.exit(1);
}
