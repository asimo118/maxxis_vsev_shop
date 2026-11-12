import { randomUUID } from "node:crypto";
import type { CampaignContent, CampaignStatus } from "@vsev/shared";
import { nowIso, toDate, type SqliteDb } from "../../platform/sqlite";
import type { CampaignRecord, CatalogRepository } from "./catalog.repository";

interface CampaignRow {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  status: CampaignStatus;
  order_deadline: string;
  install_deadline: string;
  product_name: string;
  size_label: string;
  includes: string;
  list_price_cents: number;
  sale_price_cents: number;
  content: string;
  created_at: string;
}

type CampaignValues = [
  string, string, string, string, CampaignStatus, string, string, string, string, string, number, number, string, string, string
];

export function createSqliteCatalogRepository(db: SqliteDb): CatalogRepository {
  const bySlug = db.prepare<[string], CampaignRow>("SELECT * FROM campaigns WHERE slug = ?");
  const byId = db.prepare<[string], CampaignRow>("SELECT * FROM campaigns WHERE id = ?");
  const list = db.prepare<[], CampaignRow>("SELECT * FROM campaigns ORDER BY created_at DESC, rowid DESC");
  const models = db.prepare<[string], { model_id: string }>(
    "SELECT model_id FROM campaign_eligible_models WHERE campaign_id = ? ORDER BY position"
  );
  const clearModels = db.prepare<[string]>("DELETE FROM campaign_eligible_models WHERE campaign_id = ?");
  const addModel = db.prepare<[string, string, number]>(
    "INSERT OR IGNORE INTO campaign_eligible_models (campaign_id, model_id, position) VALUES (?, ?, ?)"
  );
  const insert = db.prepare<CampaignValues>(
    `INSERT INTO campaigns (id, slug, title, subtitle, status, order_deadline, install_deadline, product_name, size_label,
       includes, list_price_cents, sale_price_cents, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const replace = db.prepare<[...CampaignValues, string]>(
    `UPDATE campaigns SET id = ?, slug = ?, title = ?, subtitle = ?, status = ?, order_deadline = ?,
       install_deadline = ?, product_name = ?, size_label = ?, includes = ?, list_price_cents = ?,
       sale_price_cents = ?, content = ?, created_at = ?, updated_at = ?
     WHERE id = ?`
  );

  const hydrate = (r: CampaignRow): CampaignRecord => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    subtitle: r.subtitle,
    status: r.status,
    orderDeadline: toDate(r.order_deadline),
    installDeadline: toDate(r.install_deadline),
    productName: r.product_name,
    sizeLabel: r.size_label,
    includes: JSON.parse(r.includes) as string[],
    listPriceCents: r.list_price_cents,
    salePriceCents: r.sale_price_cents,
    content: JSON.parse(r.content) as CampaignContent,
    eligibleModelIds: models.all(r.id).map((m) => m.model_id),
    createdAt: toDate(r.created_at)
  });

  const values = (c: CampaignRecord): CampaignValues => [
    c.id, c.slug, c.title, c.subtitle, c.status, c.orderDeadline.toISOString(), c.installDeadline.toISOString(),
    c.productName, c.sizeLabel, JSON.stringify(c.includes), c.listPriceCents, c.salePriceCents,
    JSON.stringify(c.content), c.createdAt.toISOString(), nowIso()
  ];

  const writeModels = (campaignId: string, ids: string[]): void => {
    clearModels.run(campaignId);
    ids.forEach((modelId, i) => addModel.run(campaignId, modelId, i));
  };

  const create = db.transaction((record: CampaignRecord) => {
    insert.run(...values(record));
    writeModels(record.id, record.eligibleModelIds);
  });
  const update = db.transaction(
    (id: string, patch: Partial<Omit<CampaignRecord, "id" | "createdAt">>): CampaignRecord | null => {
      const row = byId.get(id);
      if (!row) return null;
      const next: CampaignRecord = { ...hydrate(row), ...patch, id };
      replace.run(...values(next), id);
      if (patch.eligibleModelIds) writeModels(id, patch.eligibleModelIds);
      return next;
    }
  );

  return {
    async findBySlug(slug) {
      const row = bySlug.get(slug);
      return row ? hydrate(row) : null;
    },
    async findById(id) {
      const row = byId.get(id);
      return row ? hydrate(row) : null;
    },
    async list() {
      return list.all().map(hydrate);
    },
    async create(input) {
      const record: CampaignRecord = {
        ...input,
        id: input.id ?? randomUUID(),
        status: input.status ?? "draft",
        createdAt: new Date()
      };
      create(record);
      return record;
    },
    async update(id, patch) {
      return update(id, patch);
    }
  };
}
