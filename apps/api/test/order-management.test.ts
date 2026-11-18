import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_CAMPAIGN, orderRules } from "@vsev/shared";
import { DRIVERS, buildTestApp, type TestApp } from "./helpers";

let t: TestApp;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const SLOT_THU_11 = "2026-10-29T03:00:00.000Z"; // Thu 11:00 Taipei
const SLOT_FRI_14 = "2026-10-30T06:00:00.000Z"; // Fri 14:00 Taipei

async function customer(): Promise<string> {
  const res = await request(t.app).post("/api/v1/auth/register").send({ email: `c${Math.random()}@example.com`, password: "Passw0rd!x", name: "訂單管理" });
  return res.body.token as string;
}
async function admin(role: "manager" | "operator" | "finance" = "manager"): Promise<string> {
  if (role !== "manager") await t.c.auth.upsertAdmin({ email: `${role}@vsev.local`, password: "Role!2026x", name: role, role });
  const [email, password] = role === "manager" ? ["admin@vsev.local", "ChangeMe!2026"] : [`${role}@vsev.local`, "Role!2026x"];
  return (await request(t.app).post("/api/v1/admin/auth/login").send({ email, password })).body.token as string;
}
async function newOrder(token: string, paid = true): Promise<string> {
  const o = await request(t.app).post("/api/v1/orders").set(auth(token)).send({
    campaignSlug: SEED_CAMPAIGN.slug, vehicleModelId: "m-ix2-xdrive30", plate: "OMS-0001", shopId: "s-xiyun", deadlineAcknowledged: true
  });
  expect(o.status).toBe(201);
  if (paid) await request(t.app).post(`/api/v1/orders/${o.body.id}/pay`).set(auth(token));
  return o.body.id as string;
}
const mine = async (token: string, id: string) => (await request(t.app).get(`/api/v1/me/orders/${id}`).set(auth(token))).body;
const step = (adminToken: string, id: string, path: string, body: object = {}) =>
  request(t.app).post(`/api/v1/admin/orders/${id}/${path}`).set(auth(adminToken)).send(body);

describe("shared order rules", () => {
  it("encode which edits each status allows", () => {
    const r = (status: Parameters<typeof orderRules.canChangeShop>[0]["status"], cancelRequestedAt: string | null = null) => ({ status, cancelRequestedAt });
    expect(orderRules.canChangeShop(r("paid"))).toBe(true);
    expect(orderRules.canChangeShop(r("shipped"))).toBe(false);
    expect(orderRules.canChangeVehicle(r("booked"))).toBe(true);
    expect(orderRules.canChangeVehicle(r("installed"))).toBe(false);
    expect(orderRules.canCancel(r("created"))).toBe(true);
    expect(orderRules.canRequestCancel(r("paid"))).toBe(true);
    expect(orderRules.canRequestCancel(r("paid", "2026-10-28T00:00:00Z"))).toBe(false);
    expect(orderRules.canRequestCancel(r("warranty_active"))).toBe(false);
  });
});

