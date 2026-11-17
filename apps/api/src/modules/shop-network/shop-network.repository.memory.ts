import { randomUUID } from "node:crypto";
import type { MemoryStore } from "../../platform/memory-store";
import type { CoverageGapRow, ShopNetworkRepository, ShopRecord } from "./shop-network.repository";

export function createMemoryShopNetworkRepository(store: MemoryStore): ShopNetworkRepository {
  return {
    async listAll() {
      return [...store.shops];
    },
    async findById(id) {
      return store.shops.find((s) => s.id === id) ?? null;
    },
    async listForCampaign(campaignId) {
      const ids = new Set(store.campaignShops.filter((c) => c.campaignId === campaignId).map((c) => c.shopId));
      return store.shops.filter((s) => ids.has(s.id));
    },
    async setCampaignShops(campaignId, shopIds) {
      store.campaignShops = store.campaignShops.filter((c) => c.campaignId !== campaignId);
      for (const shopId of new Set(shopIds)) store.campaignShops.push({ campaignId, shopId });
    },
    async create(shop) {
      const record: ShopRecord = { ...shop, id: shop.id ?? randomUUID() };
      store.shops.push(record);
      return record;
    },
    async update(id, patch) {
      const shop = store.shops.find((s) => s.id === id);
      if (!shop) return null;
      Object.assign(shop, patch);
      return shop;
    },
    async addCoverageRequest(input) {
      store.coverage.push({ ...input, createdAt: new Date() });
    },
    async coverageGaps() {
      const byCity = new Map<string, CoverageGapRow>();
      for (const req of store.coverage) {
        const row = byCity.get(req.city);
        if (row) {
          row.requests += 1;
          if (req.createdAt > row.latestAt) row.latestAt = req.createdAt;
        } else {
          byCity.set(req.city, { city: req.city, requests: 1, latestAt: req.createdAt });
        }
      }
      return [...byCity.values()].sort((a, b) => b.requests - a.requests);
    }
  };
}
