import type { Region, ShopHours } from "@vsev/shared";

export interface ShopRecord {
  id: string;
  name: string;
  region: Region;
  city: string;
  address: string;
  phone: string | null;
  hours: ShopHours;
  active: boolean;
}

export type NewShop = Omit<ShopRecord, "id"> & { id?: string };

export interface CoverageGapRow {
  city: string;
  requests: number;
  latestAt: Date;
}

export interface ShopNetworkRepository {
  listAll(): Promise<ShopRecord[]>;
  findById(id: string): Promise<ShopRecord | null>;
  /** Shops assigned to a campaign (active or not — the service filters). */
  listForCampaign(campaignId: string): Promise<ShopRecord[]>;
  setCampaignShops(campaignId: string, shopIds: string[]): Promise<void>;
  create(shop: NewShop): Promise<ShopRecord>;
  update(id: string, patch: Partial<Omit<ShopRecord, "id">>): Promise<ShopRecord | null>;
  addCoverageRequest(input: { city: string; note: string | null; email: string | null }): Promise<void>;
  coverageGaps(): Promise<CoverageGapRow[]>;
}
