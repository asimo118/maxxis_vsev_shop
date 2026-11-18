import type { OrderStatus } from "./enums";

/**
 * Domain events. Modules never call each other for side effects — they publish one of these
 * and the interested modules (notification, loyalty, maintenance, reporting) subscribe.
 */
export interface OrderEventPayload {
  orderId: string;
  orderNumber: string;
  userId: string;
  campaignId: string;
  shopId: string;
  shopName: string;
  amountCents: number;
  /** Set when the buyer used a (backend-validated) referral code. */
  referredByUserId: string | null;
  from: OrderStatus | null;
  to: OrderStatus;
  installDeadline: string;
  /** Only present on `order.booked`. */
  slotAt: string | null;
  occurredAt: string;
}

export type DomainEventMap = {
  "order.created": OrderEventPayload;
  "order.paid": OrderEventPayload;
  "order.shipped": OrderEventPayload;
  "order.arrived_at_shop": OrderEventPayload;
  "order.booked": OrderEventPayload;
  "order.installed": OrderEventPayload;
  "order.warranty_active": OrderEventPayload;
  "order.cancelled": OrderEventPayload;
  "order.refunded": OrderEventPayload;
  "order.expired": OrderEventPayload;
  "campaign.published": { campaignId: string; slug: string };
  "campaign.updated": { campaignId: string; slug: string };
  /** shop-network → catalog: the shop assignment of a campaign changed, drop its cached page. */
  "campaign.shops_changed": { campaignId: string };
  /** shop-network → catalog: a shop's details/active flag changed ("*" = a whole connector sync), drop all cached pages. */
  "shop.changed": { shopId: string };
  /** vehicle → catalog: a model's label/active flag changed ("*" = a whole connector sync), drop all cached pages. */
  "vehicle_model.changed": { modelId: string };
};

export type DomainEventName = keyof DomainEventMap;

export function orderEventName(status: OrderStatus): `order.${OrderStatus}` {
  return `order.${status}`;
}
