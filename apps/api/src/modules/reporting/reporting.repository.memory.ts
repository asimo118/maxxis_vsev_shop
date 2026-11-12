import { DAY_MS } from "../../platform/clock";
import { OPEN_FOR_INSTALL, type OrderStatus, type OwnerRowDto } from "@vsev/shared";
import type { MemoryStore } from "../../platform/memory-store";
import type { OrderAggregates, ReportingRepository } from "./reporting.repository";

const NEVER_PAID: readonly OrderStatus[] = ["created", "cancelled"];
const NOT_REVENUE: readonly OrderStatus[] = ["created", "cancelled", "refunded"];

export function createMemoryReportingRepository(store: MemoryStore): ReportingRepository {
  return {
    async recordFunnelEvent(sessionId, event, campaignSlug) {
      store.funnel.push({ sessionId, event, campaignSlug, createdAt: new Date() });
    },
    async funnelCounts(campaignSlug) {
      const sessions = new Map<string, Set<string>>();
      for (const row of store.funnel) {
        if (row.campaignSlug !== campaignSlug) continue;
        const set = sessions.get(row.event) ?? new Set<string>();
        set.add(row.sessionId);
        sessions.set(row.event, set);
      }
      return Object.fromEntries([...sessions.entries()].map(([event, set]) => [event, set.size]));
    },
    async orderAggregates(campaignId, now): Promise<OrderAggregates> {
      const orders = store.orders.filter((o) => o.campaignId === campaignId);
      const horizon = now.getTime() + 14 * DAY_MS;
      const byShop = new Map<string, { shopId: string; shopName: string; orders: number; installed: number }>();
      const byStatus = new Map<OrderStatus, number>();
      for (const o of orders) {
        byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
        const shop = byShop.get(o.shopId) ?? { shopId: o.shopId, shopName: o.shopName, orders: 0, installed: 0 };
        shop.orders += 1;
        if (o.status === "installed" || o.status === "warranty_active") shop.installed += 1;
        byShop.set(o.shopId, shop);
      }
      return {
        created: orders.length,
        paid: orders.filter((o) => !NEVER_PAID.includes(o.status)).length,
        installed: orders.filter((o) => o.status === "installed" || o.status === "warranty_active").length,
        atRisk: orders.filter((o) => OPEN_FOR_INSTALL.includes(o.status) && o.installDeadline.getTime() <= horizon).length,
        paidRevenueCents: orders.filter((o) => !NOT_REVENUE.includes(o.status)).reduce((s, o) => s + o.amountCents, 0),
        byShop: [...byShop.values()].sort((a, b) => b.orders - a.orders),
        byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count }))
      };
    },
    async ownerRows(): Promise<OwnerRowDto[]> {
      const buyerIds = new Set(store.orders.map((o) => o.userId));
      return store.users
        .filter((u) => buyerIds.has(u.id))
        .map((u) => {
          const mileage = store.mileage.filter((m) => m.userId === u.id);
          return {
            userId: u.id,
            name: u.name,
            email: u.email,
            orders: store.orders.filter((o) => o.userId === u.id).length,
            pointsBalance: store.points.filter((p) => p.userId === u.id).reduce((s, p) => s + p.delta, 0),
            latestKm: mileage.length ? Math.max(...mileage.map((m) => m.odometerKm)) : null
          };
        });
    }
  };
}
