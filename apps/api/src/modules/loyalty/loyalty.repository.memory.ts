import { randomUUID } from "node:crypto";
import type { MemoryStore } from "../../platform/memory-store";
import type { LoyaltyRepository, PointsEntryRecord } from "./loyalty.repository";

export function createMemoryLoyaltyRepository(store: MemoryStore): LoyaltyRepository {
  return {
    async addEntry(entry) {
      if (entry.refId !== null && store.points.some((p) => p.reason === entry.reason && p.refId === entry.refId)) {
        return null;
      }
      const record: PointsEntryRecord = { ...entry, id: randomUUID(), createdAt: new Date() };
      store.points.push(record);
      return { ...record };
    },
    async balance(userId) {
      return store.points.filter((p) => p.userId === userId).reduce((sum, p) => sum + p.delta, 0);
    },
    async listEntries(userId, limit) {
      return store.points
        .filter((p) => p.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map((p) => ({ ...p }));
    },
    async findCode(userId) {
      return store.referralCodes.get(userId) ?? null;
    },
    async findUserByCode(code) {
      for (const [userId, existing] of store.referralCodes) if (existing === code) return userId;
      return null;
    },
    async createCode(userId, code) {
      if (store.referralCodes.has(userId)) return false;
      for (const existing of store.referralCodes.values()) if (existing === code) return false;
      store.referralCodes.set(userId, code);
      return true;
    }
  };
}
