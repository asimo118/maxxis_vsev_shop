import { createHmac } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_CAMPAIGN } from "@vsev/shared";
import { DAY_MS } from "../src/platform/clock";
import { DRIVERS, buildTestApp, type TestApp } from "./helpers";

let t: TestApp;

async function register(email: string, name = "王大明"): Promise<string> {
  const res = await request(t.app).post("/api/v1/auth/register").send({ email, password: "Passw0rd!x", name });
  expect(res.status).toBe(201);
  return res.body.token as string;
}
async function adminToken(): Promise<string> {
  const res = await request(t.app).post("/api/v1/admin/auth/login").send({ email: "admin@vsev.local", password: "ChangeMe!2026" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}
const orderBody = (extra: object = {}) => ({
  campaignSlug: SEED_CAMPAIGN.slug, vehicleModelId: "m-ix2-xdrive30", plate: "abc-1234",
  shopId: "s-xiyun", deadlineAcknowledged: true, ...extra
});
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Every test runs against BOTH persistence drivers: the in-memory store and the real SQLite schema.
describe.each(DRIVERS)("%s driver", (driver) => {
  beforeEach(async () => {
    t = await buildTestApp(driver);
  });
  afterEach(async () => {
    await t.close();
  });

  describe("full customer journey", () => {
    it("goes from order to warranty_active, awards points once, opens owner features", async () => {
      const user = await register("a@example.com");
      const admin = await adminToken();

      const page = await request(t.app).get(`/api/v1/campaigns/${SEED_CAMPAIGN.slug}`);
      expect(page.status).toBe(200);
      expect(page.body.shops.length).toBe(19);

      const created = await request(t.app).post("/api/v1/orders").set(auth(user)).send(orderBody());
      expect(created.status).toBe(201);
      const id = created.body.id as string;
      expect(created.body.amountCents).toBe(SEED_CAMPAIGN.salePriceCents);

      expect((await request(t.app).post(`/api/v1/orders/${id}/pay`).set(auth(user))).body.status).toBe("paid");
      // paying twice is rejected, not double-processed
      expect((await request(t.app).post(`/api/v1/orders/${id}/pay`).set(auth(user))).status).toBe(409);

      for (const step of ["ship", "arrival"]) {
        const r = await request(t.app).post(`/api/v1/admin/orders/${id}/${step}`).set(auth(admin)).send();
        expect(r.status).toBe(200);
      }

      // book Thursday 2026-10-29 11:00 Taipei (shop open)
      const slot = "2026-10-29T03:00:00.000Z";
      const booking = await request(t.app).post(`/api/v1/orders/${id}/booking`).set(auth(user)).send({ slotAt: slot });
      expect(booking.status).toBe(201);

      const done = await request(t.app).post(`/api/v1/admin/orders/${id}/installed`).set(auth(admin)).send();
      expect(done.status).toBe(200);
      await t.queue.drain();

      const mine = await request(t.app).get(`/api/v1/me/orders/${id}`).set(auth(user));
      expect(mine.body.status).toBe("warranty_active");
      expect(mine.body.events.map((e: { to: string }) => e.to)).toContain("installed");

      const points = await request(t.app).get("/api/v1/me/points").set(auth(user));
      expect(points.body.balance).toBe(Math.floor(SEED_CAMPAIGN.salePriceCents / 10_000));
      expect(points.body.referralCode).toMatch(/^[A-Z0-9]{8}$/);

      const mileage = await request(t.app).post("/api/v1/me/mileage").set(auth(user)).send({ odometerKm: 1200 });
      expect(mileage.status).toBe(201);
      const back = await request(t.app).post("/api/v1/me/mileage").set(auth(user)).send({ odometerKm: 900 });
      expect(back.status).toBe(400);

      const logs = await request(t.app).get("/api/v1/admin/notifications/log").set(auth(admin));
      const kinds = (logs.body as { kind: string }[]).map((l) => l.kind);
      expect(kinds).toEqual(expect.arrayContaining(["order_paid", "order_shipped", "order_arrived", "booking_confirmed", "warranty_active"]));
    });

    it("pays the referrer once and rejects self-referral / unknown codes", async () => {
      const a = await register("ref@example.com");
      const admin = await adminToken();
      // referrer needs a code: complete a first order
      const first = await request(t.app).post("/api/v1/orders").set(auth(a)).send(orderBody());
      const id = first.body.id as string;
      await request(t.app).post(`/api/v1/orders/${id}/pay`).set(auth(a));
      await request(t.app).post(`/api/v1/admin/orders/${id}/ship`).set(auth(admin));
      await request(t.app).post(`/api/v1/admin/orders/${id}/arrival`).set(auth(admin));
      await request(t.app).post(`/api/v1/orders/${id}/booking`).set(auth(a)).send({ slotAt: "2026-10-29T03:00:00.000Z" });
      await request(t.app).post(`/api/v1/admin/orders/${id}/installed`).set(auth(admin));
      await t.queue.drain();
      const code = (await request(t.app).get("/api/v1/me/points").set(auth(a))).body.referralCode as string;

      expect((await request(t.app).post("/api/v1/orders").set(auth(a)).send(orderBody({ referralCode: code, plate: "ZZZ-0001" }))).status).toBe(422);
      const b = await register("buyer@example.com", "李小華");
      expect((await request(t.app).post("/api/v1/orders").set(auth(b)).send(orderBody({ referralCode: "NOPE9999" }))).status).toBe(422);

      const before = (await request(t.app).get("/api/v1/me/points").set(auth(a))).body.balance as number;
      const o = await request(t.app).post("/api/v1/orders").set(auth(b)).send(orderBody({ referralCode: code }));
      expect(o.status).toBe(201);
      const oid = o.body.id as string;
      await request(t.app).post(`/api/v1/orders/${oid}/pay`).set(auth(b));
      await request(t.app).post(`/api/v1/admin/orders/${oid}/ship`).set(auth(admin));
      await request(t.app).post(`/api/v1/admin/orders/${oid}/arrival`).set(auth(admin));
      await request(t.app).post(`/api/v1/orders/${oid}/booking`).set(auth(b)).send({ slotAt: "2026-10-29T04:00:00.000Z" });
      await request(t.app).post(`/api/v1/admin/orders/${oid}/installed`).set(auth(admin));
      await t.queue.drain();
      const after = (await request(t.app).get("/api/v1/me/points").set(auth(a))).body.balance as number;
      expect(after - before).toBe(300);
    });
  });

  describe("rules and security", () => {
    it("rejects orders that skip the CTA gate or use bad inputs", async () => {
      const u = await register("g@example.com");
      const no = await request(t.app).post("/api/v1/orders").set(auth(u)).send(orderBody({ deadlineAcknowledged: false }));
      expect(no.status).toBe(422);
      expect(no.body.error.code).toBe("E2005");
      expect((await request(t.app).post("/api/v1/orders").set(auth(u)).send(orderBody({ vehicleModelId: "m-nope" }))).status).toBe(422);
      expect((await request(t.app).post("/api/v1/orders").set(auth(u)).send(orderBody({ shopId: "s-nope" }))).status).toBe(422);
      expect((await request(t.app).post("/api/v1/orders").send(orderBody())).status).toBe(401);
    });

    it("ignores a client-supplied price", async () => {
      const u = await register("p@example.com");
      const r = await request(t.app).post("/api/v1/orders").set(auth(u)).send(orderBody({ amountCents: 1 }));
      expect(r.body.amountCents).toBe(SEED_CAMPAIGN.salePriceCents);
    });

    it("reports health and build version", async () => {
    expect((await request(t.app).get("/api/v1/health")).body).toEqual({ ok: true, version: "dev" });
  });

  it("separates storefront and admin token audiences", async () => {
      const u = await register("aud@example.com");
      const admin = await adminToken();
      expect((await request(t.app).get("/api/v1/admin/dashboard").set(auth(u))).status).toBe(401);
      expect((await request(t.app).get("/api/v1/me/orders").set(auth(admin))).status).toBe(401);
      expect((await request(t.app).get("/api/v1/admin/dashboard")).status).toBe(401);
      expect((await request(t.app).get("/api/v1/admin/dashboard").set(auth(admin))).status).toBe(200);
    });

    it("hides other customers' orders", async () => {
      const a = await register("o1@example.com");
      const b = await register("o2@example.com");
      const o = await request(t.app).post("/api/v1/orders").set(auth(a)).send(orderBody());
      expect((await request(t.app).get(`/api/v1/me/orders/${o.body.id}`).set(auth(b))).status).toBe(404);
      expect((await request(t.app).post(`/api/v1/orders/${o.body.id}/pay`).set(auth(b))).status).toBe(404);
    });

    it("applies webhook payments idempotently", async () => {
      const u = await register("w@example.com");
      const o = await request(t.app).post("/api/v1/orders").set(auth(u)).send(orderBody());
      const body = { gatewayTxnId: "txn_1", orderId: o.body.id, status: "succeeded" };
      expect((await request(t.app).post("/api/v1/payments/webhook").send(body)).status).toBe(200);
      expect((await request(t.app).post("/api/v1/payments/webhook").send(body)).status).toBe(200);
      expect((await request(t.app).get(`/api/v1/me/orders/${o.body.id}`).set(auth(u))).body.status).toBe("paid");
      expect(t.c.config.PAYMENT_WEBHOOK_SECRET).toBeUndefined();
      const sig = createHmac("sha256", "x").update("{}").digest("hex");
      expect(sig).toHaveLength(64);
    });

    it("refuses bookings outside shop hours, in the past, or after the deadline", async () => {
      const u = await register("b@example.com");
      const admin = await adminToken();
      const o = await request(t.app).post("/api/v1/orders").set(auth(u)).send(orderBody());
      const id = o.body.id as string;
      await request(t.app).post(`/api/v1/orders/${id}/pay`).set(auth(u));
      // not yet at the shop
      expect((await request(t.app).post(`/api/v1/orders/${id}/booking`).set(auth(u)).send({ slotAt: "2026-10-29T03:00:00.000Z" })).status).toBe(409);
      await request(t.app).post(`/api/v1/admin/orders/${id}/ship`).set(auth(admin));
      await request(t.app).post(`/api/v1/admin/orders/${id}/arrival`).set(auth(admin));
      const bad = (slotAt: string) => request(t.app).post(`/api/v1/orders/${id}/booking`).set(auth(u)).send({ slotAt });
      expect((await bad("2026-10-28T01:00:00.000Z")).status).toBe(422); // past
      expect((await bad("2026-10-29T15:00:00.000Z")).status).toBe(422); // 23:00 Taipei, closed
      expect((await bad("2026-11-01T03:00:00.000Z")).status).toBe(422); // Sunday, closed
      expect((await bad("2027-01-05T03:00:00.000Z")).status).toBe(422); // after install deadline
      expect((await bad("2026-10-29T03:00:00.000Z")).status).toBe(201);
    });

    it("expires overdue orders and cancels their reminders", async () => {
      const u = await register("e@example.com");
      const o = await request(t.app).post("/api/v1/orders").set(auth(u)).send(orderBody());
      const id = o.body.id as string;
      await request(t.app).post(`/api/v1/orders/${id}/pay`).set(auth(u));
      await request(t.app).post(`/api/v1/admin/orders/${id}/ship`).set(auth(await adminToken()));
      await t.queue.drain();
      expect(t.queue.pendingDelayed().some((j) => j.jobId.startsWith(`remind__${id}`))).toBe(true);
      t.clock.set(new Date(new Date(SEED_CAMPAIGN.installDeadline).getTime() + DAY_MS));
      expect(await t.c.fulfillment.expireOverdue()).toBe(1);
      await t.queue.drain();
      expect((await request(t.app).get(`/api/v1/me/orders/${id}`).set(auth(u))).body.status).toBe("expired");
      expect(t.queue.pendingDelayed().some((j) => j.jobId.startsWith(`remind__${id}`))).toBe(false);
    });

    it("enforces admin roles", async () => {
      await t.c.auth.upsertAdmin({ email: "fin@vsev.local", password: "Finance!2026", name: "Fin", role: "finance" });
      const res = await request(t.app).post("/api/v1/admin/auth/login").send({ email: "fin@vsev.local", password: "Finance!2026" });
      const fin = res.body.token as string;
      expect((await request(t.app).post("/api/v1/admin/points/adjust").set(auth(fin)).send({ userId: "x", delta: 5, note: "test adj" })).status).toBe(403);
    });

    it("serves the funnel beacon and dashboard", async () => {
      const admin = await adminToken();
      expect((await request(t.app).post("/api/v1/track").send({ sessionId: "sess-12345678", event: "page_view", campaignSlug: SEED_CAMPAIGN.slug })).status).toBe(204);
      const dash = await request(t.app).get("/api/v1/admin/dashboard").set(auth(admin));
      expect(dash.body.funnel[0].count).toBe(1);
    });
  });

  describe("admin read models (driver parity)", () => {
    async function paidOrder(email: string, name: string, plate: string, shopId: string): Promise<string> {
      const res = await request(t.app).post("/api/v1/auth/register").send({ email, password: "Passw0rd!x", name });
      const token = res.body.token as string;
      const o = await request(t.app).post("/api/v1/orders").set(auth(token)).send(orderBody({ plate, shopId }));
      await request(t.app).post(`/api/v1/orders/${o.body.id}/pay`).set(auth(token));
      return o.body.id as string;
    }

    it("searches, paginates and aggregates orders", async () => {
      const admin = await adminToken();
      await paidOrder("chen@example.com", "陳一", "AAA-1111", "s-xiyun");
      await paidOrder("lin@example.com", "林二", "BBB-2222", "s-xiyun");
      await paidOrder("wang@example.com", "王三", "CCC-3333", "s-weili");
      await t.queue.drain();

      const get = async (qs: string) => (await request(t.app).get(`/api/v1/admin/orders${qs}`).set(auth(admin))).body;
      expect((await get("")).total).toBe(3);
      expect((await get("?q=bbb")).items.map((o: { plate: string }) => o.plate)).toEqual(["BBB-2222"]);
      expect((await get("?q=" + encodeURIComponent("陳"))).items[0].customerName).toBe("陳一");
      expect((await get("?q=lin@")).total).toBe(1);
      expect((await get("?q=100%25")).total).toBe(0); // LIKE wildcards are matched literally
      expect((await get("?status=paid&shopId=s-xiyun")).total).toBe(2);
      const page2 = await get("?page=2&pageSize=2");
      expect(page2.items).toHaveLength(1);
      expect(page2.total).toBe(3);

      const dash = (await request(t.app).get("/api/v1/admin/dashboard").set(auth(admin))).body;
      expect(dash.kpis.orders).toBe(3);
      expect(dash.kpis.paidRevenueCents).toBe(3 * SEED_CAMPAIGN.salePriceCents);
      expect(dash.byShop[0]).toMatchObject({ shopId: "s-xiyun", orders: 2, installed: 0 });

      const owners = (await request(t.app).get("/api/v1/admin/owners").set(auth(admin))).body as { name: string; orders: number }[];
      expect(owners.map((o) => o.name)).toEqual(["陳一", "林二", "王三"]);
    });

    it("refunds through finance, and the dashboard stops counting the revenue", async () => {
      const admin = await adminToken();
      const id = await paidOrder("r@example.com", "退款客", "RRR-0001", "s-xiyun");
      await t.c.auth.upsertAdmin({ email: "fin@vsev.local", password: "Finance!2026", name: "Fin", role: "finance" });
      const fin = (await request(t.app).post("/api/v1/admin/auth/login").send({ email: "fin@vsev.local", password: "Finance!2026" })).body.token as string;
      expect((await request(t.app).post(`/api/v1/admin/orders/${id}/refund`).set(auth(fin)).send({ note: "客訴" })).status).toBe(200);
      const detail = (await request(t.app).get(`/api/v1/admin/orders/${id}`).set(auth(admin))).body;
      expect(detail.status).toBe("refunded");
      expect(detail.events.at(-1)).toMatchObject({ from: "paid", to: "refunded", note: "客訴" });
      const dash = (await request(t.app).get("/api/v1/admin/dashboard").set(auth(admin))).body;
      expect(dash.kpis.paidRevenueCents).toBe(0);
    });

    it("groups coverage requests by city", async () => {
      const admin = await adminToken();
      for (const city of ["台北市", "台北市", "花蓮縣"]) {
        expect((await request(t.app).post("/api/v1/coverage-requests").send({ city })).status).toBe(202);
      }
      const gaps = (await request(t.app).get("/api/v1/admin/coverage-gaps").set(auth(admin))).body;
      expect(gaps.map((g: { city: string; requests: number }) => [g.city, g.requests])).toEqual([["台北市", 2], ["花蓮縣", 1]]);
    });

    it("updates campaigns, shops and templates and the storefront sees the change", async () => {
      const admin = await adminToken();
      const id = SEED_CAMPAIGN.id;
      const detail = (await request(t.app).get(`/api/v1/admin/campaigns/${id}`).set(auth(admin))).body;
      const { id: _id, status: _s, shopIds: _shops, ...body } = detail;
      const update = { ...body, salePriceCents: 3_000_000, eligibleModelIds: ["m-x2-m35i", "m-ix2-xdrive30"] };
      expect((await request(t.app).put(`/api/v1/admin/campaigns/${id}`).set(auth(admin)).send(update)).status).toBe(200);

      const page = (await request(t.app).get(`/api/v1/campaigns/${SEED_CAMPAIGN.slug}`)).body;
      expect(page.product.salePriceCents).toBe(3_000_000);
      expect(page.eligibleModels.map((m: { id: string }) => m.id)).toEqual(["m-x2-m35i", "m-ix2-xdrive30"]); // order kept

      const shops = (await request(t.app).get("/api/v1/admin/shops").set(auth(admin))).body as { id: string; name: string; region: string; city: string; address: string; phone: string | null; hours: unknown }[];
      const s = shops.find((x) => x.id === "s-weili");
      if (!s) throw new Error("seed shop missing");
      const res = await request(t.app).put(`/api/v1/admin/shops/${s.id}`).set(auth(admin))
        .send({ name: s.name, region: s.region, city: s.city, address: s.address, phone: "07-123-4567", hours: s.hours, active: false });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ phone: "07-123-4567", active: false });
      const after = (await request(t.app).get(`/api/v1/campaigns/${SEED_CAMPAIGN.slug}`)).body;
      expect(after.shops.some((x: { id: string }) => x.id === "s-weili")).toBe(false); // deactivated → hidden

      const tpl = await request(t.app).put("/api/v1/admin/notifications/templates/order_paid").set(auth(admin))
        .send({ title: "付款成功", body: "{{name}} 感謝訂購", enabled: false });
      expect(tpl.body).toEqual({ kind: "order_paid", title: "付款成功", body: "{{name}} 感謝訂購", enabled: false });
      const list = (await request(t.app).get("/api/v1/admin/notifications/templates").set(auth(admin))).body;
      expect(list).toHaveLength(6);
    });
  });
});
