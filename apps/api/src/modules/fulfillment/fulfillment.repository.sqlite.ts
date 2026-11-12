import { randomUUID } from "node:crypto";
import type { BookingStatus } from "@vsev/shared";
import { nowIso, toDate, type SqliteDb } from "../../platform/sqlite";
import type { BookingRecord, FulfillmentRepository } from "./fulfillment.repository";

interface BookingRow {
  id: string;
  order_id: string;
  shop_id: string;
  slot_at: string;
  status: BookingStatus;
  created_at: string;
}

const toBooking = (r: BookingRow): BookingRecord => ({
  id: r.id,
  orderId: r.order_id,
  shopId: r.shop_id,
  slotAt: toDate(r.slot_at),
  status: r.status,
  createdAt: toDate(r.created_at)
});

export function createSqliteFulfillmentRepository(db: SqliteDb): FulfillmentRepository {
  const byOrder = db.prepare<[string], BookingRow>("SELECT * FROM bookings WHERE order_id = ?");
  // One row per order: a re-booking after a cancellation re-opens the same row.
  const upsert = db.prepare<[string, string, string, string, string, string], BookingRow>(
    `INSERT INTO bookings (id, order_id, shop_id, slot_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'reserved', ?, ?)
     ON CONFLICT (order_id) DO UPDATE SET shop_id = excluded.shop_id, slot_at = excluded.slot_at,
       status = 'reserved', updated_at = excluded.updated_at
     RETURNING *`
  );
  const setStatus = db.prepare<[BookingStatus, string, string], BookingRow>(
    "UPDATE bookings SET status = ?, updated_at = ? WHERE order_id = ? RETURNING *"
  );

  return {
    async findByOrderId(orderId) {
      const row = byOrder.get(orderId);
      return row ? toBooking(row) : null;
    },
    async upsertReserved(input) {
      const now = nowIso();
      const row = upsert.get(randomUUID(), input.orderId, input.shopId, input.slotAt.toISOString(), now, now);
      if (!row) throw new Error("upsert bookings returned no row");
      return toBooking(row);
    },
    async setStatus(orderId, status) {
      const row = setStatus.get(status, nowIso(), orderId);
      return row ? toBooking(row) : null;
    }
  };
}
