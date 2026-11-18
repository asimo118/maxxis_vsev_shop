import type {
  AdminVehicleModelDto,
  ExternalVehicleModel,
  UserVehicleDto,
  VehicleModelCreateBody,
  VehicleModelDto,
  VehicleModelUpdateBody
} from "@vsev/shared";
import { errors } from "../../platform/errors";
import type { EventBus } from "../../platform/events";
import type { VehicleModelRecord, VehicleRepository } from "./vehicle.repository";

const toDto = (m: VehicleModelRecord): VehicleModelDto => ({ id: m.id, label: m.label });

export class VehicleService {
  constructor(
    private readonly repo: VehicleRepository,
    private readonly opts: {
      events: EventBus;
      /** True when the vehicle-model connector is in "http" mode: models are edited in the source system. */
      managedExternally?: boolean;
    }
  ) {}

  get managedExternally(): boolean {
    return this.opts.managedExternally ?? false;
  }

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

  /* ───── admin ───── */

  /** Every model, including inactive ones, with how many owner vehicles reference it. */
  async listAdmin(): Promise<AdminVehicleModelDto[]> {
    const [models, counts] = await Promise.all([this.repo.listAllModels(), this.repo.countUserVehiclesByModel()]);
    return models.map((m) => ({ ...toDto(m), active: m.active, ownerVehicles: counts[m.id] ?? 0 }));
  }

  /** Ids from `ids` that exist, active or not (campaign allow-lists may keep a deactivated model). */
  async knownIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    return new Set((await this.repo.findModelsByIds([...new Set(ids)])).map((m) => m.id));
  }

  async create(body: VehicleModelCreateBody): Promise<AdminVehicleModelDto> {
    if (this.managedExternally) throw errors.managedExternally("車型資料由外部系統同步，請到來源系統新增。");
    if ((await this.knownIds([body.id])).size > 0) throw errors.conflict("這個車型代碼已經存在。");
    await this.repo.upsertModel({ id: body.id, label: body.label, active: body.active });
    await this.opts.events.publish("vehicle_model.changed", { modelId: body.id });
    return this.mustFindAdmin(body.id);
  }

  /** The id never changes; a model that is no longer sold is deactivated, never deleted. */
  async update(id: string, body: VehicleModelUpdateBody): Promise<AdminVehicleModelDto> {
    if (this.managedExternally) throw errors.managedExternally("車型資料由外部系統同步，請到來源系統修改。");
    if ((await this.knownIds([id])).size === 0) throw errors.notFound();
    await this.repo.upsertModel({ id, label: body.label, active: body.active });
    await this.opts.events.publish("vehicle_model.changed", { modelId: id });
    return this.mustFindAdmin(id);
  }

  private async mustFindAdmin(id: string): Promise<AdminVehicleModelDto> {
    const found = (await this.listAdmin()).find((m) => m.id === id);
    if (!found) throw errors.notFound();
    return found;
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
    await this.opts.events.publish("vehicle_model.changed", { modelId: "*" });
    return { upserted: feed.length, deactivated };
  }
}
