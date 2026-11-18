import type { OrderEventKind, OrderStatus } from "@vsev/shared";

export interface OrderRecord {
  id: string;
  number: string;
  userId: string;
  campaignId: string;
  campaignTitle: string;
  shopId: string;
  shopName: string;
  shopAddress: string;
  vehicleModelId: string;
  vehicleModelLabel: string;
  plate: string;
  amountCents: number;
  status: OrderStatus;
  referredByUserId: string | null;
  /** The external commerce system's reference, once the shopper was sent to the external cart. */
  externalRef: string | null;
  trackingCarrier: string | null;
  trackingNumber: string | null;
  /** Set while a customer's cancellation request waits for an admin decision. */
  cancelRequestedAt: Date | null;
  cancelReason: string | null;
  installDeadline: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type NewOrder = Omit<
  OrderRecord,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "status"
  | "externalRef"
  | "trackingCarrier"
  | "trackingNumber"
  | "cancelRequestedAt"
  | "cancelReason"
>;

/** Fields that may change WITHOUT a status transition. Status itself is never patchable (rule 7). */
export type OrderPatch = Partial<
  Pick<
    OrderRecord,
    | "shopId"
    | "shopName"
    | "shopAddress"
    | "vehicleModelId"
    | "vehicleModelLabel"
    | "plate"
    | "trackingCarrier"
    | "trackingNumber"
    | "cancelRequestedAt"
    | "cancelReason"
  >
>;

export interface OrderEventRecord {
  id: string;
  orderId: string;
  kind: OrderEventKind;
  from: OrderStatus | null;
  to: OrderStatus;
  actor: string;
  note: string | null;
  createdAt: Date;
}

export interface OrderSearch {
  status?: OrderStatus;
  shopId?: string;
  /** Matches order number or plate (case-insensitive substring). */
  q?: string;
  /** Restrict to these users (used to resolve customer-name searches). */
  userIds?: string[];
  /** true = only orders with an open cancellation request. */
  cancelRequested?: boolean;
  page: number;
  pageSize: number;
}

export interface TransitionInput {
  orderId: string;
  from: OrderStatus;
  to: OrderStatus;
  actor: string;
  note: string | null;
  /** Detail changes applied in the same transaction as the status change (e.g. tracking on "shipped"). */
  patch?: OrderPatch;
}

export interface OrderChangeInput {
  orderId: string;
  patch: OrderPatch;
  kind: "change" | "note";
  actor: string;
  note: string;
}

export interface OrderRepository {
  /** Inserts the order and its initial (null → created) audit event atomically. */
  create(order: NewOrder, actor: string): Promise<OrderRecord>;
  findById(id: string): Promise<OrderRecord | null>;
  numberExists(number: string): Promise<boolean>;
  listByUser(userId: string): Promise<OrderRecord[]>;
  search(filter: OrderSearch): Promise<{ items: OrderRecord[]; total: number }>;
  /**
   * Compare-and-swap: changes status only if the order is still in `from`, and writes the audit row
   * in the same transaction. Returns null when someone else moved the order first.
   */
  applyTransition(input: TransitionInput): Promise<OrderRecord | null>;
  /** Applies detail changes (never status) and the audit row atomically. Returns null if the order is gone. */
  applyChange(input: OrderChangeInput): Promise<OrderRecord | null>;
  events(orderId: string): Promise<OrderEventRecord[]>;
  statusCounts(): Promise<{ byStatus: { status: OrderStatus; count: number }[]; cancelRequests: number }>;
  /** Orders still waiting to be installed whose install deadline is before `now`. */
  listOpenPastDeadline(now: Date): Promise<OrderRecord[]>;
  /** Idempotency for payment webhooks. Returns false when this gateway transaction was already recorded. */
  recordPayment(gatewayTxnId: string, orderId: string, status: string): Promise<boolean>;
  setExternalRef(orderId: string, externalRef: string): Promise<void>;
}
