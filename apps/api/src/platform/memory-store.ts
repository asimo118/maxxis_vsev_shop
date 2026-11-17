import type { NotificationKind } from "@vsev/shared";
import type { AdminRecord, UserRecord } from "../modules/auth/auth.repository";
import type { CampaignRecord } from "../modules/catalog/catalog.repository";
import type { BookingRecord } from "../modules/fulfillment/fulfillment.repository";
import type { PointsEntryRecord } from "../modules/loyalty/loyalty.repository";
import type { MaintenanceProfileRecord, MileageRecord } from "../modules/maintenance/maintenance.repository";
import type { NotificationLogRecord, TemplateRecord } from "../modules/notification/notification.repository";
import type { OrderEventRecord, OrderRecord } from "../modules/order/order.repository";
import type { ShopRecord } from "../modules/shop-network/shop-network.repository";
import type { UserVehicleRecord, VehicleModelRecord } from "../modules/vehicle/vehicle.repository";

/** All tables of the in-memory driver (tests, demos). Mirrors the SQLite schema (platform/sqlite.migrations.ts). */
export interface MemoryStore {
  users: UserRecord[];
  admins: AdminRecord[];
  models: VehicleModelRecord[];
  userVehicles: UserVehicleRecord[];
  shops: ShopRecord[];
  campaignShops: { campaignId: string; shopId: string }[];
  coverage: { city: string; note: string | null; email: string | null; createdAt: Date }[];
  campaigns: CampaignRecord[];
  orders: OrderRecord[];
  orderEvents: OrderEventRecord[];
  payments: Map<string, { orderId: string; status: string }>;
  bookings: BookingRecord[];
  points: PointsEntryRecord[];
  referralCodes: Map<string, string>;
  templates: Map<NotificationKind, TemplateRecord>;
  logs: NotificationLogRecord[];
  mileage: MileageRecord[];
  profiles: MaintenanceProfileRecord[];
  funnel: { sessionId: string; event: string; campaignSlug: string; createdAt: Date }[];
}

export function createMemoryStore(): MemoryStore {
  return {
    users: [],
    admins: [],
    models: [],
    userVehicles: [],
    shops: [],
    campaignShops: [],
    coverage: [],
    campaigns: [],
    orders: [],
    orderEvents: [],
    payments: new Map(),
    bookings: [],
    points: [],
    referralCodes: new Map(),
    templates: new Map(),
    logs: [],
    mileage: [],
    profiles: [],
    funnel: []
  };
}
