import { randomUUID } from "node:crypto";
import { nowIso, toDate, type SqliteDb } from "../../platform/sqlite";
import type { MaintenanceProfileRecord, MaintenanceRepository, MileageRecord } from "./maintenance.repository";

interface MileageRow {
  id: string;
  user_id: string;
  odometer_km: number;
  recorded_at: string;
}
interface ProfileRow {
  order_id: string;
  user_id: string;
  rotation_interval_km: number;
  created_at: string;
}

const toMileage = (r: MileageRow): MileageRecord => ({
  id: r.id,
  userId: r.user_id,
  odometerKm: r.odometer_km,
  recordedAt: toDate(r.recorded_at)
});
const toProfile = (r: ProfileRow): MaintenanceProfileRecord => ({
  orderId: r.order_id,
  userId: r.user_id,
  rotationIntervalKm: r.rotation_interval_km,
  createdAt: toDate(r.created_at)
});

export function createSqliteMaintenanceRepository(db: SqliteDb): MaintenanceRepository {
  const createProfile = db.prepare<[string, string, string]>(
    "INSERT OR IGNORE INTO maintenance_profiles (order_id, user_id, created_at) VALUES (?, ?, ?)"
  );
  const profileByUser = db.prepare<[string], ProfileRow>(
    "SELECT * FROM maintenance_profiles WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
  );
  const addMileage = db.prepare<[string, string, number, string], MileageRow>(
    "INSERT INTO mileage_entries (id, user_id, odometer_km, recorded_at) VALUES (?, ?, ?, ?) RETURNING *"
  );
  const list = db.prepare<[string, number], MileageRow>(
    `SELECT * FROM mileage_entries WHERE user_id = ?
     ORDER BY recorded_at DESC, odometer_km DESC, rowid DESC LIMIT ?`
  );

  return {
    async createProfile(orderId, userId) {
      return createProfile.run(orderId, userId, nowIso()).changes === 1;
    },
    async findProfileByUser(userId) {
      const row = profileByUser.get(userId);
      return row ? toProfile(row) : null;
    },
    async addMileage(userId, odometerKm) {
      const row = addMileage.get(randomUUID(), userId, odometerKm, nowIso());
      if (!row) throw new Error("insert mileage_entries returned no row");
      return toMileage(row);
    },
    async latestMileage(userId) {
      const row = list.get(userId, 1);
      return row ? toMileage(row) : null;
    },
    async listMileage(userId, limit) {
      return list.all(userId, limit).map(toMileage);
    }
  };
}
