import type { BookingStatus } from "@vsev/shared";

export interface BookingRecord {
  id: string;
  orderId: string;
  shopId: string;
  slotAt: Date;
  status: BookingStatus;
  createdAt: Date;
}

export interface FulfillmentRepository {
  findByOrderId(orderId: string): Promise<BookingRecord | null>;
  /** One booking row per order: creates it, or re-opens a cancelled one with the new slot. */
  upsertReserved(input: { orderId: string; shopId: string; slotAt: Date }): Promise<BookingRecord>;
  setStatus(orderId: string, status: BookingStatus): Promise<BookingRecord | null>;
}
