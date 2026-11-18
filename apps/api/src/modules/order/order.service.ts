import { randomBytes } from "node:crypto";
import {
  ORDER_STATUSES,
  canTransition,
  orderEventName,
  type AdminOrderDetailDto,
  type AdminOrderQuery,
  type AdminOrderRowDto,
  orderRules,
  type AdminOrderSummaryDto,
  type AdminUpdateOrderBody,
  type BookingDto,
  type CheckoutDto,
  type CommerceWebhookBody,
  type CreateOrderBody,
  type OrderDto,
  type OrderEventDto,
  type OrderEventPayload,
  type OrderStatus,
  type Paged,
  type ShipBody,
  type UpdateOrderBody
} from "@vsev/shared";
import { taipeiParts, type Clock } from "../../platform/clock";
import { errors } from "../../platform/errors";
import type { EventBus } from "../../platform/events";
import type { AuthService } from "../auth/auth.service";
import type { CatalogService } from "../catalog/catalog.service";
import type { LoyaltyService } from "../loyalty/loyalty.service";
import type { ShopNetworkService } from "../shop-network/shop-network.service";
import type { VehicleService } from "../vehicle/vehicle.service";
import type { CommerceConnector } from "./commerce.port";
import type { OrderEventRecord, OrderPatch, OrderRecord, OrderRepository } from "./order.repository";

/** Port to the payment provider. Only a mock adapter ships — a real gateway must implement this interface. */
export interface PaymentGateway {
  charge(order: OrderRecord): Promise<{ gatewayTxnId: string; status: "succeeded" | "failed" }>;
}

export class MockPaymentGateway implements PaymentGateway {
  async charge(order: OrderRecord): Promise<{ gatewayTxnId: string; status: "succeeded" | "failed" }> {
    return { gatewayTxnId: `mock_${order.id}`, status: "succeeded" };
  }
}

/** Port implemented by fulfillment — lets order show the booking without depending on fulfillment (no cycle). */
export interface BookingReader {
  findByOrderId(orderId: string): Promise<BookingDto | null>;
}

export interface OrderServiceDeps {
  repo: OrderRepository;
  catalog: CatalogService;
  shops: ShopNetworkService;
  vehicles: VehicleService;
  loyalty: LoyaltyService;
  auth: AuthService;
  events: EventBus;
  clock: Clock;
  payments: PaymentGateway;
  bookings: BookingReader;
  /** Cart connector. null/absent = built-in checkout via `payments`. */
  commerce?: CommerceConnector | null;
}

const COMMERCE_TARGET = {
  "order.paid": "paid",
  "order.cancelled": "cancelled",
  "order.refunded": "refunded"
} as const satisfies Record<CommerceWebhookBody["type"], OrderStatus>;

const NUMBER_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A pending cancellation request is settled by these transitions. */
const SETTLES_CANCEL_REQUEST: readonly OrderStatus[] = ["cancelled", "refunded", "installed"];

const ruleInput = (o: OrderRecord) => ({
  status: o.status,
  cancelRequestedAt: o.cancelRequestedAt ? o.cancelRequestedAt.toISOString() : null
});

const toEventDto = (e: OrderEventRecord): OrderEventDto => ({
  id: e.id,
  kind: e.kind,
  from: e.from,
  to: e.to,
  actor: e.actor,
  note: e.note,
  createdAt: e.createdAt.toISOString()
});

export class OrderService {
  constructor(private readonly deps: OrderServiceDeps) {}

  /* ───────────── customer ───────────── */

