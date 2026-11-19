import { z } from "zod";
import {
  ADMIN_ROLES,
  CAMPAIGN_STATUSES,
  FUNNEL_EVENTS,
  NOTIFICATION_KINDS,
  ORDER_STATUSES,
  REGIONS,
  type AdminRole,
  type BookingStatus,
  type CampaignStatus,
  type NotificationKind,
  type OrderStatus,
  type PointsReason,
  type Region
} from "./enums";

/* ───────────────────────── request bodies (validated at the API boundary) ───────────────────────── */

export const registerBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(100),
  name: z.string().trim().min(1).max(60),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{8,20}$/)
    .optional()
});
export type RegisterBody = z.infer<typeof registerBody>;

export const loginBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(100)
});
export type LoginBody = z.infer<typeof loginBody>;

/** Admins hold more power than customers, so their passwords must be longer (customers: 8). */
export const ADMIN_PASSWORD_MIN = 12;

const changePasswordFields = {
  currentPassword: z.string().min(1).max(100),
  /** Default: every other signed-in device is signed out (CASA 3.3.3). */
  signOutOtherSessions: z.boolean().default(true)
};
const differentPassword = (b: { currentPassword: string; newPassword: string }): boolean => b.newPassword !== b.currentPassword;
const differentMessage = { path: ["newPassword"], message: "新密碼不能與目前的密碼相同。" };

export const changePasswordBody = z
  .object({ ...changePasswordFields, newPassword: z.string().min(8, "新密碼至少 8 個字元。").max(100) })
  .refine(differentPassword, differentMessage);
export type ChangePasswordBody = z.infer<typeof changePasswordBody>;

export const adminChangePasswordBody = z
  .object({
    ...changePasswordFields,
    newPassword: z.string().min(ADMIN_PASSWORD_MIN, `新密碼至少 ${ADMIN_PASSWORD_MIN} 個字元。`).max(100)
  })
  .refine(differentPassword, differentMessage);
export type AdminChangePasswordBody = z.infer<typeof adminChangePasswordBody>;

const adminPassword = z.string().min(ADMIN_PASSWORD_MIN, `密碼至少 ${ADMIN_PASSWORD_MIN} 個字元。`).max(100);

/** Manager → 後台帳號: one personal account per person (CASA 2.5.4: no shared accounts). */
export const adminCreateBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(60),
  role: z.enum(ADMIN_ROLES),
  password: adminPassword
});
export type AdminCreateBody = z.infer<typeof adminCreateBody>;

export const adminUpdateBody = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    role: z.enum(ADMIN_ROLES).optional(),
    active: z.boolean().optional()
  })
  .refine((b) => b.name !== undefined || b.role !== undefined || b.active !== undefined, { message: "沒有要修改的欄位。" });
export type AdminUpdateBody = z.infer<typeof adminUpdateBody>;

/** A manager sets a temporary password for someone who forgot theirs; all of that admin's sessions end. */
export const adminResetPasswordBody = z.object({ password: adminPassword });
export type AdminResetPasswordBody = z.infer<typeof adminResetPasswordBody>;

export const plateSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$/, "plate format e.g. ABC-1234");

export const createOrderBody = z.object({
  campaignSlug: z.string().min(1),
  vehicleModelId: z.string().min(1),
  plate: plateSchema,
  shopId: z.string().min(1),
  /** Must be literally true — the API enforces the same gate as the storefront CTA. */
  deadlineAcknowledged: z.literal(true),
  referralCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,12}$/)
    .optional()
});
export type CreateOrderBody = z.infer<typeof createOrderBody>;

/** Customer (or admin on the customer's behalf) changes to an order. At least one field. */
export const updateOrderBody = z
  .object({
    shopId: z.string().min(1).optional(),
    vehicleModelId: z.string().min(1).optional(),
    plate: plateSchema.optional()
  })
  .refine((b) => b.shopId !== undefined || b.vehicleModelId !== undefined || b.plate !== undefined, {
    message: "nothing to change"
  });
export type UpdateOrderBody = z.infer<typeof updateOrderBody>;

export const cancelRequestBody = z.object({
  reason: z.string().trim().min(2, "請說明取消原因").max(300)
});
export type CancelRequestBody = z.infer<typeof cancelRequestBody>;

export const bookingBody = z.object({
  slotAt: z.string().datetime()
});
export type BookingBody = z.infer<typeof bookingBody>;

export const mileageBody = z.object({
  odometerKm: z.number().int().min(0).max(1_000_000)
});
export type MileageBody = z.infer<typeof mileageBody>;

export const coverageRequestBody = z.object({
  city: z.string().trim().min(1).max(40),
  note: z.string().trim().max(300).optional(),
  email: z.string().trim().toLowerCase().email().optional()
});
export type CoverageRequestBody = z.infer<typeof coverageRequestBody>;

export const trackBody = z.object({
  sessionId: z.string().min(8).max(64),
  event: z.enum(FUNNEL_EVENTS),
  campaignSlug: z.string().min(1).max(120)
});
export type TrackBody = z.infer<typeof trackBody>;

