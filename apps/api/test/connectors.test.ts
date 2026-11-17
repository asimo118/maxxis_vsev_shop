import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SEED_CAMPAIGN, type CommerceWebhookBody } from "@vsev/shared";
import { createMockExternalApp, signBody, type MockExternalState } from "../src/dev/mock-external";
import { loadConfig } from "../src/platform/config";
import { seed } from "../src/seed";
import { DRIVERS, buildTestApp, type Driver, type TestApp } from "./helpers";

const WEBHOOK_SECRET = "test-commerce-webhook-secret";
const TOKEN = "partner-api-token";

let server: Server;
let base: string;
let mock: MockExternalState;

beforeAll(async () => {
  const created = createMockExternalApp({ publicUrl: "http://cart.example.test", apiUrl: "http://unused", webhookSecret: WEBHOOK_SECRET, token: TOKEN });
  mock = created.state;
  await new Promise<void>((resolve) => {
    server = created.app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const resetMock = (): void => {
  const fresh = createMockExternalApp({ publicUrl: "", apiUrl: "", webhookSecret: "" }).state;
  mock.vehicles = fresh.vehicles;
  mock.shops = fresh.shops;
  mock.checkouts.clear();
  mock.failNext = null;
};

const feedEnv = () => ({
  VEHICLE_SOURCE: "http",
  VEHICLE_SOURCE_URL: `${base}/vehicle-models`,
  VEHICLE_SOURCE_TOKEN: TOKEN,
  SHOP_SOURCE: "http",
  SHOP_SOURCE_URL: `${base}/shops`,
  SHOP_SOURCE_TOKEN: TOKEN,
  CONNECTOR_TIMEOUT_MS: "600"
});
const commerceEnv = () => ({
  COMMERCE_CONNECTOR: "http",
  COMMERCE_API_URL: base,
  COMMERCE_API_TOKEN: TOKEN,
  COMMERCE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  COMMERCE_RETURN_URL: "https://shop.example.test/orders/{orderId}?from=checkout",
  COMMERCE_SKU_MAP: JSON.stringify({ [SEED_CAMPAIGN.slug]: "VSEVP-2454020-SET4" })
});

/** Boot like the real server: create → initial connector sync → seed. */
async function boot(driver: Driver, env: Record<string, string>): Promise<TestApp> {
  const t = await buildTestApp(driver, { env, seed: false });
  await t.c.connectors.syncAll();
  await seed(t.c, { adminEmail: "admin@vsev.local", adminPassword: "ChangeMe!2026" });
  return t;
}
async function adminToken(t: TestApp): Promise<string> {
  return (await request(t.app).post("/api/v1/admin/auth/login").send({ email: "admin@vsev.local", password: "ChangeMe!2026" })).body.token as string;
}
async function customer(t: TestApp): Promise<string> {
  return (await request(t.app).post("/api/v1/auth/register").send({ email: `c${Math.random()}@example.com`, password: "Passw0rd!x", name: "連接測試" })).body.token as string;
}
const orderBody = { campaignSlug: SEED_CAMPAIGN.slug, vehicleModelId: "m-ix2-xdrive30", plate: "CON-0001", shopId: "s-xiyun", deadlineAcknowledged: true };

let t: TestApp;

describe.each(DRIVERS)("%s driver", (driver) => {
  afterEach(async () => {
    await t.close();
    resetMock();
  });

  describe("vehicle + shop feeds (sync connectors)", () => {
    it("mirrors the external lists and the storefront reads them", async () => {
      mock.vehicles.push({ id: "m-ix1-edrive20", label: "BMW iX1 eDrive20（外部新增）", active: true });
      t = await boot(driver, feedEnv());
      const admin = await adminToken(t);

      const status = (await request(t.app).get("/api/v1/admin/connectors").set(auth(admin))).body;
      expect(status.map((s: { name: string; mode: string; lastResult: string | null }) => [s.name, s.mode, s.lastResult])).toEqual([
        ["vehicles", "http", "ok"],
        ["shops", "http", "ok"],
        ["commerce", "local", null]
      ]);
      expect(status[1]).toMatchObject({ lastCounts: { upserted: 19, deactivated: 0 }, endpointHost: base.replace("http://", "") });

      expect((await request(t.app).get("/api/v1/vehicle-models")).body.map((m: { id: string }) => m.id)).toContain("m-ix1-edrive20");
      const page = (await request(t.app).get(`/api/v1/campaigns/${SEED_CAMPAIGN.slug}`)).body;
      expect(page.shops).toHaveLength(19);
    });

    it("picks up upstream changes on the next sync, deactivating what disappeared", async () => {
      t = await boot(driver, feedEnv());
      const admin = await adminToken(t);
      await request(t.app).get(`/api/v1/campaigns/${SEED_CAMPAIGN.slug}`); // warm the page cache

      const first = mock.shops[0];
      if (!first) throw new Error("mock has no shops");
      first.name = "西運輪胎（更名）";
      mock.shops = mock.shops.filter((s) => s.id !== "s-weili");
      mock.vehicles = mock.vehicles.filter((v) => v.id !== "m-x2-m35i");

      const res = await request(t.app).post("/api/v1/admin/connectors/shops/sync").set(auth(admin));
      expect(res.body).toMatchObject({ lastResult: "ok", lastCounts: { upserted: 18, deactivated: 1 } });
      await request(t.app).post("/api/v1/admin/connectors/vehicles/sync").set(auth(admin));

      const page = (await request(t.app).get(`/api/v1/campaigns/${SEED_CAMPAIGN.slug}`)).body;
      expect(page.shops.find((s: { id: string }) => s.id === first.id).name).toBe("西運輪胎（更名）"); // cache was dropped
      expect(page.shops.some((s: { id: string }) => s.id === "s-weili")).toBe(false);
      expect(page.eligibleModels.some((m: { id: string }) => m.id === "m-x2-m35i")).toBe(false);
      // a deactivated model can no longer be ordered
      const u = await customer(t);
      const o = await request(t.app).post("/api/v1/orders").set(auth(u)).send({ ...orderBody, vehicleModelId: "m-x2-m35i" });
      expect(o.body.error.code).toBe("E2003");
    });

    it("makes shops read-only in the admin console", async () => {
      t = await boot(driver, feedEnv());
      const admin = await adminToken(t);
      const res = await request(t.app).post("/api/v1/admin/shops").set(auth(admin))
        .send({ name: "新店", region: "north", city: "台北", address: "台北市某路1號", hours: { open: "09:00", close: "18:00", days: [1] } });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("E2012");
      // campaign assignment stays a local decision
      expect((await request(t.app).put(`/api/v1/admin/campaigns/${SEED_CAMPAIGN.id}/shops`).set(auth(admin)).send({ shopIds: ["s-xiyun"] })).status).toBe(200);
    });

    it.each([
      ["http500", /HTTP 500/],
      ["badPayload", /broke the contract/],
      ["hang", /timed out after 600 ms/]
    ] as const)("keeps the last good data when the feed fails (%s)", async (failure, message) => {
      t = await boot(driver, feedEnv());
      const admin = await adminToken(t);
      mock.failNext = failure;
      const res = await request(t.app).post("/api/v1/admin/connectors/shops/sync").set(auth(admin));
      expect(res.body.lastResult).toBe("error");
      expect(res.body.lastMessage).toMatch(message);
      expect((await request(t.app).get(`/api/v1/campaigns/${SEED_CAMPAIGN.slug}`)).body.shops).toHaveLength(19);
    });

    it("refuses an empty feed or duplicate ids instead of wiping the shop list", async () => {
      t = await boot(driver, feedEnv());
      const admin = await adminToken(t);
      const shops = mock.shops;
      mock.shops = [];
      expect((await request(t.app).post("/api/v1/admin/connectors/shops/sync").set(auth(admin))).body.lastMessage).toMatch(/refusing/);
      const dup = shops[0];
      if (!dup) throw new Error("mock has no shops");
      mock.shops = [...shops, dup];
      expect((await request(t.app).post("/api/v1/admin/connectors/shops/sync").set(auth(admin))).body.lastMessage).toMatch(/duplicate id/);
      expect((await request(t.app).get(`/api/v1/campaigns/${SEED_CAMPAIGN.slug}`)).body.shops).toHaveLength(19);
    });

    it("rejects calls without the partner token", async () => {
      t = await boot(driver, { ...feedEnv(), SHOP_SOURCE_TOKEN: "wrong" });
      const status = t.c.connectors.get("shops");
      expect(status.lastResult).toBe("error");
      expect(status.lastMessage).toMatch(/HTTP 401/);
    });
  });

  describe("cart / checkout connector", () => {
    async function createOrder(): Promise<{ token: string; id: string }> {
      const token = await customer(t);
      const o = await request(t.app).post("/api/v1/orders").set(auth(token)).send(orderBody);
      expect(o.status).toBe(201);
      return { token, id: o.body.id as string };
    }
    const webhook = (event: CommerceWebhookBody, secret = WEBHOOK_SECRET) => {
      const raw = JSON.stringify(event);
      return request(t.app).post("/api/v1/connectors/commerce/webhook")
        .set("content-type", "application/json").set("x-vsev-signature", signBody(secret, raw)).send(raw);
    };

    it("hands the validated order to the external cart and returns its checkout URL", async () => {
      t = await boot(driver, commerceEnv());
      expect((await request(t.app).get("/api/v1/checkout-config")).body).toEqual({ mode: "external" });
      const { token, id } = await createOrder();
      const res = await request(t.app).post(`/api/v1/orders/${id}/checkout`).set(auth(token));
      expect(res.status).toBe(200);
      expect(res.body.mode).toBe("redirect");
      expect(res.body.url).toMatch(/^http:\/\/cart\.example\.test\/cart\/EXT-/);
      expect(res.body.order.status).toBe("created"); // paid only when the external system says so

      const [ref, sent] = [...mock.checkouts.entries()][0] ?? [];
      expect(sent).toMatchObject({
        orderId: id,
        sku: "VSEVP-2454020-SET4",
        productName: SEED_CAMPAIGN.productName,
        unitPriceCents: SEED_CAMPAIGN.salePriceCents,
        currency: "TWD",
        installShop: { id: "s-xiyun" },
        vehicle: { modelId: "m-ix2-xdrive30", plate: "CON-0001" },
        returnUrl: `https://shop.example.test/orders/${id}?from=checkout`
      });
      const admin = await adminToken(t);
      expect((await request(t.app).get(`/api/v1/admin/orders/${id}`).set(auth(admin))).body.externalRef).toBe(ref);
      // the built-in payment path is closed
      expect((await request(t.app).post(`/api/v1/orders/${id}/pay`).set(auth(token))).body.error.code).toBe("E2012");
    });

    it("applies signed webhooks once, and only for the matching external reference", async () => {
      t = await boot(driver, commerceEnv());
      const { token, id } = await createOrder();
      await request(t.app).post(`/api/v1/orders/${id}/checkout`).set(auth(token));
      const externalRef = [...mock.checkouts.keys()][0] ?? "";
      const paid: CommerceWebhookBody = { eventId: "evt-1", type: "order.paid", orderId: id, externalRef };

      expect((await webhook(paid, "forged-secret")).status).toBe(401);
      expect((await webhook({ ...paid, externalRef: "EXT-SOMEONE-ELSE" })).status).toBe(404);
      expect((await webhook(paid)).body).toEqual({ applied: true, status: "paid" });
      expect((await webhook(paid)).body).toEqual({ applied: false, status: "paid" }); // redelivery
      expect((await webhook({ ...paid, eventId: "evt-2", type: "order.cancelled" })).body).toEqual({ applied: false, status: "paid" });
      await t.queue.drain();
      expect(t.queue.pendingDelayed().filter((j) => j.jobId.startsWith(`remind__${id}`))).toHaveLength(3); // normal flow continues

      expect((await webhook({ ...paid, eventId: "evt-3", type: "order.refunded" })).body).toEqual({ applied: true, status: "refunded" });
      const mine = (await request(t.app).get(`/api/v1/me/orders/${id}`).set(auth(token))).body;
      expect(mine.events.map((e: { to: string; actor: string }) => `${e.to}:${e.actor}`).slice(1)).toEqual(["paid:commerce", "refunded:commerce"]);
    });

    it("leaves the order untouched when the external cart is down", async () => {
      t = await boot(driver, commerceEnv());
      const { token, id } = await createOrder();
      mock.failNext = "http500";
      const res = await request(t.app).post(`/api/v1/orders/${id}/checkout`).set(auth(token));
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe("E5001");
      expect(res.body.error.message).not.toMatch(/HTTP 500|127\.0\.0\.1/); // no internals leaked to customers
      expect(t.c.connectors.get("commerce")).toMatchObject({ mode: "http", lastResult: "error" });
      // retry works once the partner is back
      expect((await request(t.app).post(`/api/v1/orders/${id}/checkout`).set(auth(token))).body.mode).toBe("redirect");
    });

    it("keeps the built-in checkout when no cart connector is configured", async () => {
      t = await boot(driver, {});
      expect((await request(t.app).get("/api/v1/checkout-config")).body).toEqual({ mode: "internal" });
      const { token, id } = await createOrder();
      const res = await request(t.app).post(`/api/v1/orders/${id}/checkout`).set(auth(token));
      expect(res.body).toMatchObject({ mode: "internal", order: { status: "paid" } });
      expect((await request(t.app).post("/api/v1/connectors/commerce/webhook").send({})).status).toBe(404);
    });
  });
});

describe("connector configuration", () => {
  const baseEnv = { JWT_SECRET_STOREFRONT: "s".repeat(40), JWT_SECRET_ADMIN: "a".repeat(40) };
  it("requires URLs and the webhook secret for http mode", () => {
    expect(() => loadConfig({ ...baseEnv, SHOP_SOURCE: "http" })).toThrow(/SHOP_SOURCE_URL/);
    expect(() => loadConfig({ ...baseEnv, COMMERCE_CONNECTOR: "http", COMMERCE_API_URL: "https://x.test" })).toThrow(/COMMERCE_WEBHOOK_SECRET/);
    expect(() => loadConfig({ ...baseEnv, COMMERCE_SKU_MAP: "not json" })).toThrow(/COMMERCE_SKU_MAP/);
    expect(loadConfig({ ...baseEnv, VEHICLE_SOURCE_URL: "", COMMERCE_SKU_MAP: "" }).COMMERCE_SKU_MAP).toEqual({}); // blank = unset
  });
  it("lets production run without the mock-gateway check when an external cart takes the money", () => {
    const prod = { ...baseEnv, NODE_ENV: "production", DATA_DRIVER: "sqlite" };
    expect(() => loadConfig(prod)).toThrow(/PAYMENT_GATEWAY/);
    expect(() => loadConfig({ ...prod, ...{ COMMERCE_CONNECTOR: "http", COMMERCE_API_URL: "https://x.test", COMMERCE_WEBHOOK_SECRET: "k" } })).not.toThrow();
    // staging: explicit opt-in to the mock gateway
    expect(() => loadConfig({ ...prod, ALLOW_MOCK_PAYMENTS: "true" })).not.toThrow();
    expect(() => loadConfig({ ...prod, TRUST_PROXY: "9" })).toThrow(/TRUST_PROXY/);
  });
});
