import type { CampaignContent, CampaignStatus } from "@vsev/shared";

export interface CampaignRecord {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  status: CampaignStatus;
  orderDeadline: Date;
  installDeadline: Date;
  productName: string;
  sizeLabel: string;
  includes: string[];
  listPriceCents: number;
  salePriceCents: number;
  content: CampaignContent;
  eligibleModelIds: string[];
  createdAt: Date;
}

export type NewCampaign = Omit<CampaignRecord, "id" | "createdAt" | "status"> & {
  id?: string;
  status?: CampaignStatus;
};

export interface CatalogRepository {
  findBySlug(slug: string): Promise<CampaignRecord | null>;
  findById(id: string): Promise<CampaignRecord | null>;
  list(): Promise<CampaignRecord[]>;
  create(input: NewCampaign): Promise<CampaignRecord>;
  update(id: string, patch: Partial<Omit<CampaignRecord, "id" | "createdAt">>): Promise<CampaignRecord | null>;
}
