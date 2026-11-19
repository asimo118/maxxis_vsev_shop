import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../src/seed";
import { DRIVERS, buildTestApp, type TestApp } from "./helpers";

let t: TestApp;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const ADMIN = { email: "admin@vsev.local", password: "ChangeMe!2026" };

async function register(email = `u${Math.random()}@example.com`, password = "Passw0rd!x") {
  const res = await request(t.app).post("/api/v1/auth/register").send({ email, password, name: "資安測試" });
  expect(res.status).toBe(201);
  return { email, password, token: res.body.token as string };
}
const login = (email: string, password: string) => request(t.app).post("/api/v1/auth/login").send({ email, password });
const adminLogin = (email: string, password: string) => request(t.app).post("/api/v1/admin/auth/login").send({ email, password });
const me = (token: string) => request(t.app).get("/api/v1/auth/me").set(auth(token));
const adminMe = (token: string) => request(t.app).get("/api/v1/admin/auth/me").set(auth(token));
async function adminToken(email = ADMIN.email, password = ADMIN.password): Promise<string> {
  const res = await adminLogin(email, password);
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe.each(DRIVERS)("%s driver: sessions and passwords", (driver) => {
  beforeEach(async () => {
    t = await buildTestApp(driver);
  });
  afterEach(async () => {
    await t.close();
  });

  describe("SEC-02 logout ends the session on the server", () => {
    it("customer token stops working after logout", async () => {
      const u = await register();
      expect((await me(u.token)).status).toBe(200);
      expect((await request(t.app).post("/api/v1/auth/logout").set(auth(u.token))).status).toBe(204);
      expect((await me(u.token)).status).toBe(401);
      expect((await request(t.app).post("/api/v1/auth/logout").set(auth(u.token))).status).toBe(401);
    });

    it("admin token stops working after logout, other sessions stay", async () => {
      const a1 = await adminToken();
      const a2 = await adminToken();
      expect((await request(t.app).post("/api/v1/admin/auth/logout").set(auth(a1))).status).toBe(204);
      expect((await adminMe(a1)).status).toBe(401);
      expect((await request(t.app).get("/api/v1/admin/orders").set(auth(a1))).status).toBe(401);
      expect((await adminMe(a2)).status).toBe(200);
    });

    it("rejects a correctly signed token whose session does not exist", async () => {
      const u = await register();
      const { sub } = jwt.decode(u.token) as { sub: string };
      const forged = jwt.sign({}, "s".repeat(40), { subject: sub, audience: "storefront", issuer: "vsev", jwtid: randomUUID(), expiresIn: 600 });
      expect((await me(forged)).status).toBe(401);
      const noSession = jwt.sign({}, "s".repeat(40), { subject: sub, audience: "storefront", issuer: "vsev", expiresIn: 600 });
      expect((await me(noSession)).status).toBe(401);
    });

    it("rejects a session that belongs to someone else", async () => {
      const a = await register();
      const b = await register();
      const { jti } = jwt.decode(a.token) as { jti: string };
      const { sub } = jwt.decode(b.token) as { sub: string };
      const swapped = jwt.sign({}, "s".repeat(40), { subject: sub, audience: "storefront", issuer: "vsev", jwtid: jti, expiresIn: 600 });
      expect((await me(swapped)).status).toBe(401);
    });
  });

  describe("SEC-01 / SEC-03 change password", () => {
    const change = (token: string, body: object) => request(t.app).post("/api/v1/auth/password").set(auth(token)).send(body);

    it("requires the current password and a different new one", async () => {
      const u = await register();
      const wrong = await change(u.token, { currentPassword: "nope-nope", newPassword: "Another!pass1" });
      expect(wrong.status).toBe(400);
      expect(wrong.body.error.details[0]).toMatchObject({ path: "currentPassword" });
      expect((await change(u.token, { currentPassword: u.password, newPassword: u.password })).body.error.details[0].path).toBe("newPassword");
      expect((await change(u.token, { currentPassword: u.password, newPassword: "short" })).status).toBe(400);
    });

    it("switches the password and signs out other devices by default", async () => {
      const u = await register();
      const other = (await login(u.email, u.password)).body.token as string;
      const res = await change(u.token, { currentPassword: u.password, newPassword: "Brand!New2026" });
      expect(res.status).toBe(200);
      expect(res.body.signedOutSessions).toBe(1);
      expect((await me(u.token)).status).toBe(200); // the device that changed it stays signed in
      expect((await me(other)).status).toBe(401);
      expect((await login(u.email, u.password)).status).toBe(401);
      expect((await login(u.email, "Brand!New2026")).status).toBe(200);
    });

    it("can keep other devices signed in", async () => {
      const u = await register();
      const other = (await login(u.email, u.password)).body.token as string;
      const res = await change(u.token, { currentPassword: u.password, newPassword: "Brand!New2026", signOutOtherSessions: false });
      expect(res.body.signedOutSessions).toBe(0);
      expect((await me(other)).status).toBe(200);
    });

    it("admins need 12+ characters and also sign out elsewhere", async () => {
      const a = await adminToken();
      const elsewhere = await adminToken();
      const short = await request(t.app).post("/api/v1/admin/auth/password").set(auth(a)).send({ currentPassword: ADMIN.password, newPassword: "Short!2026" });
      expect(short.status).toBe(400);
      const ok = await request(t.app).post("/api/v1/admin/auth/password").set(auth(a)).send({ currentPassword: ADMIN.password, newPassword: "Long-enough!2026" });
      expect(ok.status).toBe(200);
      expect((await adminMe(elsewhere)).status).toBe(401);
      expect((await adminLogin(ADMIN.email, "Long-enough!2026")).status).toBe(200);
    });
  });

  describe("SEC-04 personal admin accounts", () => {
    const create = (token: string, body: object) => request(t.app).post("/api/v1/admin/admins").set(auth(token)).send(body);
    const patch = (token: string, id: string, body: object) => request(t.app).patch(`/api/v1/admin/admins/${id}`).set(auth(token)).send(body);

    it("a manager creates personal accounts; other roles cannot manage accounts", async () => {
      const m = await adminToken();
      const res = await create(m, { email: "Amy@Example.com", name: "Amy", role: "operator", password: "Operator!2026" });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ email: "amy@example.com", role: "operator", active: true, lastLoginAt: null });
      expect((await create(m, { email: "amy@example.com", name: "Dup", role: "finance", password: "Operator!2026" })).status).toBe(409);
      expect((await create(m, { email: "bob@example.com", name: "Bob", role: "finance", password: "short" })).status).toBe(400);

      const amy = await adminToken("amy@example.com", "Operator!2026");
      expect((await request(t.app).get("/api/v1/admin/admins").set(auth(amy))).status).toBe(403);
      expect((await create(amy, { email: "x@example.com", name: "X", role: "manager", password: "Operator!2026" })).status).toBe(403);

      const list = (await request(t.app).get("/api/v1/admin/admins").set(auth(m))).body as { email: string; lastLoginAt: string | null }[];
      expect(list.map((a) => a.email)).toEqual(["admin@vsev.local", "amy@example.com"]);
      expect(list.every((a) => a.lastLoginAt !== null)).toBe(true);
    });

    it("deactivating an admin ends their sessions and blocks sign-in", async () => {
      const m = await adminToken();
      const { id } = (await create(m, { email: "amy@example.com", name: "Amy", role: "operator", password: "Operator!2026" })).body;
      const amy = await adminToken("amy@example.com", "Operator!2026");
      expect((await patch(m, id, { active: false })).body.active).toBe(false);
      expect((await adminMe(amy)).status).toBe(401);
      expect((await adminLogin("amy@example.com", "Operator!2026")).status).toBe(401);
      await patch(m, id, { active: true });
      expect((await adminMe(amy)).status).toBe(401); // re-activation does not revive old sessions
      expect((await adminLogin("amy@example.com", "Operator!2026")).status).toBe(200);
    });

    it("a role change ends that admin's sessions", async () => {
      const m = await adminToken();
      const { id } = (await create(m, { email: "amy@example.com", name: "Amy", role: "operator", password: "Operator!2026" })).body;
      const amy = await adminToken("amy@example.com", "Operator!2026");
      expect((await patch(m, id, { role: "finance" })).body.role).toBe("finance");
      expect((await adminMe(amy)).status).toBe(401);
    });

    it("never locks the console: no self-deactivation, last manager stays", async () => {
      const m = await adminToken();
      const self = (await adminMe(m)).body.id as string;
      expect((await patch(m, self, { active: false })).status).toBe(409);
      expect((await patch(m, self, { role: "operator" })).status).toBe(409);
      expect((await patch(m, self, { name: "Michael" })).body.name).toBe("Michael");

      const second = (await create(m, { email: "b@example.com", name: "B", role: "manager", password: "Manager!2026x" })).body.id as string;
      const b = await adminToken("b@example.com", "Manager!2026x");
      expect((await patch(b, self, { active: false })).status).toBe(200);
      expect((await patch(b, second, { role: "operator" })).status).toBe(409); // b cannot demote self either
    });

    it("a manager resets someone else's password; their sessions end", async () => {
      const m = await adminToken();
      const { id } = (await create(m, { email: "amy@example.com", name: "Amy", role: "operator", password: "Operator!2026" })).body;
      const amy = await adminToken("amy@example.com", "Operator!2026");
      const res = await request(t.app).post(`/api/v1/admin/admins/${id}/password`).set(auth(m)).send({ password: "Temporary!2026" });
      expect(res.status).toBe(200);
      expect((await adminMe(amy)).status).toBe(401);
      expect((await adminLogin("amy@example.com", "Temporary!2026")).status).toBe(200);
      const self = (await adminMe(m)).body.id as string;
      expect((await request(t.app).post(`/api/v1/admin/admins/${self}/password`).set(auth(m)).send({ password: "Temporary!2026" })).status).toBe(409);
    });

    it("restarting with SEED_ADMIN_* never resets an existing admin", async () => {
      const m = await adminToken();
      await request(t.app).post("/api/v1/admin/auth/password").set(auth(m)).send({ currentPassword: ADMIN.password, newPassword: "Changed-in-console!1" });
      await seed(t.c, { adminEmail: ADMIN.email, adminPassword: ADMIN.password });
      expect((await adminLogin(ADMIN.email, ADMIN.password)).status).toBe(401);
      expect((await adminLogin(ADMIN.email, "Changed-in-console!1")).status).toBe(200);
      await seed(t.c, { adminEmail: "someone-else@vsev.local", adminPassword: "Whatever!2026" });
      expect((await adminLogin("someone-else@vsev.local", "Whatever!2026")).status).toBe(401);
    });
  });
});
