import type { EventBus } from "../../platform/events";
import type { CatalogService } from "./catalog.service";

/** The cached campaign page embeds shops, so shop-network changes must drop it. */
export function registerCatalogSubscribers(deps: { events: EventBus; catalog: CatalogService }): void {
  deps.events.subscribe("campaign.shops_changed", ({ campaignId }) => deps.catalog.invalidateById(campaignId));
  deps.events.subscribe("shop.changed", () => deps.catalog.invalidateAll());
}
