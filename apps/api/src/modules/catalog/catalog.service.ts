import type {
  AdminCampaignDetailDto,
  AdminCampaignRowDto,
  CampaignPageDto,
  CampaignUpsertBody,
  Region,
  ShopDto
} from "@vsev/shared";
import type { Cache } from "../../platform/cache";
import type { Clock } from "../../platform/clock";
import { errors } from "../../platform/errors";
import type { EventBus } from "../../platform/events";
import type { ShopNetworkService } from "../shop-network/shop-network.service";
import type { VehicleService } from "../vehicle/vehicle.service";
import type { CampaignRecord, CatalogRepository } from "./catalog.repository";

const PAGE_TTL_SECONDS = 300;
const pageKey = (slug: string): string => `campaign:${slug}`;

export interface CatalogServiceDeps {
  repo: CatalogRepository;
  cache: Cache;
  shops: ShopNetworkService;
  vehicles: VehicleService;
  events: EventBus;
  clock: Clock;
}

export class CatalogService {
  constructor(private readonly deps: CatalogServiceDeps) {}

  /* ───────────── storefront ───────────── */

  /**
   * The whole campaign page (product + content + shops + eligible models) is cached as one blob,
   * keyed by slug, and actively invalidated whenever the campaign or its shops change.
   */
  async getPage(slug: string): Promise<CampaignPageDto> {
    const cached = await this.deps.cache.get<CampaignPageDto>(pageKey(slug));
    if (cached) return { ...cached, shops: this.deps.shops.refreshOpenNow(cached.shops) };

    const campaign = await this.deps.repo.findBySlug(slug);
    if (!campaign || campaign.status === "draft") throw errors.notFound("找不到這檔活動。");

    const page: CampaignPageDto = {
      id: campaign.id,
      slug: campaign.slug,
      title: campaign.title,
      subtitle: campaign.subtitle,
      status: campaign.status,
      orderDeadline: campaign.orderDeadline.toISOString(),
      installDeadline: campaign.installDeadline.toISOString(),
      product: {
        name: campaign.productName,
        sizeLabel: campaign.sizeLabel,
        listPriceCents: campaign.listPriceCents,
        salePriceCents: campaign.salePriceCents,
        includes: campaign.includes
      },
      eligibleModels: await this.deps.vehicles.listModelsByIds(campaign.eligibleModelIds),
      shops: await this.deps.shops.listForCampaign(campaign.id),
      content: campaign.content
    };
    await this.deps.cache.set(pageKey(slug), page, PAGE_TTL_SECONDS);
    return page;
  }

  async shopsForSlug(slug: string, region?: Region): Promise<ShopDto[]> {
    const page = await this.getPage(slug);
    return region ? page.shops.filter((s) => s.region === region) : page.shops;
  }

  /** Used by order.create — enforces "campaign is live and the order deadline has not passed". */
  async getOrderable(slug: string): Promise<CampaignRecord> {
    const campaign = await this.deps.repo.findBySlug(slug);
    if (!campaign) throw errors.notFound("找不到這檔活動。");
    if (campaign.status !== "live") throw errors.campaignNotLive();
    if (this.deps.clock.now().getTime() > campaign.orderDeadline.getTime()) throw errors.orderDeadlinePassed();
    return campaign;
  }

  async getById(id: string): Promise<CampaignRecord | null> {
    return this.deps.repo.findById(id);
  }

  /** Newest live campaign, else newest campaign — used as the dashboard default. */
  async currentCampaign(): Promise<CampaignRecord | null> {
    const all = await this.deps.repo.list();
    return all.find((c) => c.status === "live") ?? all[0] ?? null;
  }

  /* ───────────── admin ───────────── */

  async listAdmin(): Promise<AdminCampaignRowDto[]> {
    const campaigns = await this.deps.repo.list();
    return Promise.all(
      campaigns.map(async (c) => ({
        id: c.id,
        slug: c.slug,
        title: c.title,
        status: c.status,
        orderDeadline: c.orderDeadline.toISOString(),
        installDeadline: c.installDeadline.toISOString(),
        shopCount: (await this.deps.shops.assignedShopIds(c.id)).length
      }))
    );
  }

  async getAdmin(id: string): Promise<AdminCampaignDetailDto> {
    const campaign = await this.mustFind(id);
    return this.toDetail(campaign);
  }

  async create(body: CampaignUpsertBody): Promise<AdminCampaignDetailDto> {
    await this.validateBody(body);
    if (await this.deps.repo.findBySlug(body.slug)) throw errors.conflict("這個 slug 已被使用。");
    const created = await this.deps.repo.create(this.toInput(body));
    return this.toDetail(created);
  }

  async update(id: string, body: CampaignUpsertBody): Promise<AdminCampaignDetailDto> {
    const existing = await this.mustFind(id);
    if (body.slug !== existing.slug) throw errors.conflict("活動 slug 建立後不可變更，請改用複製。");
    await this.validateBody(body);
    const updated = await this.deps.repo.update(id, this.toInput(body));
    if (!updated) throw errors.notFound();
    await this.invalidate(updated);
    await this.deps.events.publish("campaign.updated", { campaignId: updated.id, slug: updated.slug });
    return this.toDetail(updated);
  }

