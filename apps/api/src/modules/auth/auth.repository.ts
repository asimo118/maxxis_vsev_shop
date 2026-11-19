import type { AdminRole } from "@vsev/shared";
import type { TokenAudience } from "../../platform/tokens";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  phone: string | null;
  createdAt: Date;
  passwordChangedAt: Date | null;
}

export interface AdminRecord {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: AdminRole;
  active: boolean;
  createdAt: Date;
  passwordChangedAt: Date | null;
}

/** One sign-in. A token is honoured only while its session is open: not revoked and not expired. */
export interface SessionRecord {
  id: string;
  audience: TokenAudience;
  subjectId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface AdminPatch {
  name?: string;
  role?: AdminRole;
  active?: boolean;
  passwordHash?: string;
  passwordChangedAt?: Date;
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
  /** Recovery / tests only: creates the admin or overwrites password, name and role, and re-activates it. */
  upsertAdmin(input: { email: string; passwordHash: string; name: string; role: AdminRole }): Promise<AdminRecord>;
  listAdmins(): Promise<AdminRecord[]>;
  /** Plain insert; the caller checks the email is free. */
  createAdmin(input: { email: string; passwordHash: string; name: string; role: AdminRole }): Promise<AdminRecord>;
  updateAdmin(id: string, patch: AdminPatch): Promise<AdminRecord | null>;
  setUserPassword(id: string, passwordHash: string, at: Date): Promise<void>;

  createSession(session: Omit<SessionRecord, "revokedAt">): Promise<void>;
  findSession(id: string): Promise<SessionRecord | null>;
  revokeSession(id: string, at: Date): Promise<void>;
  /** Revokes every open session of the subject except `exceptId`; returns how many were revoked. */
  revokeSessions(audience: TokenAudience, subjectId: string, at: Date, exceptId?: string): Promise<number>;
  /** Housekeeping: drops sessions that expired before `before`. */
  deleteExpiredSessions(before: Date): Promise<number>;
  /** Latest sign-in per subject of one audience. */
  lastSessionAt(audience: TokenAudience): Promise<Map<string, Date>>;
}