  async create(userId: string, body: CreateOrderBody): Promise<OrderDto> {
    // Same gate as the storefront CTA: campaign live → model eligible → shop in campaign → referral valid.
    const campaign = await this.deps.catalog.getOrderable(body.campaignSlug);
    const model = await this.deps.vehicles.resolveEligibleModel(campaign.eligibleModelIds, body.vehicleModelId);
    const shop = await this.deps.shops.assertAvailable(campaign.id, body.shopId);
    const referredByUserId = body.referralCode
      ? await this.deps.loyalty.resolveReferrer(body.referralCode, userId)
      : null;

    await this.deps.vehicles.registerForOrder(userId, model.id, body.plate);

    const order = await this.deps.repo.create(
      {
        number: await this.newOrderNumber(),
        userId,
        campaignId: campaign.id,
        campaignTitle: campaign.title,
        shopId: shop.id,
        shopName: shop.name,
        shopAddress: shop.address,
        vehicleModelId: model.id,
        vehicleModelLabel: model.label,
        plate: body.plate,
        // Server-authoritative: the price is never taken from the client.
        amountCents: campaign.salePriceCents,
        referredByUserId,
        installDeadline: campaign.installDeadline
      },
      `user:${userId}`
    );
    await this.deps.events.publish("order.created", this.payload(order, null));
    return this.toDto(order);
  }

  async listMine(userId: string): Promise<OrderDto[]> {
    return (await this.deps.repo.listByUser(userId)).map((o) => this.toDto(o));
  }

  async getMine(userId: string, orderId: string): Promise<OrderDto> {
    const order = await this.getOwned(userId, orderId);
    return this.toDto(order, {
      // Admin-only notes never leave the admin API.
      events: (await this.deps.repo.events(orderId)).filter((e) => e.kind !== "note"),
      booking: await this.deps.bookings.findByOrderId(orderId)
    });
  }

  /** Customer edits (install shop, vehicle model, plate) — limited by the shared `orderRules`. */
  async updateMine(userId: string, orderId: string, body: UpdateOrderBody): Promise<OrderDto> {
    const order = await this.getOwned(userId, orderId);
    await this.applyDetailChange(order, body, `user:${userId}`);
    return this.getMine(userId, orderId);
  }

  /**
   * Unpaid orders are cancelled immediately. Paid orders get a cancellation REQUEST that an admin settles
   * (refund, or decline with a reason) — money never moves without a person deciding.
   */
  async requestCancel(userId: string, orderId: string, reason: string): Promise<OrderDto> {
    const order = await this.getOwned(userId, orderId);
    const rules = ruleInput(order);
    if (orderRules.canCancel(rules)) {
      await this.transition(orderId, "cancelled", `user:${userId}`, { note: reason });
    } else if (orderRules.canRequestCancel(rules)) {
      await this.deps.repo.applyChange({
        orderId,
        patch: { cancelRequestedAt: this.deps.clock.now(), cancelReason: reason },
        kind: "change",
        actor: `user:${userId}`,
        note: `申請取消：${reason}`
      });
    } else if (order.cancelRequestedAt) {
      throw errors.conflict("已送出取消申請，客服處理中。");
    } else {
      throw errors.orderLocked("此訂單已無法取消。如需協助請聯絡客服。");
    }
    return this.getMine(userId, orderId);
  }

  async withdrawCancelRequest(userId: string, orderId: string): Promise<OrderDto> {
    const order = await this.getOwned(userId, orderId);
    if (!orderRules.canWithdrawCancelRequest(ruleInput(order))) throw errors.orderLocked("沒有待處理的取消申請。");
    await this.deps.repo.applyChange({
      orderId,
      patch: { cancelRequestedAt: null, cancelReason: null },
      kind: "change",
      actor: `user:${userId}`,
      note: "撤回取消申請"
    });
    return this.getMine(userId, orderId);
  }

  /** Ownership check. A foreign order id looks exactly like a missing one. */
  async getOwned(userId: string, orderId: string): Promise<OrderRecord> {
    const order = await this.deps.repo.findById(orderId);
    if (!order || order.userId !== userId) throw errors.notFound("找不到這筆訂單。");
    return order;
  }

  get checkoutMode(): "internal" | "external" {
    return this.deps.commerce ? "external" : "internal";
  }

