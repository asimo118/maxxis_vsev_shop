import { randomUUID } from "node:crypto";
import { OPEN_FOR_INSTALL } from "@vsev/shared";
import type { MemoryStore } from "../../platform/memory-store";
import type { OrderRecord, OrderRepository } from "./order.repository";

export function createMemoryOrderRepository(store: MemoryStore): OrderRepository {
  return {
    async create(order, actor) {
      const now = new Date();
      const record: OrderRecord = {
        ...order,
        id: randomUUID(),
        status: "created",
        externalRef: null,
        createdAt: now,
        updatedAt: now
      };
      store.orders.push(record);
      store.orderEvents.push({
        id: randomUUID(),
        orderId: record.id,
        from: null,
        to: "created",
        actor,
        note: null,
        createdAt: now
      });
      return { ...record };
    },
    async findById(id) {
      const order = store.orders.find((o) => o.id === id);
      return order ? { ...order } : null;
    },
    async numberExists(number) {
      return store.orders.some((o) => o.number === number);
    },
    async listByUser(userId) {
      return store.orders
        .filter((o) => o.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((o) => ({ ...o }));
    },
    async search(filter) {
      const q = filter.q?.toLowerCase();
      const matched = store.orders
        .filter((o) => !filter.status || o.status === filter.status)
        .filter((o) => !filter.shopId || o.shopId === filter.shopId)
        .filter((o) => {
          if (!q && !filter.userIds) return true;
          const textHit = q ? o.number.toLowerCase().includes(q) || o.plate.toLowerCase().includes(q) : false;
          const userHit = filter.userIds ? filter.userIds.includes(o.userId) : false;
          return textHit || userHit;
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const start = (filter.page - 1) * filter.pageSize;
      return { items: matched.slice(start, start + filter.pageSize).map((o) => ({ ...o })), total: matched.length };
    },
    async applyTransition(input) {
      const order = store.orders.find((o) => o.id === input.orderId);
      if (!order || order.status !== input.from) return null;
      order.status = input.to;
      order.updatedAt = new Date();
      store.orderEvents.push({
        id: randomUUID(),
        orderId: order.id,
        from: input.from,
        to: input.to,
        actor: input.actor,
        note: input.note,
        createdAt: order.updatedAt
      });
      return { ...order };
    },
    async events(orderId) {
      return store.orderEvents
        .filter((e) => e.orderId === orderId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((e) => ({ ...e }));
    },
    async listOpenPastDeadline(now) {
      return store.orders
        .filter((o) => OPEN_FOR_INSTALL.includes(o.status) && o.installDeadline.getTime() < now.getTime())
        .map((o) => ({ ...o }));
    },
    async recordPayment(gatewayTxnId, orderId, status) {
      if (store.payments.has(gatewayTxnId)) return false;
      store.payments.set(gatewayTxnId, { orderId, status });
      return true;
    },
    async setExternalRef(orderId, externalRef) {
      const order = store.orders.find((o) => o.id === orderId);
      if (order) {
        order.externalRef = externalRef;
        order.updatedAt = new Date();
      }
    }
  };
}
