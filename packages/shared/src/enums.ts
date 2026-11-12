export const ORDER_STATUSES = [
  "created",
  "paid",
  "shipped",
  "arrived_at_shop",
  "booked",
  "installed",
  "warranty_active",
  "cancelled",
  "refunded",
  "expired"
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const CAMPAIGN_STATUSES = ["draft", "live", "ended"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const BOOKING_STATUSES = ["reserved", "completed", "no_show", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const REGIONS = ["north", "hsinchu", "taichung", "changhua", "yunlin", "south"] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABELS: Record<Region, string> = {
  north: "北部",
  hsinchu: "新竹",
  taichung: "台中",
  changhua: "彰化",
  yunlin: "雲林",
  south: "南部"
};

export const POINTS_REASONS = ["purchase", "referral", "adjustment"] as const;
export type PointsReason = (typeof POINTS_REASONS)[number];

export const ADMIN_ROLES = ["operator", "manager", "finance"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Notification kinds map 1:1 to a template row (editable in the admin console). */
export const NOTIFICATION_KINDS = [
  "order_paid",
  "order_shipped",
  "order_arrived",
  "booking_confirmed",
  "install_reminder",
  "warranty_active"
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  order_paid: "訂單確認",
  order_shipped: "出貨通知",
  order_arrived: "到貨＋預約",
  booking_confirmed: "預約確認",
  install_reminder: "安裝期限提醒",
  warranty_active: "保固啟用"
};

export const FUNNEL_EVENTS = [
  "page_view",
  "model_selected",
  "shop_selected",
  "deadline_acknowledged",
  "checkout_started"
] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
