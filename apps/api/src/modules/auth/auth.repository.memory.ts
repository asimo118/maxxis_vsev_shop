import { randomUUID } from "node:crypto";
import type { MemoryStore } from "../../platform/memory-store";
import type { AdminRecord, AuthRepository, SessionRecord, UserRecord } from "./auth.repository";

export function createMemoryAuthRepository(store: MemoryStore): AuthRepository {
  return {
    async findUserByEmail(email) {
      return store.users.find((u) => u.email === email) ?? null;
    },
    async findUserById(id) {
      return store.users.find((u) => u.id === id) ?? null;
    },
    async findUsersByIds(ids) {
      return store.users.filter((u) => ids.includes(u.id));
    },
    async searchUsers(query) {
      const q = query.toLowerCase();
      return store.users
        .filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
        .slice(0, 50);
    },
    async createUser(input) {
      const user: UserRecord = { id: randomUUID(), createdAt: new Date(), passwordChangedAt: null, ...input };
      store.users.push(user);
      return user;
    },
    async findAdminByEmail(email) {
      return store.admins.find((a) => a.email === email) ?? null;
    },
    async findAdminById(id) {
      return store.admins.find((a) => a.id === id) ?? null;
    },
    async upsertAdmin(input) {
      const existing = store.admins.find((a) => a.email === input.email);
      if (existing) {
        Object.assign(existing, input, { active: true });
        return existing;
      }
      const admin: AdminRecord = { id: randomUUID(), active: true, createdAt: new Date(), passwordChangedAt: null, ...input };
      store.admins.push(admin);
      return admin;
    },
    async listAdmins() {
      return [...store.admins].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async createAdmin(input) {
      const admin: AdminRecord = { id: randomUUID(), active: true, createdAt: new Date(), passwordChangedAt: null, ...input };
      store.admins.push(admin);
      return admin;
    },
    async updateAdmin(id, patch) {
      const admin = store.admins.find((a) => a.id === id);
      if (!admin) return null;
      Object.assign(admin, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
      return admin;
    },
    async setUserPassword(id, passwordHash, at) {
      const user = store.users.find((u) => u.id === id);
      if (user) Object.assign(user, { passwordHash, passwordChangedAt: at });
    },
    async createSession(session) {
      store.sessions.push({ ...session, revokedAt: null });
    },
    async findSession(id) {
      return store.sessions.find((s) => s.id === id) ?? null;
    },
    async revokeSession(id, at) {
      const session = store.sessions.find((s) => s.id === id);
      if (session && !session.revokedAt) session.revokedAt = at;
    },
    async revokeSessions(audience, subjectId, at, exceptId) {
      const open = store.sessions.filter(
        (s) => s.audience === audience && s.subjectId === subjectId && !s.revokedAt && s.id !== exceptId
      );
      for (const s of open) s.revokedAt = at;
      return open.length;
    },
    async deleteExpiredSessions(before) {
      const keep: SessionRecord[] = store.sessions.filter((s) => s.expiresAt >= before);
      const removed = store.sessions.length - keep.length;
      store.sessions.splice(0, store.sessions.length, ...keep);
      return removed;
    },
    async lastSessionAt(audience) {
      const last = new Map<string, Date>();
      for (const s of store.sessions) {
        const prev = last.get(s.subjectId);
        if (s.audience === audience && (!prev || s.createdAt > prev)) last.set(s.subjectId, s.createdAt);
      }
      return last;
    }
  };
}
