import type { CampaignStatus, DashboardDto, FunnelStepDto, OwnerRowDto, TrackBody } from "@vsev/shared";
import type { Clock } from "../../platform/clock";
import type { CatalogService } from "../catalog/catalog.service";
import type { ReportingRepository } from "./reporting.repository";

const FUNNEL: { key: string; label: string }[] = [
  { key: "page_view", label: "瀏覽活動頁" },
  { key: "model_selected", label: "選擇車型" },
  { key: "shop_selected", label: "選擇店家" },
  { key: "deadline_acknowledged", label: "確認安裝期限" },
  { key: "checkout_started", label: "進入結帳" }
];

export class ReportingService {
  constructor(private readonly deps: { repo: ReportingRepository; catalog: CatalogService; clock: Clock }) {}

  track(body: TrackBody): Promise<void> {
    return this.deps.repo.recordFunnelEvent(body.sessionId, body.event, body.campaignSlug);
  }

  async dashboard(): Promise<DashboardDto> {
    const current = await this.deps.catalog.currentCampaign();
    if (!current) {
      return { campaign: null, funnel: [], kpis: { orders: 0, paidRevenueCents: 0, installed: 0, atRisk: 0 }, byShop: [], byStatus: [] };
    }
    const counts = await this.deps.repo.funnelCounts(current.slug);
    const agg = await this.deps.repo.orderAggregates(current.id, this.deps.clock.now());
    const funnel: FunnelStepDto[] = [
      ...FUNNEL.map((f) => ({ key: f.key, label: f.label, count: counts[f.key] ?? 0 })),
      { key: "ordered", label: "建立訂單", count: agg.created },
      { key: "paid", label: "完成付款", count: agg.paid },
      { key: "installed", label: "完成安裝", count: agg.installed }
    ];
    return {
      campaign: { slug: current.slug, title: current.title, status: current.status as CampaignStatus },
      funnel,
      kpis: { orders: agg.created, paidRevenueCents: agg.paidRevenueCents, installed: agg.installed, atRisk: agg.atRisk },
      byShop: agg.byShop,
      byStatus: agg.byStatus
    };
  }

  owners(): Promise<OwnerRowDto[]> {
    return this.deps.repo.ownerRows();
  }
}
