import type { OrderStatus } from "@vsev/shared";

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
  installDeadline: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type NewOrder = Omit<OrderRecord, "id" | "createdAt" | "updatedAt" | "status" | "externalRef">;

export interface OrderEventRecord {
  id: string;
  orderId: string;
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
  page: number;
  pageSize: number;
}

export interface TransitionInput {
  orderId: string;
  from: OrderStatus;
  to: OrderStatus;
  actor: string;
  note: string | null;
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
  events(orderId: string): Promise<OrderEventRecord[]>;
  /** Orders still waiting to be installed whose install deadline is before `now`. */
  listOpenPastDeadline(now: Date): Promise<OrderRecord[]>;
  /** Idempotency for payment webhooks. Returns false when this gateway transaction was already recorded. */
  recordPayment(gatewayTxnId: string, orderId: string, status: string): Promise<boolean>;
  setExternalRef(orderId: string, externalRef: string): Promise<void>;
}
