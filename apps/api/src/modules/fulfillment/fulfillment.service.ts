import { orderRules, type AdminOrderDetailDto, type BookingDto, type ShipBody } from "@vsev/shared";
import type { Clock } from "../../platform/clock";
import { errors } from "../../platform/errors";
import type { Logger } from "../../platform/logger";
import type { OrderService } from "../order/order.service";
import type { ShopNetworkService } from "../shop-network/shop-network.service";
import type { BookingRecord, FulfillmentRepository } from "./fulfillment.repository";

/**
 * "2026/10/30 14:00" in Taipei time, for audit-trail text. Deliberately not toLocaleString: its output
 * (e.g. thin-space separators) differs between ICU versions. Taiwan has no DST, so UTC+8 is exact.
 */
const fmtTaipei = (d: Date): string => {
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString();
  return `${t.slice(0, 10).replaceAll("-", "/")} ${t.slice(11, 16)}`;
};

const toDto = (b: BookingRecord): BookingDto => ({
  id: b.id,
  orderId: b.orderId,
  shopId: b.shopId,
  slotAt: b.slotAt.toISOString(),
  status: b.status
});

export interface FulfillmentServiceDeps {
  repo: FulfillmentRepository;
  orders: OrderService;
  shops: ShopNetworkService;
  clock: Clock;
  logger: Logger;
}

/**
 * Everything that happens between "paid" and "installed": shipping, arrival at the shop, the customer's
 * booking, the install itself, and the nightly sweep that expires orders past the install deadline.
 * It never writes order status directly — it asks OrderService.transition().
 */
export class FulfillmentService {
  constructor(private readonly deps: FulfillmentServiceDeps) {}

  async findByOrderId(orderId: string): Promise<BookingDto | null> {
    const booking = await this.deps.repo.findByOrderId(orderId);
    return booking && booking.status !== "cancelled" ? toDto(booking) : null;
  }

  /* ───── admin / shop-side reports ───── */

  async ship(orderId: string, adminId: string, tracking: ShipBody = {}): Promise<AdminOrderDetailDto> {
    await this.deps.orders.markShipped(orderId, `admin:${adminId}`, tracking);
    return this.deps.orders.adminGet(orderId);
  }

  async markArrived(orderId: string, adminId: string): Promise<AdminOrderDetailDto> {
    await this.deps.orders.transition(orderId, "arrived_at_shop", `admin:${adminId}`);
    return this.deps.orders.adminGet(orderId);
  }

  /** Shop reports the install complete → installed → (auto) warranty_active → the Owner journey starts. */
  async markInstalled(orderId: string, adminId: string): Promise<AdminOrderDetailDto> {
    const order = await this.deps.orders.getById(orderId);
    if (order.status !== "booked") throw errors.invalidTransition(order.status, "installed");
    await this.deps.orders.transition(orderId, "installed", `admin:${adminId}`);
    await this.deps.repo.setStatus(orderId, "completed");
    return this.deps.orders.adminGet(orderId);
  }

  /* ───── customer booking ───── */

  async book(userId: string, orderId: string, slotAtIso: string): Promise<BookingDto> {
    const order = await this.deps.orders.getOwned(userId, orderId);
    if (order.status !== "arrived_at_shop") throw errors.invalidTransition(order.status, "booked");

    const slotAt = await this.validSlot(order, slotAtIso);

    const booking = await this.deps.repo.upsertReserved({ orderId, shopId: order.shopId, slotAt });
    try {
      await this.deps.orders.transition(orderId, "booked", `user:${userId}`, { slotAt });
    } catch (err) {
      await this.deps.repo.setStatus(orderId, "cancelled");
      throw err;
    }
    return toDto(booking);
  }

  /** Move an existing booking to another slot; the order stays "booked". */
  async reschedule(userId: string, orderId: string, slotAtIso: string): Promise<BookingDto> {
    const order = await this.deps.orders.getOwned(userId, orderId);
    if (!orderRules.canChangeBooking({ status: order.status, cancelRequestedAt: null })) {
      throw errors.orderLocked("目前沒有可以更改的預約。");
    }
    const slotAt = await this.validSlot(order, slotAtIso);
    const booking = await this.deps.repo.upsertReserved({ orderId, shopId: order.shopId, slotAt });
    await this.deps.orders.recordChange(orderId, `user:${userId}`, `預約改為 ${fmtTaipei(slotAt)}`);
    return toDto(booking);
  }

  /** In the future, within the shop's opening hours, and before the install deadline. */
  private async validSlot(order: { shopId: string; installDeadline: Date }, slotAtIso: string): Promise<Date> {
    const slotAt = new Date(slotAtIso);
    const now = this.deps.clock.now();
    const withinDeadline = slotAt.getTime() <= order.installDeadline.getTime();
    const openThen = await this.deps.shops.isShopOpenAt(order.shopId, slotAt);
    if (slotAt.getTime() <= now.getTime() || !withinDeadline || !openThen) throw errors.bookingSlotInvalid();
    return slotAt;
  }

  async cancelBooking(userId: string, orderId: string): Promise<void> {
    const order = await this.deps.orders.getOwned(userId, orderId);
    if (order.status !== "booked") throw errors.invalidTransition(order.status, "arrived_at_shop");
    await this.deps.repo.setStatus(orderId, "cancelled");
    await this.deps.orders.transition(orderId, "arrived_at_shop", `user:${userId}`, { note: "會員取消預約" });
  }

  /* ───── nightly sweep ───── */

  /** Orders still open after their install deadline become `expired`. Safe to run repeatedly. */
  async expireOverdue(): Promise<number> {
    let expired = 0;
    for (const order of await this.deps.orders.listOpenPastDeadline()) {
      try {
        await this.deps.orders.transition(order.id, "expired", "system", { note: "逾安裝期限" });
        expired += 1;
      } catch (err) {
        this.deps.logger.warn({ err, orderId: order.id }, "could not expire overdue order");
      }
    }
    return expired;
  }
}
