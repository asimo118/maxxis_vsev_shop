import type { OrderStatus, OwnerRowDto } from "@vsev/shared";

export interface OrderAggregates {
  /** Orders created for the campaign (any status). */
  created: number;
  /** Orders that were paid at some point (everything except created / cancelled). */
  paid: number;
  installed: number;
  /** Open orders whose install deadline is within 14 days. */
  atRisk: number;
  paidRevenueCents: number;
  byShop: { shopId: string; shopName: string; orders: number; installed: number }[];
  byStatus: { status: OrderStatus; count: number }[];
}

/**
 * READ-MODEL port. This is the single deliberate exception to "only the owning module touches a table":
 * reporting reads (never writes) across module tables to build aggregates.
 */
export interface ReportingRepository {
  recordFunnelEvent(sessionId: string, event: string, campaignSlug: string): Promise<void>;
  /** Distinct sessions per funnel event. */
  funnelCounts(campaignSlug: string): Promise<Record<string, number>>;
  orderAggregates(campaignId: string, now: Date): Promise<OrderAggregates>;
  ownerRows(): Promise<OwnerRowDto[]>;
}
