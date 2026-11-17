import { randomUUID } from "node:crypto";
import type { Region, ShopHours } from "@vsev/shared";
import { fromBool, nowIso, toBool, toDate, type SqliteDb } from "../../platform/sqlite";
import type { CoverageGapRow, ShopNetworkRepository, ShopRecord } from "./shop-network.repository";

interface ShopRow {
  id: string;
  name: string;
  region: Region;
  city: string;
  address: string;
  phone: string | null;
  hours: string;
  active: number;
}

const toShop = (r: ShopRow): ShopRecord => ({
  id: r.id,
  name: r.name,
  region: r.region,
  city: r.city,
  address: r.address,
  phone: r.phone,
  hours: JSON.parse(r.hours) as ShopHours,
  active: toBool(r.active)
});

type ShopValues = [string, string, Region, string, string, string | null, string, number];
const values = (s: ShopRecord): ShopValues => [
  s.id, s.name, s.region, s.city, s.address, s.phone, JSON.stringify(s.hours), fromBool(s.active)
];

export function createSqliteShopNetworkRepository(db: SqliteDb): ShopNetworkRepository {
  const listAll = db.prepare<[], ShopRow>("SELECT * FROM shops ORDER BY rowid");
  const findById = db.prepare<[string], ShopRow>("SELECT * FROM shops WHERE id = ?");
  const listForCampaign = db.prepare<[string], ShopRow>(
    `SELECT s.* FROM shops s JOIN campaign_shops cs ON cs.shop_id = s.id
     WHERE cs.campaign_id = ? ORDER BY s.rowid`
  );
  const clearCampaign = db.prepare<[string]>("DELETE FROM campaign_shops WHERE campaign_id = ?");
  const assign = db.prepare<[string, string]>(
    "INSERT OR IGNORE INTO campaign_shops (campaign_id, shop_id) VALUES (?, ?)"
  );
  const insert = db.prepare<ShopValues, ShopRow>(
    `INSERT INTO shops (id, name, region, city, address, phone, hours, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`
  );
  const replace = db.prepare<[...ShopValues, string], ShopRow>(
    `UPDATE shops SET id = ?, name = ?, region = ?, city = ?, address = ?, phone = ?, hours = ?, active = ?
     WHERE id = ? RETURNING *`
  );
  const addCoverage = db.prepare<[string, string, string | null, string | null, string]>(
    "INSERT INTO coverage_requests (id, city, note, email, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const gaps = db.prepare<[], { city: string; requests: number; latest_at: string }>(
    `SELECT city, COUNT(*) AS requests, MAX(created_at) AS latest_at
     FROM coverage_requests GROUP BY city ORDER BY requests DESC, latest_at DESC`
  );

  const setCampaignShops = db.transaction((campaignId: string, shopIds: string[]) => {
    clearCampaign.run(campaignId);
    for (const shopId of new Set(shopIds)) assign.run(campaignId, shopId);
  });
  const update = db.transaction((id: string, patch: Partial<Omit<ShopRecord, "id">>): ShopRow | undefined => {
    const current = findById.get(id);
    if (!current) return undefined;
    return replace.get(...values({ ...toShop(current), ...patch, id }), id);
  });

  return {
    async listAll() {
      return listAll.all().map(toShop);
    },
    async findById(id) {
      const row = findById.get(id);
      return row ? toShop(row) : null;
    },
    async listForCampaign(campaignId) {
      return listForCampaign.all(campaignId).map(toShop);
    },
    async setCampaignShops(campaignId, shopIds) {
      setCampaignShops(campaignId, shopIds);
    },
    async create(shop) {
      const row = insert.get(...values({ ...shop, id: shop.id ?? randomUUID() }));
      if (!row) throw new Error("insert shops returned no row");
      return toShop(row);
    },
    async update(id, patch) {
      const row = update(id, patch);
      return row ? toShop(row) : null;
    },
    async addCoverageRequest(input) {
      addCoverage.run(randomUUID(), input.city, input.note, input.email, nowIso());
    },
    async coverageGaps(): Promise<CoverageGapRow[]> {
      return gaps.all().map((r) => ({ city: r.city, requests: r.requests, latestAt: toDate(r.latest_at) }));
    }
  };
}
