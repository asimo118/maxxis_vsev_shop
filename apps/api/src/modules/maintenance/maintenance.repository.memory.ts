import { randomUUID } from "node:crypto";
import type { MemoryStore } from "../../platform/memory-store";
import type { MaintenanceRepository, MileageRecord } from "./maintenance.repository";

export function createMemoryMaintenanceRepository(store: MemoryStore): MaintenanceRepository {
  return {
    async createProfile(orderId, userId) {
      if (store.profiles.some((p) => p.orderId === orderId)) return false;
      store.profiles.push({ orderId, userId, rotationIntervalKm: 10_000, createdAt: new Date() });
      return true;
    },
    async findProfileByUser(userId) {
      const mine = store.profiles
        .filter((p) => p.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return mine[0] ? { ...mine[0] } : null;
    },
    async addMileage(userId, odometerKm) {
      const entry: MileageRecord = { id: randomUUID(), userId, odometerKm, recordedAt: new Date() };
      store.mileage.push(entry);
      return { ...entry };
    },
    async latestMileage(userId) {
      const mine = store.mileage
        .filter((m) => m.userId === userId)
        .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime() || b.odometerKm - a.odometerKm);
      return mine[0] ? { ...mine[0] } : null;
    },
    async listMileage(userId, limit) {
      return store.mileage
        .filter((m) => m.userId === userId)
        .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime() || b.odometerKm - a.odometerKm)
        .slice(0, limit)
        .map((m) => ({ ...m }));
    }
  };
}
