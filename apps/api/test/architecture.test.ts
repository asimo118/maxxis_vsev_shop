import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "src", "modules");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
const all = files(root);

describe("module boundaries", () => {
  it("never imports another module's repository", () => {
    for (const f of all) {
      const mod = f.slice(root.length + 1).split("/")[0];
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/from "\.\.\/(\w[\w-]*)\/[\w.-]*repository[\w.-]*"/g)) {
        expect(m[1], `${f} imports ${m[0]}`).toBe(mod);
      }
    }
  });
  it("order never imports notification, loyalty-internals or maintenance", () => {
    for (const f of all.filter((p) => p.includes("/order/"))) {
      expect(readFileSync(f, "utf8")).not.toMatch(/\.\.\/(notification|maintenance)\//);
    }
  });
  it("only *.repository.sqlite.ts files touch the database", () => {
    for (const f of all.filter((p) => !p.endsWith(".repository.sqlite.ts"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/platform\/sqlite|better-sqlite3/);
    }
  });
  it("modules never import the connectors layer (adapters depend on modules, not the reverse)", () => {
    for (const f of all) expect(readFileSync(f, "utf8"), f).not.toMatch(/from "\.\.\/\.\.\/connectors\//);
  });
  it("uses no default exports", () => {
    for (const f of all) expect(readFileSync(f, "utf8"), f).not.toMatch(/export default/);
  });
});
