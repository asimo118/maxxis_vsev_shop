import type { AdminRole } from "@vsev/shared";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  phone: string | null;
  createdAt: Date;
}

export interface AdminRecord {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: AdminRole;
  active: boolean;
}

/** Port. Implemented by auth.repository.sqlite.ts (production) and auth.repository.memory.ts (tests/demo). */
export interface AuthRepository {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  findUsersByIds(ids: string[]): Promise<UserRecord[]>;
  /** Case-insensitive substring match on name or email (admin order search). Capped at 50. */
  searchUsers(query: string): Promise<UserRecord[]>;
  createUser(input: { email: string; passwordHash: string; name: string; phone: string | null }): Promise<UserRecord>;
  findAdminByEmail(email: string): Promise<AdminRecord | null>;
  findAdminById(id: string): Promise<AdminRecord | null>;
  upsertAdmin(input: { email: string; passwordHash: string; name: string; role: AdminRole }): Promise<AdminRecord>;
}
