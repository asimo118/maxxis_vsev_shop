import {
  SEED_CAMPAIGN,
  SEED_CAMPAIGN_CONTENT,
  SEED_NOTIFICATION_TEMPLATES,
  SEED_SHOPS,
  SEED_VEHICLE_MODELS
} from "@vsev/shared";
import type { Container } from "./container";

/**
 * Idempotent seed: safe to run on every boot or manually. Prices, ratings, reviews and shop phone numbers
 * are placeholders — edit them in the admin console before launch.
 */
export async function seed(c: Container, opts: { adminEmail: string; adminPassword: string }): Promise<void> {
  // Master data from an external system (connector in "http" mode) is never overwritten by seed data.
  if (c.config.VEHICLE_SOURCE === "local") {
    for (const m of SEED_VEHICLE_MODELS) await c.repos.vehicle.upsertModel({ id: m.id, label: m.label });
  }
  if (c.config.SHOP_SOURCE === "local") {
    const existingShops = new Set((await c.repos.shops.listAll()).map((s) => s.id));
    for (const s of SEED_SHOPS) {
      if (!existingShops.has(s.id)) await c.repos.shops.create({ ...s, active: true });
    }
  }

  let campaign = await c.repos.catalog.findBySlug(SEED_CAMPAIGN.slug);
  if (!campaign) {
    campaign = await c.repos.catalog.create({
      id: SEED_CAMPAIGN.id,
      slug: SEED_CAMPAIGN.slug,
      title: SEED_CAMPAIGN.title,
      subtitle: SEED_CAMPAIGN.subtitle,
      productName: SEED_CAMPAIGN.productName,
      sizeLabel: SEED_CAMPAIGN.sizeLabel,
      includes: [...SEED_CAMPAIGN.includes],
      orderDeadline: new Date(SEED_CAMPAIGN.orderDeadline),
      installDeadline: new Date(SEED_CAMPAIGN.installDeadline),
      listPriceCents: SEED_CAMPAIGN.listPriceCents,
      salePriceCents: SEED_CAMPAIGN.salePriceCents,
      content: SEED_CAMPAIGN_CONTENT,
      eligibleModelIds: SEED_VEHICLE_MODELS.map((m) => m.id),
      status: "live"
    });
    // Assign only shops that exist (with an external directory, ids may differ — assign in the admin console).
    const known = new Set((await c.repos.shops.listAll()).map((s) => s.id));
    await c.repos.shops.setCampaignShops(campaign.id, SEED_SHOPS.map((s) => s.id).filter((id) => known.has(id)));
  }

  for (const t of SEED_NOTIFICATION_TEMPLATES) {
    if (!(await c.repos.notification.findTemplate(t.kind))) {
      await c.repos.notification.upsertTemplate({ kind: t.kind, title: t.title, body: t.body, enabled: true });
    }
  }

  // First boot only: never resets an existing admin, so passwords changed in the console survive restarts.
  await c.auth.ensureBootstrapAdmin({ email: opts.adminEmail, password: opts.adminPassword });
}
