import { randomUUID } from "node:crypto";
import type { AdminRole } from "@vsev/shared";
import { likeContains, nowIso, placeholders, toBool, toDate, type SqliteDb } from "../../platform/sqlite";
import type { AdminRecord, AuthRepository, UserRecord } from "./auth.repository";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  phone: string | null;
  created_at: string;
}
interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: AdminRole;
  active: number;
}

const toUser = (r: UserRow): UserRecord => ({
  id: r.id,
  email: r.email,
  passwordHash: r.password_hash,
  name: r.name,
  phone: r.phone,
  createdAt: toDate(r.created_at)
});
const toAdmin = (r: AdminRow): AdminRecord => ({
  id: r.id,
  email: r.email,
  passwordHash: r.password_hash,
  name: r.name,
  role: r.role,
  active: toBool(r.active)
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
     ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name, role = excluded.role
     RETURNING *`
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
    }
  };
}
