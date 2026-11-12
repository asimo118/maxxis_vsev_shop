import Database from "better-sqlite3";
import { loadConfig } from "../platform/config";
import { migrate } from "../platform/sqlite";

/** `pnpm db:migrate` — applies pending schema migrations. (The API also migrates on boot.) */
const config = loadConfig();
const db = new Database(config.SQLITE_PATH);
const { from, to } = migrate(db);
db.close();
console.log(from === to ? `schema already at v${to}` : `migrated schema v${from} → v${to}`);
