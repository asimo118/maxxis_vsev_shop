import { randomUUID } from "node:crypto";
import type { MemoryStore } from "../../platform/memory-store";
import type { UserVehicleRecord, VehicleRepository } from "./vehicle.repository";

export function createMemoryVehicleRepository(store: MemoryStore): VehicleRepository {
  return {
    async listModels() {
      return store.models.filter((m) => m.active);
    },
    async listAllModels() {
      return store.models.map((m) => ({ ...m }));
    },
    async findModelsByIds(ids) {
      return store.models.filter((m) => ids.includes(m.id));
    },
    async upsertModel(model) {
      const existing = store.models.find((m) => m.id === model.id);
      const active = model.active ?? true;
      if (existing) {
        existing.label = model.label;
        existing.active = active;
      } else store.models.push({ id: model.id, label: model.label, active });
    },
    async upsertUserVehicle(userId, modelId, plate) {
      const existing = store.userVehicles.find((v) => v.userId === userId && v.plate === plate);
      if (existing) {
        existing.modelId = modelId;
        return existing;
      }
      const vehicle: UserVehicleRecord = { id: randomUUID(), userId, modelId, plate, createdAt: new Date() };
      store.userVehicles.push(vehicle);
      return vehicle;
    },
    async listUserVehicles(userId) {
      return store.userVehicles.filter((v) => v.userId === userId);
    },
    async countUserVehiclesByModel() {
      const counts: Record<string, number> = {};
      for (const v of store.userVehicles) counts[v.modelId] = (counts[v.modelId] ?? 0) + 1;
      return counts;
    }
  };
}
