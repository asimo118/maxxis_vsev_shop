import { readFileSync } from "node:fs";
import { build } from "esbuild";

// Third-party dependencies stay external (installed with `pnpm install --prod`; better-sqlite3 is a native
// module and cannot be bundled). Workspace packages (@vsev/*) ship TypeScript source, so they ARE bundled.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies).filter((name) => !name.startsWith("@vsev/"));

await build({
  entryPoints: { server: "src/server.ts", migrate: "src/cli/migrate.ts", seed: "src/cli/seed.ts", backup: "src/cli/backup.ts", "admin-reset": "src/cli/admin-reset.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external
});
console.log("api built → dist/{server,migrate,seed,backup,admin-reset}.mjs");
