import { randomUUID } from "node:crypto";
import { OPEN_FOR_INSTALL, type OrderStatus } from "@vsev/shared";
import { likeContains, nowIso, placeholders, toDate, type SqliteDb } from "../../platform/sqlite";
import type { NewOrder, OrderEventRecord, OrderRecord, OrderRepository } from "./order.repository";

interface OrderRow {
  id: string;
  number: string;
  user_id: string;
  campaign_id: string;
  campaign_title: string;
  shop_id: string;
  shop_name: string;
  shop_address: string;
  vehicle_model_id: string;
  vehicle_model_label: string;
  plate: string;
  amount_cents: number;
  status: OrderStatus;
  referred_by_user_id: string | null;
  external_ref: string | null;
  install_deadline: string;
  created_at: string;
  updated_at: string;
}
interface EventRow {
  id: string;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor: string;
  note: string | null;
  created_at: string;
}

const toOrder = (r: OrderRow): OrderRecord => ({
  id: r.id,
  number: r.number,
  userId: r.user_id,
  campaignId: r.campaign_id,
  campaignTitle: r.campaign_title,
  shopId: r.shop_id,
  shopName: r.shop_name,
  shopAddress: r.shop_address,
  vehicleModelId: r.vehicle_model_id,
  vehicleModelLabel: r.vehicle_model_label,
  plate: r.plate,
  amountCents: r.amount_cents,
  status: r.status,
  referredByUserId: r.referred_by_user_id,
  externalRef: r.external_ref,
  installDeadline: toDate(r.install_deadline),
  createdAt: toDate(r.created_at),
  updatedAt: toDate(r.updated_at)
});
const toEvent = (r: EventRow): OrderEventRecord => ({
  id: r.id,
  orderId: r.order_id,
  from: r.from_status,
  to: r.to_status,
  actor: r.actor,
  note: r.note,
  createdAt: toDate(r.created_at)
});

export function createSqliteOrderRepository(db: SqliteDb): OrderRepository {
  const insertOrder = db.prepare<
    [string, string, string, string, string, string, string, string, string, string, string, number, string | null, string, string, string],
    OrderRow
  >(
    `INSERT INTO orders (id, number, user_id, campaign_id, campaign_title, shop_id, shop_name, shop_address,
       vehicle_model_id, vehicle_model_label, plate, amount_cents, referred_by_user_id, install_deadline,
       created_at, updated_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created')
     RETURNING *`
  );
  const insertEvent = db.prepare<[string, string, OrderStatus | null, OrderStatus, string, string | null, string]>(
    `INSERT INTO order_events (id, order_id, from_status, to_status, actor, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const byId = db.prepare<[string], OrderRow>("SELECT * FROM orders WHERE id = ?");
  const numberExists = db.prepare<[string], { hit: number }>("SELECT 1 AS hit FROM orders WHERE number = ?");
  const byUser = db.prepare<[string], OrderRow>(
    "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, rowid DESC"
  );
  // Compare-and-swap: only moves the order if it is still in the expected state.
  const cas = db.prepare<[OrderStatus, string, string, OrderStatus], OrderRow>(
    "UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ? RETURNING *"
  );
  const events = db.prepare<[string], EventRow>(
    "SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at, rowid"
  );
  const openPastDeadline = db.prepare<[...string[]], OrderRow>(
    `SELECT * FROM orders WHERE status IN (${placeholders(OPEN_FOR_INSTALL.length)}) AND install_deadline < ?
     ORDER BY install_deadline`
  );
  const setExternalRef = db.prepare<[string, string, string]>(
    "UPDATE orders SET external_ref = ?, updated_at = ? WHERE id = ?"
  );
  const recordPayment = db.prepare<[string, string, string, string]>(
    "INSERT OR IGNORE INTO payment_events (gateway_txn_id, order_id, status, created_at) VALUES (?, ?, ?, ?)"
  );

  const create = db.transaction((order: NewOrder, actor: string): OrderRow => {
    const now = nowIso();
    const row = insertOrder.get(
      randomUUID(), order.number, order.userId, order.campaignId, order.campaignTitle, order.shopId, order.shopName,
      order.shopAddress, order.vehicleModelId, order.vehicleModelLabel, order.plate, order.amountCents,
      order.referredByUserId, order.installDeadline.toISOString(), now, now
    );
    if (!row) throw new Error("insert orders returned no row");
    insertEvent.run(randomUUID(), row.id, null, "created", actor, null, now);
    return row;
  });

  const transition = db.transaction(
    (orderId: string, from: OrderStatus, to: OrderStatus, actor: string, note: string | null): OrderRow | undefined => {
      const now = nowIso();
      const row = cas.get(to, now, orderId, from);
      if (!row) return undefined; // someone else moved it first — nothing written
      insertEvent.run(randomUUID(), orderId, from, to, actor, note, now);
      return row;
    }
  );

  return {
    async create(order, actor) {
      return toOrder(create(order, actor));
    },
    async findById(id) {
      const row = byId.get(id);
      return row ? toOrder(row) : null;
    },
    async numberExists(number) {
      return numberExists.get(number) !== undefined;
    },
    async listByUser(userId) {
      return byUser.all(userId).map(toOrder);
    },
    async search(filter) {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (filter.status) {
        where.push("status = ?");
        params.push(filter.status);
      }
      if (filter.shopId) {
        where.push("shop_id = ?");
        params.push(filter.shopId);
      }
      const anyOf: string[] = [];
      if (filter.q) {
        const pattern = likeContains(filter.q);
        anyOf.push("number LIKE ? ESCAPE '\\'", "plate LIKE ? ESCAPE '\\'");
        params.push(pattern, pattern);
      }
      if (filter.userIds && filter.userIds.length > 0) {
        anyOf.push(`user_id IN (${placeholders(filter.userIds.length)})`);
        params.push(...filter.userIds);
      }
      if (anyOf.length > 0) where.push(`(${anyOf.join(" OR ")})`);
      const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

      const total = db.prepare<(string | number)[], { n: number }>(`SELECT COUNT(*) AS n FROM orders ${clause}`).get(...params);
      const items = db
        .prepare<(string | number)[], OrderRow>(
          `SELECT * FROM orders ${clause} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`
        )
        .all(...params, filter.pageSize, (filter.page - 1) * filter.pageSize);
      return { items: items.map(toOrder), total: total?.n ?? 0 };
    },
    async applyTransition(input) {
      const row = transition(input.orderId, input.from, input.to, input.actor, input.note);
      return row ? toOrder(row) : null;
    },
    async events(orderId) {
      return events.all(orderId).map(toEvent);
    },
    async listOpenPastDeadline(now) {
      return openPastDeadline.all(...OPEN_FOR_INSTALL, now.toISOString()).map(toOrder);
    },
    async recordPayment(gatewayTxnId, orderId, status) {
      return recordPayment.run(gatewayTxnId, orderId, status, nowIso()).changes === 1;
    },
    async setExternalRef(orderId, externalRef) {
      setExternalRef.run(externalRef, nowIso(), orderId);
    }
  };
}
