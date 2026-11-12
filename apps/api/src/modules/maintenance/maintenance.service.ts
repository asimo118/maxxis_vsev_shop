import type { MileageBody, MileageSummaryDto, OrderEventPayload } from "@vsev/shared";
import { errors } from "../../platform/errors";
import type { MaintenanceRepository } from "./maintenance.repository";

export class MaintenanceService {
  constructor(private readonly deps: { repo: MaintenanceRepository }) {}

  /** Owner journey starts here (warranty_active). Idempotent per order. */
  async openProfile(payload: OrderEventPayload): Promise<void> {
    await this.deps.repo.createProfile(payload.orderId, payload.userId);
  }

  async summary(userId: string): Promise<MileageSummaryDto> {
    const [profile, latest, entries] = await Promise.all([
      this.deps.repo.findProfileByUser(userId),
      this.deps.repo.latestMileage(userId),
      this.deps.repo.listMileage(userId, 30)
    ]);
    const interval = profile?.rotationIntervalKm ?? null;
    return {
      latestKm: latest?.odometerKm ?? null,
      nextServiceKm: interval && latest ? (Math.floor(latest.odometerKm / interval) + 1) * interval : interval,
      entries: entries.map((e) => ({ id: e.id, odometerKm: e.odometerKm, recordedAt: e.recordedAt.toISOString() }))
    };
  }

  /** Only owners (with a warranty profile) can log mileage; the odometer can't go backwards. */
  async record(userId: string, body: MileageBody): Promise<MileageSummaryDto> {
    if (!(await this.deps.repo.findProfileByUser(userId))) throw errors.forbidden("安裝完成並啟用保固後才能記錄里程。");
    const latest = await this.deps.repo.latestMileage(userId);
    if (latest && body.odometerKm < latest.odometerKm) throw errors.validation("里程數不可小於上次記錄。");
    await this.deps.repo.addMileage(userId, body.odometerKm);
    return this.summary(userId);
  }
}
