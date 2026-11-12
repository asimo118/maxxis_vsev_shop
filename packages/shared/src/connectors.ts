import { z } from "zod";
import { REGIONS } from "./enums";
import type { OrderDto } from "./schemas";
import { shopHours } from "./schemas";

/**
 * Connector contracts — what an EXTERNAL system must send or accept. Every payload crossing the
 * boundary is validated with these schemas, so a misbehaving partner API is rejected at the edge
 * instead of corrupting local data. See docs/connectors.md for the full integration guide.
 */

export const CONNECTOR_NAMES = ["vehicles", "shops", "commerce"] as const;
export type ConnectorName = (typeof CONNECTOR_NAMES)[number];

/* ───────────── 1. Vehicle-model feed  (GET {VEHICLE_SOURCE_URL}) ───────────── */

export const externalVehicleModel = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(120),
  active: z.boolean().default(true)
});
export type ExternalVehicleModel = z.infer<typeof externalVehicleModel>;

/* ───────────── 2. Shop-directory feed  (GET {SHOP_SOURCE_URL}) ───────────── */

export const externalShop = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  region: z.enum(REGIONS),
  city: z.string().trim().min(1).max(20),
  address: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(30).nullable().default(null),
  hours: shopHours,
  active: z.boolean().default(true)
});
export type ExternalShop = z.infer<typeof externalShop>;

/** Feeds may answer with a bare array or `{ "items": [...] }`. */
export function feedResponse<T extends z.ZodTypeAny>(item: T) {
  const list = z.array(item);
  return z.union([list, z.object({ items: list })]).transform((v) => (Array.isArray(v) ? v : v.items));
}

/* ───────────── 3. Cart / checkout  (POST {COMMERCE_API_URL}/checkouts) ───────────── */

/** What we send when the shopper presses checkout. Prices are integer cents (100 = NT$1). */
export interface ExternalCheckoutRequest {
  orderId: string;
  orderNumber: string;
  campaignSlug: string;
  sku: string;
  productName: string;
  quantity: 1;
  unitPriceCents: number;
  currency: "TWD";
  customer: { id: string; name: string; email: string; phone: string | null };
  vehicle: { modelId: string; modelLabel: string; plate: string };
  installShop: { id: string; name: string; address: string };
  installDeadline: string;
  /** Where the external cart should send the shopper back after payment. */
  returnUrl: string;
}

export const externalCheckoutResponse = z.object({
  /** The external system's id for this cart/order — echoed back in webhooks. */
  externalRef: z.string().trim().min(1).max(128),
  /** Absolute https URL of the external cart / payment page. */
  checkoutUrl: z.string().url().refine((u) => /^https?:\/\//.test(u), "checkoutUrl must be http(s)")
});
export type ExternalCheckoutResponse = z.infer<typeof externalCheckoutResponse>;

/** Webhook the external system calls on payment status changes (POST /api/v1/connectors/commerce/webhook). */
export const commerceWebhookBody = z.object({
  /** Unique per event — redelivery of the same event is a no-op. */
  eventId: z.string().trim().min(1).max(128),
  type: z.enum(["order.paid", "order.cancelled", "order.refunded"]),
  orderId: z.string().min(1),
  externalRef: z.string().min(1)
});
export type CommerceWebhookBody = z.infer<typeof commerceWebhookBody>;

/* ───────────── DTOs ───────────── */

/** Result of POST /orders/:id/checkout. */
export type CheckoutDto =
  | { mode: "internal"; order: OrderDto }
  | { mode: "redirect"; url: string; order: OrderDto };

export interface ConnectorStatusDto {
  name: ConnectorName;
  label: string;
  /** "local" = data managed in this system; "http" = synced from / delegated to an external system. */
  mode: "local" | "http";
  /** Host of the external endpoint (never the full URL or credentials). */
  endpointHost: string | null;
  syncable: boolean;
  lastRunAt: string | null;
  lastResult: "ok" | "error" | null;
  lastMessage: string | null;
  lastCounts: { upserted: number; deactivated: number } | null;
}
