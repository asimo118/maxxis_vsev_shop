import { randomUUID } from "node:crypto";
import type { AdminRole } from "@vsev/shared";
import { fromBool, likeContains, nowIso, placeholders, toBool, toDate, type SqliteDb } from "../../platform/sqlite";
import type { TokenAudience } from "../../platform/tokens";
import type { AdminPatch, AdminRecord, AuthRepository, SessionRecord, UserRecord } from "./auth.repository";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  phone: string | null;
  created_at: string;
  password_changed_at: string | null;
}
interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: AdminRole;
  active: number;
  created_at: string;
  password_changed_at: string | null;
}
interface SessionRow {
  id: string;
  audience: TokenAudience;
  subject_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

/** AdminPatch field → column. Only these columns can ever be written by updateAdmin (no dynamic names). */
const ADMIN_PATCH_COLUMNS = {
  name: "name",
  role: "role",
  active: "active",
  passwordHash: "password_hash",
  passwordChangedAt: "password_changed_at"
} as const satisfies Record<keyof AdminPatch, string>;

const optDate = (v: string | null): Date | null => (v ? toDate(v) : null);

const toUser = (r: UserRow): UserRecord => ({
  id: r.id,
  email: r.email,
  passwordHash: r.password_hash,
  name: r.name,
  phone: r.phone,
  createdAt: toDate(r.created_at),
  passwordChangedAt: optDate(r.password_changed_at)
});
const toAdmin = (r: AdminRow): AdminRecord => ({
  id: r.id,
  email: r.email,
  passwordHash: r.password_hash,
  name: r.name,
  role: r.role,
  active: toBool(r.active),
  createdAt: toDate(r.created_at),
  passwordChangedAt: optDate(r.password_changed_at)
});
const toSession = (r: SessionRow): SessionRecord => ({
  id: r.id,
  audience: r.audience,
  subjectId: r.subject_id,
  createdAt: toDate(r.created_at),
  expiresAt: toDate(r.expires_at),
  revokedAt: optDate(r.revoked_at)
});

export function createSqliteAuthRepository(db: SqliteDb): AuthRepository {
  const userByEmail = db.prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?");
  const userById = db.prepare<[string], UserRow>("SELECT * FROM users WHERE id = ?");
  const searchUsers = db.prepare<[string, string], UserRow>(
    "SELECT * FROM users WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 50"
  );
  const insertUser = db.prepare<[string, string, string, string, string | null, string], UserRow>(
    "INSERT INTO users (id, email, password_hash, name, phone, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *"
  );
  const adminByEmail = db.prepare<[string], AdminRow>("SELECT * FROM admin_users WHERE email = ?");
  const adminById = db.prepare<[string], AdminRow>("SELECT * FROM admin_users WHERE id = ?");
  const upsertAdmin = db.prepare<[string, string, string, string, AdminRole, string], AdminRow>(
    `INSERT INTO admin_users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name, role = excluded.role, active = 1
     RETURNING *`
  );
  const listAdmins = db.prepare<[], AdminRow>("SELECT * FROM admin_users ORDER BY created_at, rowid");
  const insertAdmin = db.prepare<[string, string, string, string, AdminRole, string], AdminRow>(
    "INSERT INTO admin_users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *"
  );
  const setUserPassword = db.prepare<[string, string, string]>(
    "UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?"
  );
  const insertSession = db.prepare<[string, TokenAudience, string, string, string]>(
    "INSERT INTO auth_sessions (id, audience, subject_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
  );
  const sessionById = db.prepare<[string], SessionRow>("SELECT * FROM auth_sessions WHERE id = ?");
  const revokeSession = db.prepare<[string, string]>(
    "UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL"
  );
  const revokeSessions = db.prepare<[string, TokenAudience, string, string]>(
    "UPDATE auth_sessions SET revoked_at = ? WHERE audience = ? AND subject_id = ? AND id <> ? AND revoked_at IS NULL"
  );
  const deleteExpired = db.prepare<[string]>("DELETE FROM auth_sessions WHERE expires_at < ?");
  const lastSessions = db.prepare<[TokenAudience], { subject_id: string; last: string }>(
    "SELECT subject_id, MAX(created_at) AS last FROM auth_sessions WHERE audience = ? GROUP BY subject_id"
  );

  return {
    async findUserByEmail(email) {
      const row = userByEmail.get(email);
      return row ? toUser(row) : null;
    },
    async findUserById(id) {
      const row = userById.get(id);
      return row ? toUser(row) : null;
    },
    async findUsersByIds(ids) {
      if (ids.length === 0) return [];
      return db
        .prepare<string[], UserRow>(`SELECT * FROM users WHERE id IN (${placeholders(ids.length)})`)
        .all(...ids)
        .map(toUser);
    },
    async searchUsers(query) {
      const pattern = likeContains(query);
      return searchUsers.all(pattern, pattern).map(toUser);
    },
    async createUser(input) {
      const row = insertUser.get(randomUUID(), input.email, input.passwordHash, input.name, input.phone, nowIso());
      if (!row) throw new Error("insert users returned no row");
      return toUser(row);
    },
    async findAdminByEmail(email) {
      const row = adminByEmail.get(email);
      return row ? toAdmin(row) : null;
    },
    async findAdminById(id) {
      const row = adminById.get(id);
      return row ? toAdmin(row) : null;
    },
    async upsertAdmin(input) {
      const row = upsertAdmin.get(randomUUID(), input.email, input.passwordHash, input.name, input.role, nowIso());
      if (!row) throw new Error("upsert admin_users returned no row");
      return toAdmin(row);
    },
    async listAdmins() {
      return listAdmins.all().map(toAdmin);
    },
    async createAdmin(input) {
      const row = insertAdmin.get(randomUUID(), input.email, input.passwordHash, input.name, input.role, nowIso());
      if (!row) throw new Error("insert admin_users returned no row");
      return toAdmin(row);
    },
    async updateAdmin(id, patch) {
      const sets: string[] = [];
      const values: (string | number)[] = [];
      for (const key of Object.keys(ADMIN_PATCH_COLUMNS) as (keyof AdminPatch)[]) {
        const value = patch[key];
        if (value === undefined) continue;
        sets.push(`${ADMIN_PATCH_COLUMNS[key]} = ?`);
        values.push(typeof value === "boolean" ? fromBool(value) : value instanceof Date ? value.toISOString() : value);
      }
      if (sets.length > 0) db.prepare(`UPDATE admin_users SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
      const row = adminById.get(id);
      return row ? toAdmin(row) : null;
    },
    async setUserPassword(id, passwordHash, at) {
      setUserPassword.run(passwordHash, at.toISOString(), id);
    },
    async createSession(session) {
      insertSession.run(session.id, session.audience, session.subjectId, session.createdAt.toISOString(), session.expiresAt.toISOString());
    },
    async findSession(id) {
      const row = sessionById.get(id);
      return row ? toSession(row) : null;
    },
    async revokeSession(id, at) {
      revokeSession.run(at.toISOString(), id);
    },
    async revokeSessions(audience, subjectId, at, exceptId) {
      return revokeSessions.run(at.toISOString(), audience, subjectId, exceptId ?? "").changes;
    },
    async deleteExpiredSessions(before) {
      return deleteExpired.run(before.toISOString()).changes;
    },
    async lastSessionAt(audience) {
      return new Map(lastSessions.all(audience).map((r) => [r.subject_id, toDate(r.last)]));
    }
  };
}
