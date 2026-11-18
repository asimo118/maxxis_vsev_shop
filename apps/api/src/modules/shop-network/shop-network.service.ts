import {
  REGION_LABELS,
  type CoverageGapDto,
  type ExternalShop,
  type CoverageRequestBody,
  type ShopDto,
  type ShopHours,
  type ShopUpsertBody
} from "@vsev/shared";
import { taipeiParts, type Clock } from "../../platform/clock";
import { errors } from "../../platform/errors";
import type { EventBus } from "../../platform/events";
import type { ShopNetworkRepository, ShopRecord } from "./shop-network.repository";

const DAY_NAMES = ["", "一", "二", "三", "四", "五", "六", "日"] as const;

/**
 * Opening days + hours as customers read them: "每日 09:00–18:00", "週一至週六 09:00–18:00",
 * "週一至週五、週日 10:00–19:00". Consecutive days (1 = Monday … 7 = Sunday) collapse into ranges.
 */
export function hoursLabel(hours: ShopHours): string {
  const days = [...new Set(hours.days)].sort((a, b) => a - b);
  const time = `${hours.open}–${hours.close}`;
  if (days.length === 7) return `每日 ${time}`;
  const runs: number[][] = [];
  for (const d of days) {
    const run = runs.at(-1);
    if (run && run.at(-1) === d - 1) run.push(d);
    else runs.push([d]);
  }
  const parts = runs.map((r) => {
    const first = DAY_NAMES[r[0] ?? 0];
    const last = DAY_NAMES[r.at(-1) ?? 0];
    if (r.length === 1) return `週${first}`;
    if (r.length === 2) return `週${first}、週${last}`;
    return `週${first}至週${last}`;
  });
  return `${parts.join("、")} ${time}`;
}

const toMinutes = (hhmm: string): number => {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};

/** True when `at` (interpreted in Asia/Taipei) falls on an open weekday within [open, close). */
export function isOpenAt(hours: ShopHours, at: Date): boolean {
  const { isoWeekday, minutes } = taipeiParts(at);
  return hours.days.includes(isoWeekday) && minutes >= toMinutes(hours.open) && minutes < toMinutes(hours.close);
}

export function toShopDto(shop: ShopRecord, now: Date): ShopDto {
  return {
    id: shop.id,
    name: shop.name,
    region: shop.region,
    regionLabel: REGION_LABELS[shop.region],
    city: shop.city,
    address: shop.address,
    phone: shop.phone,
    hours: shop.hours,
    hoursLabel: hoursLabel(shop.hours),
    openNow: isOpenAt(shop.hours, now),
    active: shop.active
  };
}

export class ShopNetworkService {
  constructor(
    private readonly deps: {
      repo: ShopNetworkRepository;
      clock: Clock;
      events: EventBus;
      /** True when the shop directory connector is in "http" mode: shops are edited in the source system. */
      managedExternally?: boolean;
    }
  ) {}

  get managedExternally(): boolean {
    return this.deps.managedExternally ?? false;
  }

  /** Active shops assigned to the campaign — what the storefront's shop selector shows. */
  async listForCampaign(campaignId: string): Promise<ShopDto[]> {
    const now = this.deps.clock.now();
    return (await this.deps.repo.listForCampaign(campaignId)).filter((s) => s.active).map((s) => toShopDto(s, now));
  }

  /** "Open now" changes minute to minute, so cached pages are re-stamped on every read. */
  refreshOpenNow(shops: ShopDto[]): ShopDto[] {
    const now = this.deps.clock.now();
    return shops.map((s) => ({ ...s, openNow: isOpenAt(s.hours, now) }));
  }

  /** The install shop is also the logistics destination, so it must belong to the campaign and be active. */
  async assertAvailable(campaignId: string, shopId: string): Promise<ShopRecord> {
    const shop = (await this.deps.repo.listForCampaign(campaignId)).find((s) => s.id === shopId);
    if (!shop || !shop.active) throw errors.shopNotAvailable();
    return shop;
  }

