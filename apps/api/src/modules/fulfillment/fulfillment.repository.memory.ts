import { randomUUID } from "node:crypto";
import type { MemoryStore } from "../../platform/memory-store";
import type { BookingRecord, FulfillmentRepository } from "./fulfillment.repository";

export function createMemoryFulfillmentRepository(store: MemoryStore): FulfillmentRepository {
  return {
    async findByOrderId(orderId) {
      const booking = store.bookings.find((b) => b.orderId === orderId);
      return booking ? { ...booking } : null;
    },
    async upsertReserved(input) {
      const existing = store.bookings.find((b) => b.orderId === input.orderId);
      if (existing) {
        existing.shopId = input.shopId;
        existing.slotAt = input.slotAt;
        existing.status = "reserved";
        return { ...existing };
      }
      const booking: BookingRecord = { id: randomUUID(), status: "reserved", createdAt: new Date(), ...input };
      store.bookings.push(booking);
      return { ...booking };
    },
    async setStatus(orderId, status) {
      const booking = store.bookings.find((b) => b.orderId === orderId);
      if (!booking) return null;
      booking.status = status;
      return { ...booking };
    }
  };
}
