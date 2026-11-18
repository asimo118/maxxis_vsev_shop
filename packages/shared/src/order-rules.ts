import type { OrderStatus } from "./enums";

/**
 * What may change on an order, by status — shared by the storefront, the admin console and the API
 * (the API enforces exactly these functions, so the UI never offers an action the server will refuse).
 *
 *   created ─ paid ─ shipped ─ arrived_at_shop ─ booked ─ installed …
 *   ├─ change install shop ─┤                                   (tyres are shipped to the shop)
 *   ├──────────── change vehicle model / plate ──────────────┤    (verified at installation)
 *   ├ cancel ┤                                                    (nothing paid yet)
 *            ├────────── request cancellation ─────────────────┤ (money is refunded by an admin)
 */
const SHOP_CHANGEABLE: readonly OrderStatus[] = ["created", "paid"];
const VEHICLE_CHANGEABLE: readonly OrderStatus[] = ["created", "paid", "shipped", "arrived_at_shop", "booked"];
const CANCEL_REQUESTABLE: readonly OrderStatus[] = ["paid", "shipped", "arrived_at_shop", "booked"];
const TRACKING_EDITABLE: readonly OrderStatus[] = ["shipped", "arrived_at_shop", "booked"];

export interface OrderRuleInput {
  status: OrderStatus;
  /** ISO time a pending cancellation request was made, or null. */
  cancelRequestedAt: string | null;
}

export const orderRules = {
  /** Install shop: only before the tyres leave the warehouse. */
  canChangeShop: (o: OrderRuleInput): boolean => SHOP_CHANGEABLE.includes(o.status),
  /** Vehicle model and plate: until the install is done (the shop checks the registration on the day). */
  canChangeVehicle: (o: OrderRuleInput): boolean => VEHICLE_CHANGEABLE.includes(o.status),
  /** Immediate self-service cancellation: unpaid orders only. */
  canCancel: (o: OrderRuleInput): boolean => o.status === "created",
  /** Paid orders: the customer asks, an admin refunds (or declines). One open request at a time. */
  canRequestCancel: (o: OrderRuleInput): boolean => CANCEL_REQUESTABLE.includes(o.status) && o.cancelRequestedAt === null,
  canWithdrawCancelRequest: (o: OrderRuleInput): boolean => o.cancelRequestedAt !== null,
  /** Booking: first booking once the tyres are at the shop; reschedule / cancel while booked. */
  canBook: (o: OrderRuleInput): boolean => o.status === "arrived_at_shop",
  canChangeBooking: (o: OrderRuleInput): boolean => o.status === "booked",
  /** Admin: carrier / tracking number can be corrected after shipping. */
  canEditTracking: (o: OrderRuleInput): boolean => TRACKING_EDITABLE.includes(o.status)
} as const;

export type OrderRuleName = keyof typeof orderRules;
