import { randomUUID } from "node:crypto";
import type { MemoryStore } from "../../platform/memory-store";
import type { AdminRecord, AuthRepository, UserRecord } from "./auth.repository";

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
      const user: UserRecord = { id: randomUUID(), createdAt: new Date(), ...input };
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
        Object.assign(existing, input);
        return existing;
      }
      const admin: AdminRecord = { id: randomUUID(), active: true, ...input };
      store.admins.push(admin);
      return admin;
    }
  };
}
