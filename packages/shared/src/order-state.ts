import type { OrderStatus } from "./enums";

/**
 * The single whitelist of legal order transitions.
 * `OrderService.transition()` is the only writer of order status and consults this table.
 *
 *  created ─▶ paid ─▶ shipped ─▶ arrived_at_shop ─▶ booked ─▶ installed ─▶ warranty_active
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  created: ["paid", "cancelled"],
  paid: ["shipped", "refunded"],
  shipped: ["arrived_at_shop", "refunded", "expired"],
  arrived_at_shop: ["booked", "refunded", "expired"],
  booked: ["installed", "arrived_at_shop", "expired"],
  installed: ["warranty_active"],
  warranty_active: [],
  cancelled: [],
  refunded: [],
  expired: ["refunded"]
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

/** Statuses from which the customer can still earn the campaign (install deadline is still relevant). */
export const OPEN_FOR_INSTALL: readonly OrderStatus[] = ["paid", "shipped", "arrived_at_shop", "booked"];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  created: "待付款",
  paid: "已付款",
  shipped: "已出貨",
  arrived_at_shop: "已到店",
  booked: "已預約",
  installed: "已安裝",
  warranty_active: "保固啟用",
  cancelled: "已取消",
  refunded: "已退款",
  expired: "已逾期"
};

/** Customer-facing progress rail (storefront order page). */
export const ORDER_PROGRESS: readonly { status: OrderStatus; label: string }[] = [
  { status: "paid", label: "已付款" },
  { status: "shipped", label: "輪胎出貨" },
  { status: "arrived_at_shop", label: "到店通知" },
  { status: "booked", label: "已預約安裝" },
  { status: "installed", label: "完成安裝" }
];

export function progressIndex(status: OrderStatus): number {
  if (status === "warranty_active") return ORDER_PROGRESS.length - 1;
  return ORDER_PROGRESS.findIndex((step) => step.status === status);
}