  /**
   * One entry point for the storefront's "pay" step, whichever system takes the money:
   * - internal: charge through the built-in PaymentGateway and return the paid order;
   * - external: hand the already-validated order to the cart connector and return its checkout URL.
   * The campaign must still be open at this moment, not only when the order was created.
   */
  async checkout(userId: string, orderId: string): Promise<CheckoutDto> {
    const order = await this.getOwned(userId, orderId);
    if (order.status !== "created") throw errors.invalidTransition(order.status, "paid");
    const campaign = await this.deps.catalog.getById(order.campaignId);
    if (!campaign) throw errors.notFound("找不到這檔活動。");
    await this.deps.catalog.getOrderable(campaign.slug);

    const commerce = this.deps.commerce;
    if (!commerce) return { mode: "internal", order: await this.charge(order) };

    const user = await this.deps.auth.getUser(userId);
    if (!user) throw errors.unauthenticated();
    const res = await commerce.createCheckout({
      orderId: order.id,
      orderNumber: order.number,
      campaignSlug: campaign.slug,
      productName: campaign.productName,
      quantity: 1,
      unitPriceCents: order.amountCents,
      currency: "TWD",
      customer: { id: user.id, name: user.name, email: user.email, phone: user.phone },
      vehicle: { modelId: order.vehicleModelId, modelLabel: order.vehicleModelLabel, plate: order.plate },
      installShop: { id: order.shopId, name: order.shopName, address: order.shopAddress },
      installDeadline: order.installDeadline.toISOString()
    });
    await this.deps.repo.setExternalRef(order.id, res.externalRef);
    return { mode: "redirect", url: res.checkoutUrl, order: this.toDto(await this.mustFind(order.id)) };
  }

  /**
   * Status reports from the external commerce system. Idempotent per eventId; the externalRef must
   * match the one we stored, so a valid signature alone cannot move someone else's order.
   * Events that no longer apply (e.g. "cancelled" after installation) are acknowledged but not applied,
   * so the sender does not retry forever.
   */
  async handleCommerceEvent(event: CommerceWebhookBody): Promise<{ applied: boolean; status: OrderStatus }> {
    const order = await this.deps.repo.findById(event.orderId);
    if (!order || !order.externalRef || order.externalRef !== event.externalRef) throw errors.notFound("找不到這筆訂單。");
    const first = await this.deps.repo.recordPayment(`commerce:${event.eventId}`, order.id, event.type);
    const target = COMMERCE_TARGET[event.type];
    if (!first || order.status === target || !canTransition(order.status, target)) {
      return { applied: false, status: order.status };
    }
    const updated = await this.transition(order.id, target, "commerce", { note: `external ${event.eventId}` });
    return { applied: true, status: updated.status };
  }

  /** Built-in payment only. With a cart connector, payment happens in the external system. */
  async pay(userId: string, orderId: string): Promise<OrderDto> {
    if (this.deps.commerce) throw errors.managedExternally("付款由外部購物車處理，請使用結帳流程。");
    return this.charge(await this.getOwned(userId, orderId));
  }

  private async charge(order: OrderRecord): Promise<OrderDto> {
    const orderId = order.id;
    if (order.status !== "created") throw errors.invalidTransition(order.status, "paid");
    const result = await this.deps.payments.charge(order);
    const updated = await this.handlePaymentResult(orderId, result.gatewayTxnId, result.status);
    if (result.status === "failed") throw errors.paymentFailed();
    return this.toDto(updated);
  }

  /** Idempotent on the gateway transaction id — safe for webhook retries and double clicks. */
  async handlePaymentResult(
    orderId: string,
    gatewayTxnId: string,
    status: "succeeded" | "failed"
  ): Promise<OrderRecord> {
    const order = await this.mustFind(orderId);
    const firstTime = await this.deps.repo.recordPayment(gatewayTxnId, orderId, status);
    if (!firstTime || status === "failed") return order;
    if (order.status === "created") return this.transition(orderId, "paid", "gateway", { note: gatewayTxnId });
    return order;
  }

  async cancelMine(userId: string, orderId: string): Promise<OrderDto> {
    await this.getOwned(userId, orderId);
    return this.toDto(await this.transition(orderId, "cancelled", `user:${userId}`, { note: "會員取消未付款訂單" }));
  }

  /** Audit trail for a detail change made by another module (e.g. fulfillment rescheduling a booking). */
  async recordChange(orderId: string, actor: string, note: string): Promise<void> {
    if (!(await this.deps.repo.applyChange({ orderId, patch: {}, kind: "change", actor, note }))) {
      throw errors.notFound("找不到這筆訂單。");
    }
  }

