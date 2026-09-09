import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import inventory from "../../docs/security/file-entry-inventory.json";

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : files(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

describe("file source and download entry inventory", () => {
  it("registers every upload parser, storage importer and direct object IO module", () => {
    const actual = {
      storageImporters: new Set<string>(),
      directObjectIo: new Set<string>(),
      binaryRequestReaders: new Set<string>(),
      csvParsers: new Set<string>(),
    };
    for (const file of [
      ...files(join(process.cwd(), "src/server")),
      ...files(join(process.cwd(), "src/app/api")),
      ...files(join(process.cwd(), "scripts")),
    ]) {
      const path = relative(process.cwd(), file);
      const tree = ts.createSourceFile(
        path,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const imported = node.moduleSpecifier.text;
          if (/(?:^@\/server|\/server)\/storage$/.test(imported)) actual.storageImporters.add(path);
          if (
            (imported === "@aws-sdk/client-s3" &&
              /\b(?:PutObjectCommand|CopyObjectCommand|GetObjectCommand)\b/.test(
                node.getText(tree),
              )) ||
            imported === "@aws-sdk/s3-request-presigner"
          )
            actual.directObjectIo.add(path);
        }
        if (ts.isCallExpression(node)) {
          if (
            ts.isPropertyAccessExpression(node.expression) &&
            ["formData", "arrayBuffer", "blob"].includes(node.expression.name.text)
          )
            actual.binaryRequestReaders.add(path);
          if (ts.isIdentifier(node.expression) && node.expression.text === "parsePilotCsv")
            actual.csvParsers.add(path);
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
    for (const kind of Object.keys(actual) as Array<keyof typeof actual>) {
      expect(
        [...actual[kind]].sort(),
        `${kind}: classify new file entries and their source gate`,
      ).toEqual([...inventory[kind]].sort());
    }
    for (const entry of inventory.entries) expect(existsSync(entry.path), entry.path).toBe(true);
    const listed = new Set(inventory.entries.map((entry) => entry.path));
    for (const paths of Object.values(actual))
      for (const path of paths) expect(listed.has(path), path).toBe(true);
  });
});
