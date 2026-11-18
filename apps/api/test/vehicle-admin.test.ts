import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_CAMPAIGN, type AdminCampaignDetailDto, type AdminVehicleModelDto } from "@vsev/shared";
import { seed } from "../src/seed";
import { DRIVERS, buildTestApp, type TestApp } from "./helpers";

let t: TestApp;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function admin(role: "manager" | "operator" | "finance" = "manager"): Promise<string> {
  if (role !== "manager") await t.c.auth.upsertAdmin({ email: `${role}@vsev.local`, password: "Role!2026x", name: role, role });
  const [email, password] = role === "manager" ? ["admin@vsev.local", "ChangeMe!2026"] : [`${role}@vsev.local`, "Role!2026x"];
  return (await request(t.app).post("/api/v1/admin/auth/login").send({ email, password })).body.token as string;
}
const models = async (a: string): Promise<AdminVehicleModelDto[]> =>
  (await request(t.app).get("/api/v1/admin/vehicle-models").set(auth(a))).body as AdminVehicleModelDto[];
const storefrontModels = async (): Promise<string[]> =>
  ((await request(t.app).get(`/api/v1/campaigns/${SEED_CAMPAIGN.slug}`)).body.eligibleModels as { label: string }[]).map((m) => m.label);
const campaign = async (a: string): Promise<AdminCampaignDetailDto> =>
  (await request(t.app).get(`/api/v1/admin/campaigns/${SEED_CAMPAIGN.id}`).set(auth(a))).body as AdminCampaignDetailDto;
const put = (a: string, id: string, body: object) => request(t.app).put(`/api/v1/admin/vehicle-models/${id}`).set(auth(a)).send(body);
const post = (a: string, body: object) => request(t.app).post("/api/v1/admin/vehicle-models").set(auth(a)).send(body);
const setEligible = (a: string, modelIds: string[]) =>
  request(t.app).put(`/api/v1/admin/campaigns/${SEED_CAMPAIGN.id}/eligible-models`).set(auth(a)).send({ modelIds });