  /* ───────────── the ONLY writer of order status ───────────── */

  /**
   * Validates against the shared transition table, applies a compare-and-swap with an audit row,
   * then publishes the domain event. Subscribers (notification, loyalty, maintenance) react to the event —
   * this method never calls them. `installed` chains straight into `warranty_active`.
   */
  async transition(
    orderId: string,
    to: OrderStatus,
    actor: string,
    opts: { note?: string; slotAt?: Date; patch?: OrderPatch } = {}
  ): Promise<OrderRecord> {
    const order = await this.mustFind(orderId);
    if (!canTransition(order.status, to)) throw errors.invalidTransition(order.status, to);
    if ((to === "booked" || to === "installed") && this.deps.clock.now() > order.installDeadline) {
      throw errors.installDeadlinePassed();
    }

    const patch: OrderPatch = { ...opts.patch };
    if (order.cancelRequestedAt && SETTLES_CANCEL_REQUEST.includes(to)) {
      patch.cancelRequestedAt = null;
      patch.cancelReason = null;
    }
    const updated = await this.deps.repo.applyTransition({
      orderId,
      from: order.status,
      to,
      actor,
      note: opts.note ?? null,
      patch
    });
    if (!updated) throw errors.conflict("訂單狀態剛被更新，請重新整理後再試。");

    await this.deps.events.publish(orderEventName(to), this.payload(updated, order.status, opts.slotAt));
    if (to === "installed") return this.transition(orderId, "warranty_active", "system");
    return updated;
  }

  /* ───────────── used by other modules (service → service) ───────────── */

  async getById(orderId: string): Promise<OrderRecord> {
    return this.mustFind(orderId);
  }

  async listOpenPastDeadline(): Promise<OrderRecord[]> {
    return this.deps.repo.listOpenPastDeadline(this.deps.clock.now());
  }

  /* ───────────── admin ───────────── */

  async adminSearch(query: AdminOrderQuery): Promise<Paged<AdminOrderRowDto>> {
    const userIds = query.q ? await this.deps.auth.searchUserIds(query.q) : undefined;
    const { items, total } = await this.deps.repo.search({
      status: query.status,
      shopId: query.shopId,
      cancelRequested: query.cancelRequested,
      q: query.q,
      userIds: userIds && userIds.length > 0 ? userIds : undefined,
      page: query.page,
      pageSize: query.pageSize
    });
    const users = await this.deps.auth.getUsersByIds([...new Set(items.map((o) => o.userId))]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: items.map((o) => {
        const user = users.find((u) => u.id === o.userId);
        return {
          id: o.id,
          number: o.number,
          status: o.status,
          cancelRequested: o.cancelRequestedAt !== null,
          userId: o.userId,
          customerName: user?.name ?? "(已刪除)",
          customerEmail: user?.email ?? "",
          shopName: o.shopName,
          vehicleModelLabel: o.vehicleModelLabel,
          plate: o.plate,
          amountCents: o.amountCents,
          installDeadline: o.installDeadline.toISOString(),
          createdAt: o.createdAt.toISOString()
        };
      })
    };
  }

  async adminGet(orderId: string): Promise<AdminOrderDetailDto> {
    const order = await this.mustFind(orderId);
    const user = await this.deps.auth.getUser(order.userId);
    const dto = this.toDto(order, {
      events: await this.deps.repo.events(orderId),
      booking: await this.deps.bookings.findByOrderId(orderId)
    });
    return {
      ...dto,
      userId: order.userId,
      customerName: user?.name ?? "(已刪除)",
      customerEmail: user?.email ?? "",
      referredByUserId: order.referredByUserId,
      externalRef: order.externalRef
    };
  }

  async adminSummary(): Promise<AdminOrderSummaryDto> {
    const { byStatus, cancelRequests } = await this.deps.repo.statusCounts();
    const counts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
    for (const row of byStatus) counts[row.status] = row.count;
    return { byStatus: counts, total: byStatus.reduce((n, r) => n + r.count, 0), cancelRequests };
  }