  async isShopOpenAt(shopId: string, at: Date): Promise<boolean> {
    const shop = await this.deps.repo.findById(shopId);
    return shop ? isOpenAt(shop.hours, at) : false;
  }

  /* ───── admin ───── */

  async listAll(): Promise<ShopDto[]> {
    const now = this.deps.clock.now();
    return (await this.deps.repo.listAll()).map((s) => toShopDto(s, now));
  }

  async create(body: ShopUpsertBody): Promise<ShopDto> {
    if (this.managedExternally) throw errors.managedExternally("店家資料由外部系統同步，請到來源系統新增。");
    const shop = await this.deps.repo.create({
      name: body.name,
      region: body.region,
      city: body.city,
      address: body.address,
      phone: body.phone ?? null,
      hours: body.hours,
      active: body.active
    });
    await this.deps.events.publish("shop.changed", { shopId: shop.id });
    return toShopDto(shop, this.deps.clock.now());
  }

  async update(id: string, body: ShopUpsertBody): Promise<ShopDto> {
    if (this.managedExternally) throw errors.managedExternally("店家資料由外部系統同步，請到來源系統修改。");
    const shop = await this.deps.repo.update(id, {
      name: body.name,
      region: body.region,
      city: body.city,
      address: body.address,
      phone: body.phone ?? null,
      hours: body.hours,
      active: body.active
    });
    if (!shop) throw errors.notFound();
    await this.deps.events.publish("shop.changed", { shopId: shop.id });
    return toShopDto(shop, this.deps.clock.now());
  }

  /**
   * Mirror the external shop-directory feed into the local table (keeps bookings, opening-hours checks and
   * campaign assignment working even while the source system is down). Shops missing upstream are
   * deactivated, not deleted. Campaign assignment stays a local decision. An empty feed is refused.
   */
  async syncFromFeed(feed: readonly ExternalShop[]): Promise<{ upserted: number; deactivated: number }> {
    if (feed.length === 0) throw new Error("shop feed returned no shops; refusing to deactivate every shop");
    const seen = new Set(feed.map((s) => s.id));
    for (const s of feed) {
      const values = { name: s.name, region: s.region, city: s.city, address: s.address, phone: s.phone, hours: s.hours, active: s.active };
      if (await this.deps.repo.findById(s.id)) await this.deps.repo.update(s.id, values);
      else await this.deps.repo.create({ id: s.id, ...values });
    }
    let deactivated = 0;
    for (const s of await this.deps.repo.listAll()) {
      if (!seen.has(s.id) && s.active) {
        await this.deps.repo.update(s.id, { active: false });
        deactivated += 1;
      }
    }
    // One event for the whole batch: cached campaign pages are dropped once, not per shop.
    await this.deps.events.publish("shop.changed", { shopId: "*" });
    return { upserted: feed.length, deactivated };
  }

  async assignedShopIds(campaignId: string): Promise<string[]> {
    return (await this.deps.repo.listForCampaign(campaignId)).map((s) => s.id);
  }

  async assignToCampaign(campaignId: string, shopIds: string[]): Promise<string[]> {
    const known = new Set((await this.deps.repo.listAll()).map((s) => s.id));
    const unknown = shopIds.filter((id) => !known.has(id));
    if (unknown.length > 0) throw errors.validation({ path: "shopIds", message: `unknown shop ids: ${unknown.join(", ")}` });
    await this.deps.repo.setCampaignShops(campaignId, shopIds);
    await this.deps.events.publish("campaign.shops_changed", { campaignId });
    return this.assignedShopIds(campaignId);
  }

  /* ───── coverage gaps: shoppers with no nearby install shop tell us where to recruit next ───── */

  async submitCoverageRequest(body: CoverageRequestBody): Promise<void> {
    await this.deps.repo.addCoverageRequest({ city: body.city, note: body.note ?? null, email: body.email ?? null });
  }

  async coverageGaps(): Promise<CoverageGapDto[]> {
    return (await this.deps.repo.coverageGaps()).map((g) => ({
      city: g.city,
      requests: g.requests,
      latestAt: g.latestAt.toISOString()
    }));
  }
}
