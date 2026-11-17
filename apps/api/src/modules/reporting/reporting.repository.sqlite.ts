import { OPEN_FOR_INSTALL, type OrderStatus, type OwnerRowDto } from "@vsev/shared";
import { DAY_MS } from "../../platform/clock";
import { nowIso, placeholders, type SqliteDb } from "../../platform/sqlite";
import type { OrderAggregates, ReportingRepository } from "./reporting.repository";

const INSTALLED = "('installed', 'warranty_active')";
const NEVER_PAID = "('created', 'cancelled')";
const NOT_REVENUE = "('created', 'cancelled', 'refunded')";
const OPEN = `(${placeholders(OPEN_FOR_INSTALL.length)})`;

/**
 * READ-MODEL adapter — the one place allowed to read across module tables (orders, users,
 * points_ledger, mileage_entries). It never writes anything except its own funnel_events.
 */
export function createSqliteReportingRepository(db: SqliteDb): ReportingRepository {
  const addFunnel = db.prepare<[string, string, string, string]>(
    "INSERT INTO funnel_events (session_id, event, campaign_slug, created_at) VALUES (?, ?, ?, ?)"
  );
  const funnel = db.prepare<[string], { event: string; sessions: number }>(
    `SELECT event, COUNT(DISTINCT session_id) AS sessions FROM funnel_events
     WHERE campaign_slug = ? GROUP BY event`
  );
  const totals = db.prepare<[...string[]], {
    created: number; paid: number; installed: number; at_risk: number; revenue: number;
  }>(
    `SELECT
       COUNT(*) AS created,
       COALESCE(SUM(status NOT IN ${NEVER_PAID}), 0) AS paid,
       COALESCE(SUM(status IN ${INSTALLED}), 0) AS installed,
       COALESCE(SUM(status IN ${OPEN} AND install_deadline <= ?), 0) AS at_risk,
       COALESCE(SUM(CASE WHEN status NOT IN ${NOT_REVENUE} THEN amount_cents ELSE 0 END), 0) AS revenue
     FROM orders WHERE campaign_id = ?`
  );
  const byShop = db.prepare<[string], { shop_id: string; shop_name: string; orders: number; installed: number }>(
    `SELECT shop_id, MAX(shop_name) AS shop_name, COUNT(*) AS orders, SUM(status IN ${INSTALLED}) AS installed
     FROM orders WHERE campaign_id = ? GROUP BY shop_id ORDER BY orders DESC, shop_name`
  );
  const byStatus = db.prepare<[string], { status: OrderStatus; count: number }>(
    "SELECT status, COUNT(*) AS count FROM orders WHERE campaign_id = ? GROUP BY status ORDER BY count DESC"
  );
  const owners = db.prepare<[], { user_id: string; name: string; email: string; orders: number; points: number; latest_km: number | null }>(
    `SELECT u.id AS user_id, u.name, u.email,
       (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders,
       (SELECT COALESCE(SUM(p.delta), 0) FROM points_ledger p WHERE p.user_id = u.id) AS points,
       (SELECT MAX(m.odometer_km) FROM mileage_entries m WHERE m.user_id = u.id) AS latest_km
     FROM users u
     WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)
     ORDER BY u.created_at, u.rowid`
  );

  return {
    async recordFunnelEvent(sessionId, event, campaignSlug) {
      addFunnel.run(sessionId, event, campaignSlug, nowIso());
    },
    async funnelCounts(campaignSlug) {
      return Object.fromEntries(funnel.all(campaignSlug).map((r) => [r.event, r.sessions]));
    },
    async orderAggregates(campaignId, now): Promise<OrderAggregates> {
      const horizon = new Date(now.getTime() + 14 * DAY_MS).toISOString();
      const t = totals.get(...OPEN_FOR_INSTALL, horizon, campaignId);
      return {
        created: t?.created ?? 0,
        paid: t?.paid ?? 0,
        installed: t?.installed ?? 0,
        atRisk: t?.at_risk ?? 0,
        paidRevenueCents: t?.revenue ?? 0,
        byShop: byShop.all(campaignId).map((r) => ({
          shopId: r.shop_id,
          shopName: r.shop_name,
          orders: r.orders,
          installed: r.installed
        })),
        byStatus: byStatus.all(campaignId).map((r) => ({ status: r.status, count: r.count }))
      };
    },
    async ownerRows(): Promise<OwnerRowDto[]> {
      return owners.all().map((r) => ({
        userId: r.user_id,
        name: r.name,
        email: r.email,
        orders: r.orders,
        pointsBalance: r.points,
        latestKm: r.latest_km
      }));
    }
  };
}