  /** Admin edits on the customer's behalf (same rules as the customer) plus shipment tracking. */
  async adminUpdate(orderId: string, adminId: string, body: AdminUpdateOrderBody): Promise<AdminOrderDetailDto> {
    await this.applyDetailChange(await this.mustFind(orderId), body, `admin:${adminId}`);
    return this.adminGet(orderId);
  }

  /** Internal comment — admins only; filtered out of every customer response. */
  async adminComment(orderId: string, adminId: string, note: string): Promise<AdminOrderDetailDto> {
    const done = await this.deps.repo.applyChange({ orderId, patch: {}, kind: "note", actor: `admin:${adminId}`, note });
    if (!done) throw errors.notFound("找不到這筆訂單。");
    return this.adminGet(orderId);
  }

  /** Decline a cancellation request; the reason is shown to the customer. (Approving = refund.) */
  async adminDismissCancelRequest(orderId: string, adminId: string, note?: string): Promise<AdminOrderDetailDto> {
    const order = await this.mustFind(orderId);
    if (!order.cancelRequestedAt) throw errors.orderLocked("這筆訂單沒有待處理的取消申請。");
    await this.deps.repo.applyChange({
      orderId,
      patch: { cancelRequestedAt: null, cancelReason: null },
      kind: "change",
      actor: `admin:${adminId}`,
      note: note ? `取消申請未核准：${note}` : "取消申請未核准"
    });
    return this.adminGet(orderId);
  }

  /** "shipped", with the carrier / tracking number the customer will see. */
  async markShipped(orderId: string, actor: string, tracking: ShipBody): Promise<OrderRecord> {
    const patch: OrderPatch = {};
    if (tracking.carrier !== undefined) patch.trackingCarrier = tracking.carrier;
    if (tracking.trackingNumber !== undefined) patch.trackingNumber = tracking.trackingNumber;
    const note = [tracking.carrier, tracking.trackingNumber].filter(Boolean).join(" ");
    return this.transition(orderId, "shipped", actor, { patch, note: note || undefined });
  }

  async adminCancel(orderId: string, adminId: string, note?: string): Promise<AdminOrderDetailDto> {
    await this.transition(orderId, "cancelled", `admin:${adminId}`, { note });
    return this.adminGet(orderId);
  }

  /** Records the refund decision. Moving the money back is the payment gateway adapter's job. */
  async adminRefund(orderId: string, adminId: string, note?: string): Promise<AdminOrderDetailDto> {
    await this.transition(orderId, "refunded", `admin:${adminId}`, { note });
    return this.adminGet(orderId);
  }

  /* ───────────── helpers ───────────── */

