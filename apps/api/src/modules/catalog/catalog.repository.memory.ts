import { randomUUID } from "node:crypto";
import type { MemoryStore } from "../../platform/memory-store";
import type { CampaignRecord, CatalogRepository } from "./catalog.repository";

export function createMemoryCatalogRepository(store: MemoryStore): CatalogRepository {
  return {
    async findBySlug(slug) {
      return store.campaigns.find((c) => c.slug === slug) ?? null;
    },
    async findById(id) {
      return store.campaigns.find((c) => c.id === id) ?? null;
    },
    async list() {
      return [...store.campaigns].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async create(input) {
      const record: CampaignRecord = {
        ...input,
        id: input.id ?? randomUUID(),
        status: input.status ?? "draft",
        createdAt: new Date()
      };
      store.campaigns.push(record);
      return record;
    },
    async update(id, patch) {
      const campaign = store.campaigns.find((c) => c.id === id);
      if (!campaign) return null;
      Object.assign(campaign, patch);
      return campaign;
    }
  };
}