export const paymentWebhookBody = z.object({
  gatewayTxnId: z.string().min(1).max(120),
  orderId: z.string().min(1),
  status: z.enum(["succeeded", "failed"])
});
export type PaymentWebhookBody = z.infer<typeof paymentWebhookBody>;

/* ───────────────────────── admin request bodies ───────────────────────── */

export const shopHours = z.object({
  open: z.string().regex(/^\d{2}:\d{2}$/),
  close: z.string().regex(/^\d{2}:\d{2}$/),
  /** ISO weekdays the shop is open: 1 = Monday … 7 = Sunday. */
  days: z.array(z.number().int().min(1).max(7)).min(1)
});
export type ShopHours = z.infer<typeof shopHours>;

export const shopUpsertBody = z.object({
  name: z.string().trim().min(1).max(80),
  region: z.enum(REGIONS),
  city: z.string().trim().min(1).max(20),
  address: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(30).nullable().optional(),
  hours: shopHours,
  active: z.boolean().default(true)
});
export type ShopUpsertBody = z.infer<typeof shopUpsertBody>;

export const campaignContentSchema = z.object({
  eyebrow: z.string(),
  steps: z.array(z.object({ title: z.string(), body: z.string() })),
  directShipNote: z.string(),
  specs: z.array(z.object({ label: z.string(), value: z.string() })),
  evPoints: z.array(z.object({ title: z.string(), body: z.string() })),
  timeline: z.array(z.object({ tag: z.string(), title: z.string(), body: z.string() })),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
  reviews: z.array(
    z.object({ stars: z.number().int().min(1).max(5), body: z.string(), who: z.string(), where: z.string() })
  ),
  reviewSummary: z.object({ rating: z.string(), count: z.number().int().min(0) }),
  coverageNote: z.string(),
  paymentNote: z.string(),
  contact: z.object({
    company: z.string(),
    address: z.string(),
    phone: z.string(),
    hours: z.string(),
    email: z.string()
  })
});
export type CampaignContent = z.infer<typeof campaignContentSchema>;

export const campaignUpsertBody = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case slug, e.g. vs-ev-plus-bmw-ix2-2026q4"),
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().trim().max(200),
  orderDeadline: z.string().datetime(),
  installDeadline: z.string().datetime(),
  listPriceCents: z.number().int().min(0),
  salePriceCents: z.number().int().min(0),
  productName: z.string().trim().min(1).max(120),
  sizeLabel: z.string().trim().min(1).max(60),
  includes: z.array(z.string()),
  eligibleModelIds: z.array(z.string()).min(1),
  content: campaignContentSchema
});
export type CampaignUpsertBody = z.infer<typeof campaignUpsertBody>;

export const cloneCampaignBody = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case slug")
});
export type CloneCampaignBody = z.infer<typeof cloneCampaignBody>;

export const assignShopsBody = z.object({ shopIds: z.array(z.string()) });
export type AssignShopsBody = z.infer<typeof assignShopsBody>;

export const adjustPointsBody = z.object({
  userId: z.string().min(1),
  delta: z.number().int().refine((n) => n !== 0, "delta must not be 0"),
  note: z.string().trim().min(3).max(200)
});
export type AdjustPointsBody = z.infer<typeof adjustPointsBody>;

export const templateUpdateBody = z.object({
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(1000),
  enabled: z.boolean()
});
export type TemplateUpdateBody = z.infer<typeof templateUpdateBody>;

export const adminOrderQuery = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  shopId: z.string().optional(),
  /** "true" = only orders with an open cancellation request. */
  cancelRequested: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});
export type AdminOrderQuery = z.infer<typeof adminOrderQuery>;

export const adminNoteBody = z.object({ note: z.string().trim().max(200).optional() });

/** Internal comment on an order — visible to admins only, never to the customer. */
export const adminCommentBody = z.object({ note: z.string().trim().min(1).max(500) });
export type AdminCommentBody = z.infer<typeof adminCommentBody>;

const trackingFields = {
  carrier: z.string().trim().min(1).max(40).optional(),
  trackingNumber: z.string().trim().min(1).max(60).optional()
};
/** Mark shipped, optionally with the carrier and tracking number shown to the customer. */
export const shipBody = z.object(trackingFields);
export type ShipBody = z.infer<typeof shipBody>;

/** Admin edits: the customer-editable fields plus shipment tracking. */
export const adminUpdateOrderBody = z
  .object({
    shopId: z.string().min(1).optional(),
    vehicleModelId: z.string().min(1).optional(),
    plate: plateSchema.optional(),
    ...trackingFields
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "nothing to change" });
export type AdminUpdateOrderBody = z.infer<typeof adminUpdateOrderBody>;

/* ───────────────────────── response DTOs ───────────────────────── */

export interface UserDto {
  id: string;
  email: string;
  name: string;
  phone: string | null;
}