  /**
   * Validates and applies detail edits (never status) with one audit row describing every change.
   * Each field is checked against the shared `orderRules`, and new values are validated like a new order:
   * the shop must be active in the order's campaign, the model eligible for it.
   */
  private async applyDetailChange(order: OrderRecord, body: AdminUpdateOrderBody, actor: string): Promise<void> {
    const rules = ruleInput(order);
    const patch: OrderPatch = {};
    const notes: string[] = [];

    if (body.shopId !== undefined && body.shopId !== order.shopId) {
      if (!orderRules.canChangeShop(rules)) throw errors.orderLocked("輪胎已出貨，無法更換安裝店家。如需協助請聯絡客服。");
      const shop = await this.deps.shops.assertAvailable(order.campaignId, body.shopId);
      Object.assign(patch, { shopId: shop.id, shopName: shop.name, shopAddress: shop.address });
      notes.push(`安裝店家：${order.shopName} → ${shop.name}`);
    }
    if (body.vehicleModelId !== undefined && body.vehicleModelId !== order.vehicleModelId) {
      if (!orderRules.canChangeVehicle(rules)) throw errors.orderLocked("已完成安裝，無法修改車型。");
      const campaign = await this.deps.catalog.getById(order.campaignId);
      if (!campaign) throw errors.notFound("找不到這檔活動。");
      const model = await this.deps.vehicles.resolveEligibleModel(campaign.eligibleModelIds, body.vehicleModelId);
      Object.assign(patch, { vehicleModelId: model.id, vehicleModelLabel: model.label });
      notes.push(`車型：${order.vehicleModelLabel} → ${model.label}`);
    }
    if (body.plate !== undefined && body.plate !== order.plate) {
      if (!orderRules.canChangeVehicle(rules)) throw errors.orderLocked("已完成安裝，無法修改車牌。");
      patch.plate = body.plate;
      notes.push(`車牌：${order.plate} → ${body.plate}`);
    }
    const carrierChanged = body.carrier !== undefined && body.carrier !== order.trackingCarrier;
    const numberChanged = body.trackingNumber !== undefined && body.trackingNumber !== order.trackingNumber;
    if (carrierChanged || numberChanged) {
      if (!orderRules.canEditTracking(rules)) throw errors.orderLocked("出貨後才能填寫物流資訊。");
      if (carrierChanged) patch.trackingCarrier = body.carrier;
      if (numberChanged) patch.trackingNumber = body.trackingNumber;
      notes.push(`物流：${[body.carrier ?? order.trackingCarrier, body.trackingNumber ?? order.trackingNumber].filter(Boolean).join(" ")}`);
    }
    if (notes.length === 0) return; // nothing actually changed

    if (patch.vehicleModelId !== undefined || patch.plate !== undefined) {
      await this.deps.vehicles.registerForOrder(order.userId, patch.vehicleModelId ?? order.vehicleModelId, patch.plate ?? order.plate);
    }
    await this.deps.repo.applyChange({ orderId: order.id, patch, kind: "change", actor, note: notes.join("；") });
  }

  private async mustFind(orderId: string): Promise<OrderRecord> {
    const order = await this.deps.repo.findById(orderId);
    if (!order) throw errors.notFound("找不到這筆訂單。");
    return order;
  }

  private async newOrderNumber(): Promise<string> {
    const { ymd } = taipeiParts(this.deps.clock.now());
    for (let attempt = 0; attempt < 8; attempt++) {
      const bytes = randomBytes(4);
      let suffix = "";
      for (const b of bytes) suffix += NUMBER_ALPHABET[b % NUMBER_ALPHABET.length];
      const number = `VSEV-${ymd}-${suffix}`;
      if (!(await this.deps.repo.numberExists(number))) return number;
    }
    throw errors.conflict("無法產生訂單編號，請再試一次。");
  }

  private payload(order: OrderRecord, from: OrderStatus | null, slotAt?: Date): OrderEventPayload {
    return {
      orderId: order.id,
      orderNumber: order.number,
      userId: order.userId,
      campaignId: order.campaignId,
      shopId: order.shopId,
      shopName: order.shopName,
      amountCents: order.amountCents,
      referredByUserId: order.referredByUserId,
      from,
      to: order.status,
      installDeadline: order.installDeadline.toISOString(),
      slotAt: slotAt ? slotAt.toISOString() : null,
      occurredAt: this.deps.clock.now().toISOString()
    };
  }

  private toDto(
    order: OrderRecord,
    extra: { events?: OrderEventRecord[]; booking?: BookingDto | null } = {}
  ): OrderDto {
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      campaignId: order.campaignId,
      campaignTitle: order.campaignTitle,
      amountCents: order.amountCents,
      shopId: order.shopId,
      shopName: order.shopName,
      shopAddress: order.shopAddress,
      vehicleModelId: order.vehicleModelId,
      vehicleModelLabel: order.vehicleModelLabel,
      plate: order.plate,
      shipment:
        order.trackingCarrier || order.trackingNumber
          ? { carrier: order.trackingCarrier, trackingNumber: order.trackingNumber }
          : null,
      cancelRequest:
        order.cancelRequestedAt && order.cancelReason
          ? { reason: order.cancelReason, requestedAt: order.cancelRequestedAt.toISOString() }
          : null,
      installDeadline: order.installDeadline.toISOString(),
      createdAt: order.createdAt.toISOString(),
      booking: extra.booking ?? null,
      events: (extra.events ?? []).map(toEventDto)
    };
  }
}
