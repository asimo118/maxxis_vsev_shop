import type { ExternalVehicleModel, UserVehicleDto, VehicleModelDto } from "@vsev/shared";
import { errors } from "../../platform/errors";
import type { VehicleModelRecord, VehicleRepository } from "./vehicle.repository";

const toDto = (m: VehicleModelRecord): VehicleModelDto => ({ id: m.id, label: m.label });

export class VehicleService {
  constructor(private readonly repo: VehicleRepository) {}

  async listModels(): Promise<VehicleModelDto[]> {
    return (await this.repo.listModels()).map(toDto);
  }

  async listModelsByIds(ids: string[]): Promise<VehicleModelDto[]> {
    if (ids.length === 0) return [];
    const found = await this.repo.findModelsByIds(ids);
    // keep the caller's order (campaign-defined)
    return ids.flatMap((id) => found.filter((m) => m.id === id && m.active).map(toDto));
  }

  /** The campaign's eligibility rule: the chosen model must be in the campaign's allow-list. */
  async resolveEligibleModel(eligibleIds: string[], modelId: string): Promise<VehicleModelDto> {
    if (!eligibleIds.includes(modelId)) throw errors.vehicleNotEligible();
    const [model] = await this.repo.findModelsByIds([modelId]);
    if (!model || !model.active) throw errors.vehicleNotEligible();
    return toDto(model);
  }

  /** Called at checkout: the plate + model become the first CRM record for this owner. */
  async registerForOrder(userId: string, modelId: string, plate: string): Promise<void> {
    await this.repo.upsertUserVehicle(userId, modelId, plate);
  }

  async listMine(userId: string): Promise<UserVehicleDto[]> {
    const vehicles = await this.repo.listUserVehicles(userId);
    const models = await this.repo.findModelsByIds([...new Set(vehicles.map((v) => v.modelId))]);
    return vehicles.map((v) => ({
      id: v.id,
      plate: v.plate,
      modelId: v.modelId,
      modelLabel: models.find((m) => m.id === v.modelId)?.label ?? v.modelId
    }));
  }

  async upsertModels(models: readonly { id: string; label: string }[]): Promise<void> {
    for (const model of models) await this.repo.upsertModel(model);
  }

  /**
   * Mirror the external vehicle-model feed into the local table. Models missing upstream are
   * deactivated (never deleted — orders and owner vehicles still reference them).
   * An empty feed is refused: it is far more likely an upstream bug than "we sell to no cars".
   */
  async syncFromFeed(feed: readonly ExternalVehicleModel[]): Promise<{ upserted: number; deactivated: number }> {
    if (feed.length === 0) throw new Error("vehicle feed returned no models; refusing to deactivate every model");
    const seen = new Set(feed.map((m) => m.id));
    for (const m of feed) await this.repo.upsertModel({ id: m.id, label: m.label, active: m.active });
    let deactivated = 0;
    for (const m of await this.repo.listAllModels()) {
      if (!seen.has(m.id) && m.active) {
        await this.repo.upsertModel({ id: m.id, label: m.label, active: false });
        deactivated += 1;
      }
    }
    return { upserted: feed.length, deactivated };
  }
}
