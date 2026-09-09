import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  ACCESS_ROUTE_INVENTORY,
  findAccessRoute,
  isAccessMethodAllowed,
} from "./access-control-inventory";

const apiRoot = path.resolve(process.cwd(), "src/app/api");
const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(directory, entry.name);
    return entry.isDirectory() ? files(name) : entry.name === "route.ts" ? [name] : [];
  });
}
function parse(source: string) {
  return ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function exportedMethods(source: string) {
  const names: string[] = [];
  for (const node of parse(source).statements) {
    if (ts.isExportDeclaration(node)) {
      // A wildcard could silently introduce HTTP methods; route exports must be explicit.
      if (!node.exportClause || !ts.isNamedExports(node.exportClause))
        throw new Error("Route wildcard exports are not reviewable");
      names.push(...node.exportClause.elements.map((element) => element.name.text));
    } else if (
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      if (ts.isFunctionDeclaration(node) && node.name) names.push(node.name.text);
      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
        }
      }
    }
  }
  return [...new Set(names.filter((name) => httpMethods.has(name)))].sort();
}

describe("reviewed subject/object API inventory", () => {
  it("requires every route and exported method to be explicitly registered", () => {
    const actual = files(apiRoot)
      .map((file) => ({
        route: `/api/${path
          .relative(apiRoot, file)
          .replaceAll(path.sep, "/")
          .replace(/\/?route\.ts$/, "")}`.replace(/\/$/, ""),
        methods: exportedMethods(readFileSync(file, "utf8")),
      }))
      .sort((a, b) => a.route.localeCompare(b.route));
    const registered = ACCESS_ROUTE_INVENTORY.map((entry) => ({
      route: entry.route,
      methods: [...entry.methods].sort(),
    })).sort((a, b) => a.route.localeCompare(b.route));
    expect(registered).toEqual(actual);
    expect(new Set(registered.map((entry) => entry.route)).size).toBe(registered.length);
    for (const entry of ACCESS_ROUTE_INVENTORY) {
      expect(entry.subject).toBeTruthy();
      expect(entry.object).toBeTruthy();
      expect(entry.scope).toBeTruthy();
      expect(Object.keys(entry.actions).sort(), entry.route).toEqual([...entry.methods].sort());
    }
  });

  it("discovers declarations, handler constants and alias exports without treating comments as methods", () => {
    expect(
      exportedMethods(`// export async function DELETE() {}
      export async function GET() {}
      export const POST = handler;
      export { update as PATCH } from './other';
      export const runtime = 'nodejs';`),
    ).toEqual(["GET", "PATCH", "POST"]);
    expect(() => exportedMethods("export * from './other';")).toThrow();
  });

  it("keeps member aliases delegated to the same pilot handler without local handlers", () => {
    for (const entry of ACCESS_ROUTE_INVENTORY.filter((item) =>
      item.route.startsWith("/api/member/"),
    )) {
      const file = path.join(apiRoot, entry.route.slice("/api/".length), "route.ts");
      const statements = parse(readFileSync(file, "utf8")).statements;
      expect(statements.length, entry.route).toBe(1);
      const declaration = statements[0];
      expect(ts.isExportDeclaration(declaration), entry.route).toBe(true);
      if (
        !ts.isExportDeclaration(declaration) ||
        !declaration.moduleSpecifier ||
        !ts.isStringLiteral(declaration.moduleSpecifier)
      )
        throw new Error(entry.route);
      expect(declaration.moduleSpecifier.text).toBe(
        `@/app${entry.route.replace("/api/member/", "/api/pilot/")}/route`,
      );
      const canonical = ACCESS_ROUTE_INVENTORY.find(
        (item) => item.route === entry.route.replace("/member/", "/pilot/"),
      );
      expect(canonical).toBeDefined();
      expect(entry.subject).toBe(canonical!.subject);
      expect(entry.scope).toBe(canonical!.scope);
      expect(entry.object).toBe(canonical!.object);
      for (const method of entry.methods) expect(canonical!.methods).toContain(method);
    }
  });

  it("matches literal routes before dynamic ones and rejects unregistered paths", () => {
    expect(findAccessRoute("/api/admin/pilots/export")?.route).toBe("/api/admin/pilots/export");
    expect(findAccessRoute("/api/admin/upgrade-plans/abc/reassign")?.route).toBe(
      "/api/admin/upgrade-plans/[id]/reassign",
    );
    expect(findAccessRoute("/api/member/qualifications/abc/")?.route).toBe(
      "/api/member/qualifications/[qualificationId]",
    );
    expect(findAccessRoute("/api/member/qualifications/abc/unknown")).toBeUndefined();
    expect(findAccessRoute("/api/member/qualifications//")).toBeUndefined();
    expect(findAccessRoute("/api/new-unregistered-route")).toBeUndefined();
    expect(findAccessRoute("/api/health?probe=1")).toBeUndefined();
  });

  it("allows only declared methods plus framework-provided HEAD and OPTIONS", () => {
    const health = findAccessRoute("/api/health")!;
    expect(isAccessMethodAllowed(health, "GET")).toBe(true);
    expect(isAccessMethodAllowed(health, "HEAD")).toBe(true);
    expect(isAccessMethodAllowed(health, "OPTIONS")).toBe(true);
    expect(isAccessMethodAllowed(health, "POST")).toBe(false);
    expect(isAccessMethodAllowed(findAccessRoute("/api/member/submissions")!, "HEAD")).toBe(false);
  });
});
