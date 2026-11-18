export interface VehicleModelRecord {
  id: string;
  label: string;
  active: boolean;
}

export interface UserVehicleRecord {
  id: string;
  userId: string;
  modelId: string;
  plate: string;
  createdAt: Date;
}

export interface VehicleRepository {
  /** Active models only. */
  listModels(): Promise<VehicleModelRecord[]>;
  /** Including inactive ones (used by connector sync to find models that disappeared upstream). */
  listAllModels(): Promise<VehicleModelRecord[]>;
  findModelsByIds(ids: string[]): Promise<VehicleModelRecord[]>;
  /** Insert or update; `active` defaults to true. */
  upsertModel(model: { id: string; label: string; active?: boolean }): Promise<void>;
  upsertUserVehicle(userId: string, modelId: string, plate: string): Promise<UserVehicleRecord>;
  listUserVehicles(userId: string): Promise<UserVehicleRecord[]>;
  /** Owner vehicles registered per model id (models with none are absent). */
  countUserVehiclesByModel(): Promise<Record<string, number>>;
}
