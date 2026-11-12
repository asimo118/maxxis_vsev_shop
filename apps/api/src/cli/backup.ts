import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { loadConfig } from "../platform/config";

/**
 * `pnpm db:backup [dest]` — consistent online backup (SQLite backup API), safe while the API is running.
 * Copying the .db file with cp while the API writes can produce a corrupt copy; use this instead.
 */
const config = loadConfig();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dest = resolve(process.argv[2] ?? `./backups/vsev-${stamp}.db`);
mkdirSync(dirname(dest), { recursive: true });
const db = new Database(config.SQLITE_PATH, { readonly: true, fileMustExist: true });
await db.backup(dest);
db.close();
console.log(`backup written to ${dest}`);
