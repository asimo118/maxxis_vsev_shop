import { externalShop, externalVehicleModel, feedResponse, type ExternalShop, type ExternalVehicleModel } from "@vsev/shared";
import type { z } from "zod";
import type { HttpJsonClient } from "./http-json";

/** A master-data feed: the whole list, fetched and validated as one unit (all-or-nothing). */
export interface Feed<T> {
  fetchAll(): Promise<T[]>;
}

function uniqueIds<T extends { id: string }>(items: T[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const [i, item] of items.entries()) {
    if (seen.has(item.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: `duplicate id "${item.id}"` });
    seen.add(item.id);
  }
}

const vehicleFeedSchema = feedResponse(externalVehicleModel).superRefine(uniqueIds);
const shopFeedSchema = feedResponse(externalShop).superRefine(uniqueIds);

/** GET {VEHICLE_SOURCE_URL} → ExternalVehicleModel[] (see docs/connectors.md). */
export function createHttpVehicleFeed(client: HttpJsonClient, url: string): Feed<ExternalVehicleModel> {
  return { fetchAll: () => client.get(url, vehicleFeedSchema) };
}

/** GET {SHOP_SOURCE_URL} → ExternalShop[] (see docs/connectors.md). */
export function createHttpShopFeed(client: HttpJsonClient, url: string): Feed<ExternalShop> {
  return { fetchAll: () => client.get(url, shopFeedSchema) };
}
