import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./sqlite.migrations";

/**
 * The only place a database connection is created. Imported by *.repository.sqlite.ts files,
 * the SQLite queue driver and the composition root.
 *
 * better-sqlite3 is synchronous: each statement completes before the next line runs, so a
 * `db.transaction()` is atomic with respect to every other request in this process.
 * SQLite allows ONE writer process — run a single API instance against a given file.
 */
export type SqliteDb = Database.Database;

export function openSqlite(path: string): SqliteDb {
  if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL"); // readers never block the writer
  db.pragma("synchronous = NORMAL"); // durable across app crashes; safe default with WAL
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

/** Applies pending migrations in order, each in its own transaction. Returns the versions before/after. */
export function migrate(db: SqliteDb): { from: number; to: number } {
  const from = Number(db.pragma("user_version", { simple: true }));
  if (from > MIGRATIONS.length) {
    throw new Error(`database schema v${from} is newer than this build (v${MIGRATIONS.length}); refusing to start`);
  }
  for (let v = from; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v] ?? "";
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return { from, to: MIGRATIONS.length };
}

/* ───────────── helpers shared by the SQLite repositories ───────────── */

export const nowIso = (): string => new Date().toISOString();
export const toDate = (iso: string): Date => new Date(iso);
export const toBool = (v: number): boolean => v === 1;
export const fromBool = (v: boolean): number => (v ? 1 : 0);

/** Escapes LIKE wildcards so user input is matched literally. Use with `LIKE ? ESCAPE '\\'`. */
export function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** `?, ?, ?` for an IN (...) list. Callers must handle the empty list themselves. */
export const placeholders = (n: number): string => Array.from({ length: n }, () => "?").join(", ");