describe.each(DRIVERS)("%s driver", (driver) => {
  beforeEach(async () => {
    t = await buildTestApp(driver);
  });
  afterEach(async () => {
    await t.close();
  });

  describe("customer edits", () => {
    it("changes the install shop before shipping, and is refused after", async () => {
      const u = await customer();
      const a = await admin();
      const id = await newOrder(u);
      const res = await request(t.app).patch(`/api/v1/me/orders/${id}`).set(auth(u)).send({ shopId: "s-weili" });
      expect(res.status).toBe(200);
      expect(res.body.shopId).toBe("s-weili");
      const change = res.body.events.find((e: { kind: string }) => e.kind === "change");
      expect(change.note).toMatch(/安裝店家：.+ → /);
      expect(change.actor).toMatch(/^user:/);

      expect((await request(t.app).patch(`/api/v1/me/orders/${id}`).set(auth(u)).send({ shopId: "s-nope" })).status).toBe(422);
      await step(a, id, "ship");
      const late = await request(t.app).patch(`/api/v1/me/orders/${id}`).set(auth(u)).send({ shopId: "s-xiyun" });
      expect(late.status).toBe(409);
      expect(late.body.error.code).toBe("E2013");
    });

    it("changes vehicle model and plate until installation, validating eligibility", async () => {
      const u = await customer();
      const id = await newOrder(u);
      const res = await request(t.app).patch(`/api/v1/me/orders/${id}`).set(auth(u)).send({ vehicleModelId: "m-x2-m35i", plate: "new-9999" });
      expect(res.body).toMatchObject({ vehicleModelId: "m-x2-m35i", plate: "NEW-9999" });
      expect((await request(t.app).patch(`/api/v1/me/orders/${id}`).set(auth(u)).send({ vehicleModelId: "m-nope" })).status).toBe(422);
      expect((await request(t.app).patch(`/api/v1/me/orders/${id}`).set(auth(u)).send({})).status).toBe(400);
      // no-op edits leave no audit noise
      const before = (await mine(u, id)).events.length;
      await request(t.app).patch(`/api/v1/me/orders/${id}`).set(auth(u)).send({ plate: "NEW-9999" });
      expect((await mine(u, id)).events.length).toBe(before);
    });

    it("cannot touch someone else's order", async () => {
      const id = await newOrder(await customer());
      const other = await customer();
      expect((await request(t.app).patch(`/api/v1/me/orders/${id}`).set(auth(other)).send({ plate: "XXX-0001" })).status).toBe(404);
      expect((await request(t.app).post(`/api/v1/orders/${id}/cancel-request`).set(auth(other)).send({ reason: "不要了" })).status).toBe(404);
    });
  });

  describe("cancellation", () => {
    it("cancels an unpaid order immediately", async () => {
      const u = await customer();
      const id = await newOrder(u, false);
      const res = await request(t.app).post(`/api/v1/orders/${id}/cancel-request`).set(auth(u)).send({ reason: "訂錯了" });
      expect(res.body.status).toBe("cancelled");
      expect(res.body.cancelRequest).toBeNull();
    });

    it("turns a paid cancellation into a request an admin settles", async () => {
      const u = await customer();
      const a = await admin();
      const id = await newOrder(u);
      const req1 = await request(t.app).post(`/api/v1/orders/${id}/cancel-request`).set(auth(u)).send({ reason: "要換車了" });
      expect(req1.body).toMatchObject({ status: "paid", cancelRequest: { reason: "要換車了" } });
      expect((await request(t.app).post(`/api/v1/orders/${id}/cancel-request`).set(auth(u)).send({ reason: "再一次" })).status).toBe(409);

      // the admin's to-do list
      expect((await request(t.app).get("/api/v1/admin/orders/summary").set(auth(a))).body).toMatchObject({ cancelRequests: 1, total: 1 });
      const list = (await request(t.app).get("/api/v1/admin/orders?cancelRequested=true").set(auth(a))).body;
      expect(list.items.map((o: { id: string; cancelRequested: boolean }) => [o.id, o.cancelRequested])).toEqual([[id, true]]);

      // declined, with a reason the customer can read
      expect((await step(a, id, "cancel-request/dismiss", { note: "輪胎已調貨" })).status).toBe(200);
      const afterDismiss = await mine(u, id);
      expect(afterDismiss.cancelRequest).toBeNull();
      expect(afterDismiss.events.at(-1).note).toBe("取消申請未核准：輪胎已調貨");

      // asks again → refund settles the request
      await request(t.app).post(`/api/v1/orders/${id}/cancel-request`).set(auth(u)).send({ reason: "還是要取消" });
      expect((await step(a, id, "refund", { note: "同意退款" })).body).toMatchObject({ status: "refunded", cancelRequest: null });
      expect((await request(t.app).get("/api/v1/admin/orders/summary").set(auth(a))).body.cancelRequests).toBe(0);
    });

    it("lets the customer withdraw a request", async () => {
      const u = await customer();
      const id = await newOrder(u);
      await request(t.app).post(`/api/v1/orders/${id}/cancel-request`).set(auth(u)).send({ reason: "考慮中" });
      const res = await request(t.app).delete(`/api/v1/orders/${id}/cancel-request`).set(auth(u));
      expect(res.body.cancelRequest).toBeNull();
      expect((await request(t.app).delete(`/api/v1/orders/${id}/cancel-request`).set(auth(u))).status).toBe(409);
    });

    it("clears a pending request when the order is installed", async () => {
      const u = await customer();
      const a = await admin();
      const id = await newOrder(u);
      await step(a, id, "ship");
      await step(a, id, "arrival");
      await request(t.app).post(`/api/v1/orders/${id}/booking`).set(auth(u)).send({ slotAt: SLOT_THU_11 });
      await request(t.app).post(`/api/v1/orders/${id}/cancel-request`).set(auth(u)).send({ reason: "臨時有事" });
      await step(a, id, "installed");
      expect((await mine(u, id)).cancelRequest).toBeNull();
      expect((await request(t.app).post(`/api/v1/orders/${id}/cancel-request`).set(auth(u)).send({ reason: "太晚了" })).body.error.code).toBe("E2013");
    });
  });

  describe("tracking and booking", () => {
    it("shows the carrier and tracking number from shipping, editable afterwards", async () => {
      const u = await customer();
      const a = await admin();
      const id = await newOrder(u);
      expect((await request(t.app).patch(`/api/v1/admin/orders/${id}`).set(auth(a)).send({ trackingNumber: "TOO-EARLY" })).status).toBe(409);
      await step(a, id, "ship", { carrier: "黑貓宅急便", trackingNumber: "9012-3456-7890" });
      expect((await mine(u, id)).shipment).toEqual({ carrier: "黑貓宅急便", trackingNumber: "9012-3456-7890" });
      await request(t.app).patch(`/api/v1/admin/orders/${id}`).set(auth(a)).send({ trackingNumber: "9012-3456-7891" });
      const o = await mine(u, id);
      expect(o.shipment.trackingNumber).toBe("9012-3456-7891");
      expect(o.events.at(-1)).toMatchObject({ kind: "change", note: "物流：黑貓宅急便 9012-3456-7891" });
    });

    it("reschedules a booking without leaving the booked state", async () => {
      const u = await customer();
      const a = await admin();
      const id = await newOrder(u);
      expect((await request(t.app).put(`/api/v1/orders/${id}/booking`).set(auth(u)).send({ slotAt: SLOT_FRI_14 })).status).toBe(409);
      await step(a, id, "ship");
      await step(a, id, "arrival");
      await request(t.app).post(`/api/v1/orders/${id}/booking`).set(auth(u)).send({ slotAt: SLOT_THU_11 });
      expect((await request(t.app).put(`/api/v1/orders/${id}/booking`).set(auth(u)).send({ slotAt: "2026-11-01T03:00:00.000Z" })).status).toBe(422); // Sunday
      const res = await request(t.app).put(`/api/v1/orders/${id}/booking`).set(auth(u)).send({ slotAt: SLOT_FRI_14 });
      expect(res.status).toBe(200);
      const o = await mine(u, id);
      expect(o.status).toBe("booked");
      expect(o.booking.slotAt).toBe(SLOT_FRI_14);
      expect(o.events.at(-1).note).toMatch(/^預約改為 2026\/10\/30 14:00/);
    });
  });

  describe("admin order management", () => {
    it("lists vehicle models on the admin API (the admin port serves nothing else)", async () => {
      const a = await admin("finance");
      const models = (await request(t.app).get("/api/v1/admin/vehicle-models").set(auth(a))).body as { id: string }[];
      expect(models.map((m) => m.id)).toContain("m-ix2-xdrive30");
      expect((await request(t.app).get("/api/v1/admin/vehicle-models")).status).toBe(401);
    });

    it("summarises orders by status", async () => {
      const u = await customer();
      const a = await admin();
      await newOrder(u, false);
      const paid = await newOrder(u);
      await step(a, paid, "ship");
      const s = (await request(t.app).get("/api/v1/admin/orders/summary").set(auth(a))).body;
      expect(s.total).toBe(2);
      expect(s.byStatus).toMatchObject({ created: 1, shipped: 1, paid: 0, refunded: 0 });
    });

    it("edits on the customer's behalf, with the admin named in the audit trail", async () => {
      const u = await customer();
      const a = await admin("operator");
      const id = await newOrder(u);
      const res = await request(t.app).patch(`/api/v1/admin/orders/${id}`).set(auth(a)).send({ shopId: "s-weili", plate: "ADM-0001" });
      expect(res.body).toMatchObject({ shopId: "s-weili", plate: "ADM-0001" });
      expect(res.body.events.at(-1).actor).toMatch(/^admin:/);
    });

    it("keeps internal notes away from the customer", async () => {
      const u = await customer();
      const a = await admin("finance");
      const id = await newOrder(u);
      const res = await step(a, id, "notes", { note: "客人來電：想改週末安裝" });
      expect(res.body.events.at(-1)).toMatchObject({ kind: "note", note: "客人來電：想改週末安裝" });
      expect((await mine(u, id)).events.some((e: { kind: string }) => e.kind === "note")).toBe(false);
    });

    it("enforces roles on the new actions", async () => {
      const u = await customer();
      const id = await newOrder(u);
      await request(t.app).post(`/api/v1/orders/${id}/cancel-request`).set(auth(u)).send({ reason: "不要了" });
      const finance = await admin("finance");
      const operator = await admin("operator");
      expect((await request(t.app).patch(`/api/v1/admin/orders/${id}`).set(auth(finance)).send({ plate: "FIN-0001" })).status).toBe(403);
      expect((await step(operator, id, "cancel-request/dismiss")).status).toBe(403);
      expect((await step(finance, id, "cancel-request/dismiss")).status).toBe(200);
    });
  });
});

describe("shop opening-hours label", () => {
  it("shows the opening days, collapsing consecutive days", async () => {
    const { hoursLabel } = await import("../src/modules/shop-network/shop-network.service");
    const h = (days: number[]) => hoursLabel({ open: "09:00", close: "18:00", days });
    expect(h([1, 2, 3, 4, 5, 6, 7])).toBe("每日 09:00–18:00");
    expect(h([1, 2, 3, 4, 5, 6])).toBe("週一至週六 09:00–18:00");
    expect(h([6, 1, 2, 3, 4, 5, 5])).toBe("週一至週六 09:00–18:00"); // order and duplicates don't matter
    expect(h([1, 2, 3, 4, 5, 7])).toBe("週一至週五、週日 09:00–18:00");
    expect(h([1, 3, 5])).toBe("週一、週三、週五 09:00–18:00");
    expect(h([6, 7])).toBe("週六、週日 09:00–18:00");
  });
});
