import { randomUUID } from "node:crypto";
import { nowIso, placeholders, toBool, toDate, type SqliteDb } from "../../platform/sqlite";
import type { UserVehicleRecord, VehicleModelRecord, VehicleRepository } from "./vehicle.repository";

interface ModelRow {
  id: string;
  label: string;
  active: number;
}
interface UserVehicleRow {
  id: string;
  user_id: string;
  model_id: string;
  plate: string;
  created_at: string;
}

const toModel = (r: ModelRow): VehicleModelRecord => ({ id: r.id, label: r.label, active: toBool(r.active) });
const toUserVehicle = (r: UserVehicleRow): UserVehicleRecord => ({
  id: r.id,
  userId: r.user_id,
  modelId: r.model_id,
  plate: r.plate,
  createdAt: toDate(r.created_at)
});

export function createSqliteVehicleRepository(db: SqliteDb): VehicleRepository {
  const listModels = db.prepare<[], ModelRow>("SELECT * FROM vehicle_models WHERE active = 1 ORDER BY rowid");
  const listAllModels = db.prepare<[], ModelRow>("SELECT * FROM vehicle_models ORDER BY rowid");
  const upsertModel = db.prepare<[string, string, number]>(
    `INSERT INTO vehicle_models (id, label, active) VALUES (?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET label = excluded.label, active = excluded.active`
  );
  const upsertUserVehicle = db.prepare<[string, string, string, string, string], UserVehicleRow>(
    `INSERT INTO user_vehicles (id, user_id, model_id, plate, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, plate) DO UPDATE SET model_id = excluded.model_id
     RETURNING *`
  );
  const listUserVehicles = db.prepare<[string], UserVehicleRow>(
    "SELECT * FROM user_vehicles WHERE user_id = ? ORDER BY created_at, rowid"
  );
  const countByModel = db.prepare<[], { model_id: string; n: number }>(
    "SELECT model_id, COUNT(*) AS n FROM user_vehicles GROUP BY model_id"
  );

  return {
    async listModels() {
      return listModels.all().map(toModel);
    },
    async listAllModels() {
      return listAllModels.all().map(toModel);
    },
    async findModelsByIds(ids) {
      if (ids.length === 0) return [];
      return db
        .prepare<string[], ModelRow>(`SELECT * FROM vehicle_models WHERE id IN (${placeholders(ids.length)})`)
        .all(...ids)
        .map(toModel);
    },
    async upsertModel(model) {
      upsertModel.run(model.id, model.label, (model.active ?? true) ? 1 : 0);
    },
    async upsertUserVehicle(userId, modelId, plate) {
      const row = upsertUserVehicle.get(randomUUID(), userId, modelId, plate, nowIso());
      if (!row) throw new Error("upsert user_vehicles returned no row");
      return toUserVehicle(row);
    },
    async listUserVehicles(userId) {
      return listUserVehicles.all(userId).map(toUserVehicle);
    },
    async countUserVehiclesByModel() {
      return Object.fromEntries(countByModel.all().map((r) => [r.model_id, r.n]));
    }
  };
}