  async publish(id: string): Promise<AdminCampaignDetailDto> {
    const campaign = await this.mustFind(id);
    if (campaign.status === "live") return this.toDetail(campaign);
    if ((await this.deps.shops.assignedShopIds(id)).length === 0) {
      throw errors.validation({ path: "shops", message: "發布前至少要指派一家安裝店家。" });
    }
    const updated = await this.deps.repo.update(id, { status: "live" });
    if (!updated) throw errors.notFound();
    await this.invalidate(updated);
    await this.deps.events.publish("campaign.published", { campaignId: updated.id, slug: updated.slug });
    return this.toDetail(updated);
  }

  async end(id: string): Promise<AdminCampaignDetailDto> {
    await this.mustFind(id);
    const updated = await this.deps.repo.update(id, { status: "ended" });
    if (!updated) throw errors.notFound();
    await this.invalidate(updated);
    return this.toDetail(updated);
  }

  /** New campaign slot from an existing one: same content/pricing/shops, back to draft. */
  async clone(id: string, newSlug: string): Promise<AdminCampaignDetailDto> {
    const source = await this.mustFind(id);
    if (await this.deps.repo.findBySlug(newSlug)) throw errors.conflict("這個 slug 已被使用。");
    const copy = await this.deps.repo.create({
      slug: newSlug,
      title: source.title,
      subtitle: source.subtitle,
      orderDeadline: source.orderDeadline,
      installDeadline: source.installDeadline,
      productName: source.productName,
      sizeLabel: source.sizeLabel,
      includes: [...source.includes],
      listPriceCents: source.listPriceCents,
      salePriceCents: source.salePriceCents,
      content: structuredClone(source.content),
      eligibleModelIds: [...source.eligibleModelIds],
      status: "draft"
    });
    await this.deps.shops.assignToCampaign(copy.id, await this.deps.shops.assignedShopIds(source.id));
    return this.toDetail(copy);
  }

  /** Event-driven invalidation: shop-network announces assignment changes, catalog drops the cached page. */
  async invalidateById(id: string): Promise<void> {
    const campaign = await this.deps.repo.findById(id);
    if (campaign) await this.invalidate(campaign);
  }

  async invalidateAll(): Promise<void> {
    for (const campaign of await this.deps.repo.list()) await this.invalidate(campaign);
  }

  async findRecordBySlug(slug: string): Promise<CampaignRecord | null> {
    return this.deps.repo.findBySlug(slug);
  }

  /* ───────────── helpers ───────────── */

  private async mustFind(id: string): Promise<CampaignRecord> {
    const campaign = await this.deps.repo.findById(id);
    if (!campaign) throw errors.notFound();
    return campaign;
  }

  private async invalidate(campaign: CampaignRecord): Promise<void> {
    await this.deps.cache.del(pageKey(campaign.slug));
  }

  private async validateBody(body: CampaignUpsertBody): Promise<void> {
    if (new Date(body.orderDeadline) >= new Date(body.installDeadline)) {
      throw errors.validation({ path: "installDeadline", message: "安裝期限必須晚於訂購截止時間。" });
    }
    if (body.salePriceCents > body.listPriceCents) {
      throw errors.validation({ path: "salePriceCents", message: "活動價不可高於原價。" });
    }
    const found = await this.deps.vehicles.listModelsByIds(body.eligibleModelIds);
    if (found.length !== new Set(body.eligibleModelIds).size) {
      throw errors.validation({ path: "eligibleModelIds", message: "包含不存在的車型。" });
    }
  }

  private toInput(body: CampaignUpsertBody): Omit<CampaignRecord, "id" | "createdAt" | "status"> {
    return {
      slug: body.slug,
      title: body.title,
      subtitle: body.subtitle,
      orderDeadline: new Date(body.orderDeadline),
      installDeadline: new Date(body.installDeadline),
      productName: body.productName,
      sizeLabel: body.sizeLabel,
      includes: body.includes,
      listPriceCents: body.listPriceCents,
      salePriceCents: body.salePriceCents,
      content: body.content,
      eligibleModelIds: body.eligibleModelIds
    };
  }

  private async toDetail(c: CampaignRecord): Promise<AdminCampaignDetailDto> {
    return {
      id: c.id,
      status: c.status,
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle,
      orderDeadline: c.orderDeadline.toISOString(),
      installDeadline: c.installDeadline.toISOString(),
      listPriceCents: c.listPriceCents,
      salePriceCents: c.salePriceCents,
      productName: c.productName,
      sizeLabel: c.sizeLabel,
      includes: c.includes,
      eligibleModelIds: c.eligibleModelIds,
      content: c.content,
      shopIds: await this.deps.shops.assignedShopIds(c.id)
    };
  }
}