describe.each(DRIVERS)("%s driver: admin 車型資料", (driver) => {
  beforeEach(async () => {
    t = await buildTestApp(driver);
  });
  afterEach(async () => {
    await t.close();
  });

  it("lists every model with its owner-vehicle count", async () => {
    const a = await admin();
    const reg = await request(t.app).post("/api/v1/auth/register").send({ email: "car@example.com", password: "Passw0rd!x", name: "車主" });
    const order = await request(t.app).post("/api/v1/orders").set(auth(reg.body.token as string)).send({
      campaignSlug: SEED_CAMPAIGN.slug, vehicleModelId: "m-ix2-xdrive30", plate: "CAR-0001", shopId: "s-xiyun", deadlineAcknowledged: true
    });
    expect(order.status).toBe(201);
    const list = await models(a);
    expect(list).toHaveLength(4);
    expect(list.find((m) => m.id === "m-ix2-xdrive30")).toMatchObject({ active: true, ownerVehicles: 1 });
    expect(list.find((m) => m.id === "m-x2-m35i")).toMatchObject({ ownerVehicles: 0 });
  });

  it("adds a model, refuses duplicates and bad ids, and enforces roles", async () => {
    const a = await admin();
    const created = await post(a, { id: "m-ix2-m35-test", label: "BMW iX2 測試款" });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: "m-ix2-m35-test", label: "BMW iX2 測試款", active: true, ownerVehicles: 0 });
    expect((await post(a, { id: "m-ix2-m35-test", label: "重複" })).body.error.code).toBe("E1009");
    expect((await post(a, { id: "Bad ID", label: "x" })).body.error.code).toBe("E1000");
    expect((await post(a, { id: "m-empty", label: "  " })).body.error.code).toBe("E1000");

    expect((await post(await admin("operator"), { id: "m-op", label: "operator 可以" })).status).toBe(201);
    expect((await post(await admin("finance"), { id: "m-fin", label: "finance 不行" })).status).toBe(403);
    expect((await put(await admin("finance"), "m-op", { label: "x" })).status).toBe(403);
    expect((await put(a, "m-nope", { label: "x" })).status).toBe(404);
  });

  it("renames a model and the cached storefront page picks it up", async () => {
    const a = await admin();
    expect(await storefrontModels()).toContain("BMW X2 M35i"); // primes the page cache
    const res = await put(a, "m-x2-m35i", { label: "BMW X2 M35i xDrive", active: true });
    expect(res.status).toBe(200);
    expect(await storefrontModels()).toContain("BMW X2 M35i xDrive");
  });

  it("deactivates a model: hidden on the storefront, refused at checkout, campaign still editable", async () => {
    const a = await admin();
    await storefrontModels();
    expect((await put(a, "m-x2-m35i", { label: "BMW X2 M35i", active: false })).body.active).toBe(false);
    expect(await storefrontModels()).not.toContain("BMW X2 M35i");

    const reg = await request(t.app).post("/api/v1/auth/register").send({ email: "off@example.com", password: "Passw0rd!x", name: "車主" });
    const order = await request(t.app).post("/api/v1/orders").set(auth(reg.body.token as string)).send({
      campaignSlug: SEED_CAMPAIGN.slug, vehicleModelId: "m-x2-m35i", plate: "OFF-0001", shopId: "s-xiyun", deadlineAcknowledged: true
    });
    expect(order.body.error.code).toBe("E2003");

    // admin → 產品規格 saves the whole campaign, whose allow-list still names the inactive model
    const { id: _id, status: _status, shopIds: _shopIds, ...body } = await campaign(a);
    expect((await request(t.app).put(`/api/v1/admin/campaigns/${SEED_CAMPAIGN.id}`).set(auth(a)).send(body)).status).toBe(200);

    await put(a, "m-x2-m35i", { label: "BMW X2 M35i", active: true });
    expect(await storefrontModels()).toContain("BMW X2 M35i");
  });

  it("sets the campaign's eligible models", async () => {
    const a = await admin();
    await post(a, { id: "m-new", label: "新車型" });
    expect(await storefrontModels()).not.toContain("新車型");

    const res = await setEligible(a, ["m-new", "m-ix2-xdrive30", "m-new"]);
    expect(res.status).toBe(200);
    expect(res.body.eligibleModelIds).toEqual(["m-new", "m-ix2-xdrive30"]);
    expect(await storefrontModels()).toEqual(["新車型", "BMW iX2 xDrive30"]);

    expect((await setEligible(a, [])).body.error.code).toBe("E1000");
    expect((await setEligible(a, ["m-nope"])).body.error.code).toBe("E1000");
    expect((await setEligible(await admin("finance"), ["m-new"])).status).toBe(403);
  });

  it("keeps admin edits when the seed runs again on reboot", async () => {
    const a = await admin();
    await put(a, "m-x2-m35i", { label: "改過的名稱", active: false });
    await seed(t.c, { adminEmail: "admin@vsev.local", adminPassword: "ChangeMe!2026" });
    expect((await models(a)).find((m) => m.id === "m-x2-m35i")).toMatchObject({ label: "改過的名稱", active: false });
  });
});

describe("vehicle models from an external system", () => {
  afterEach(async () => {
    await t.close();
  });

  it("are read-only in the admin, but campaign eligibility stays editable", async () => {
    t = await buildTestApp("memory", {
      env: { VEHICLE_SOURCE: "http", VEHICLE_SOURCE_URL: "http://127.0.0.1:9/vehicle-models", VEHICLE_SOURCE_TOKEN: "t".repeat(20) },
      seed: false
    });
    await t.c.vehicles.syncFromFeed([{ id: "m-ext", label: "外部車型", active: true }]);
    await seed(t.c, { adminEmail: "admin@vsev.local", adminPassword: "ChangeMe!2026" });
    const a = await admin();
    expect((await post(a, { id: "m-local", label: "x" })).body.error.code).toBe("E2012");
    expect((await put(a, "m-ext", { label: "x" })).body.error.code).toBe("E2012");
    expect((await setEligible(a, ["m-ext"])).status).toBe(200);
  });
});
