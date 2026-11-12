export interface MileageRecord {
  id: string;
  userId: string;
  odometerKm: number;
  recordedAt: Date;
}

export interface MaintenanceProfileRecord {
  orderId: string;
  userId: string;
  rotationIntervalKm: number;
  createdAt: Date;
}

export interface MaintenanceRepository {
  /** Idempotent per order. Returns false if the profile already existed. */
  createProfile(orderId: string, userId: string): Promise<boolean>;
  findProfileByUser(userId: string): Promise<MaintenanceProfileRecord | null>;
  addMileage(userId: string, odometerKm: number): Promise<MileageRecord>;
  latestMileage(userId: string): Promise<MileageRecord | null>;
  listMileage(userId: string, limit: number): Promise<MileageRecord[]>;
}