export interface AdminDto {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

/** Admin → 後台帳號 list row. */
export interface AdminAccountDto extends AdminDto {
  active: boolean;
  createdAt: string;
  /** Most recent sign-in, if any (for the monthly account review). */
  lastLoginAt: string | null;
}

export interface AuthResultDto<T> {
  token: string;
  user: T;
}

export interface VehicleModelDto {
  id: string;
  label: string;
}

export interface ShopDto {
  id: string;
  name: string;
  region: Region;
  regionLabel: string;
  city: string;
  address: string;
  phone: string | null;
  hours: ShopHours;
  hoursLabel: string;
  openNow: boolean;
  active: boolean;
}

export interface CampaignPageDto {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  status: CampaignStatus;
  orderDeadline: string;
  installDeadline: string;
  product: {
    name: string;
    sizeLabel: string;
    listPriceCents: number;
    salePriceCents: number;
    includes: string[];
  };
  eligibleModels: VehicleModelDto[];
  shops: ShopDto[];
  content: CampaignContent;
}

export interface OrderEventDto {
  id: string;
  /** status = a status transition; change = details edited (shop, plate, booking, cancel request…); note = admin-only comment. */
  kind: OrderEventKind;
  from: OrderStatus | null;
  to: OrderStatus;
  actor: string;
  note: string | null;
  createdAt: string;
}

export interface BookingDto {
  id: string;
  orderId: string;
  shopId: string;
  slotAt: string;
  status: BookingStatus;
}

export const ORDER_EVENT_KINDS = ["status", "change", "note"] as const;
export type OrderEventKind = (typeof ORDER_EVENT_KINDS)[number];

export interface OrderDto {
  id: string;
  number: string;
  status: OrderStatus;
  campaignId: string;
  campaignTitle: string;
  amountCents: number;
  shopId: string;
  shopName: string;
  shopAddress: string;
  vehicleModelId: string;
  vehicleModelLabel: string;
  plate: string;
  shipment: { carrier: string | null; trackingNumber: string | null } | null;
  cancelRequest: { reason: string; requestedAt: string } | null;
  installDeadline: string;
  createdAt: string;
  booking: BookingDto | null;
  events: OrderEventDto[];
}

export interface AdminOrderDetailDto extends OrderDto {
  userId: string;
  customerName: string;
  customerEmail: string;
  referredByUserId: string | null;
  /** Reference in the external commerce system when the cart connector is enabled. */
  externalRef: string | null;
}

export interface AdminOrderSummaryDto {
  /** Orders per status (statuses with no orders are 0). */
  byStatus: Record<OrderStatus, number>;
  total: number;
  /** Orders with an open cancellation request — the admin's to-do list. */
  cancelRequests: number;
}

export interface AdminOrderRowDto {
  id: string;
  number: string;
  status: OrderStatus;
  cancelRequested: boolean;
  userId: string;
  customerName: string;
  customerEmail: string;
  shopName: string;
  vehicleModelLabel: string;
  plate: string;
  amountCents: number;
  installDeadline: string;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PointsEntryDto {
  id: string;
  delta: number;
  reason: PointsReason;
  note: string | null;
  createdAt: string;
}

export interface PointsSummaryDto {
  balance: number;
  referralCode: string | null;
  entries: PointsEntryDto[];
}

export interface MileageSummaryDto {
  latestKm: number | null;
  nextServiceKm: number | null;
  entries: { id: string; odometerKm: number; recordedAt: string }[];
}

export interface NotificationTemplateDto {
  kind: NotificationKind;
  title: string;
  body: string;
  enabled: boolean;
}

export interface NotificationLogDto {
  id: string;
  kind: NotificationKind;
  userId: string;
  channel: string;
  status: "sent" | "failed";
  title: string;
  createdAt: string;
}

export interface FunnelStepDto {
  key: string;
  label: string;
  count: number;
}

export interface DashboardDto {
  campaign: { slug: string; title: string; status: CampaignStatus } | null;
  funnel: FunnelStepDto[];
  kpis: {
    orders: number;
    paidRevenueCents: number;
    installed: number;
    atRisk: number;
  };
  byShop: { shopId: string; shopName: string; orders: number; installed: number }[];
  byStatus: { status: OrderStatus; count: number }[];
}

export interface CoverageGapDto {
  city: string;
  requests: number;
  latestAt: string;
}

export interface AdminCampaignRowDto {
  id: string;
  slug: string;
  title: string;
  status: CampaignStatus;
  orderDeadline: string;
  installDeadline: string;
  shopCount: number;
}

export interface AdminCampaignDetailDto extends CampaignUpsertBody {
  id: string;
  status: CampaignStatus;
  shopIds: string[];
}

export interface UserVehicleDto {
  id: string;
  plate: string;
  modelId: string;
  modelLabel: string;
}

export interface OwnerRowDto {
  userId: string;
  name: string;
  email: string;
  orders: number;
  pointsBalance: number;
  latestKm: number | null;
}

export { ADMIN_ROLES, CAMPAIGN_STATUSES, NOTIFICATION_KINDS };
