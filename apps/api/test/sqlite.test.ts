import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_CAMPAIGN } from "@vsev/shared";
import { DAY_MS, FakeClock } from "../src/platform/clock";
import { MIGRATIONS } from "../src/platform/sqlite.migrations";
import { migrate, openSqlite } from "../src/platform/sqlite";
import { TEST_START, buildTestApp } from "./helpers";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vsev-sqlite-"));
  file = join(dir, "vsev.db");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("SQLite persistence", () => {
  it("keeps orders, points and pending reminders across a restart, then fires the reminder", async () => {
    const clock = new FakeClock(TEST_START);
    const first = await buildTestApp("sqlite", { sqlitePath: file, clock });
    const reg = await request(first.app).post("/api/v1/auth/register").send({ email: "p@example.com", password: "Passw0rd!x", name: "持久" });
    const token = reg.body.token as string;
    const order = await request(first.app).post("/api/v1/orders").set(auth(token)).send({
      campaignSlug: SEED_CAMPAIGN.slug, vehicleModelId: "m-ix2-xdrive30", plate: "PER-0001", shopId: "s-xiyun", deadlineAcknowledged: true
    });
    await request(first.app).post(`/api/v1/orders/${order.body.id}/pay`).set(auth(token));
    await first.queue.drain();
    const reminders = first.queue.pendingDelayed().filter((j) => j.jobId.startsWith(`remind__${order.body.id}`));
    expect(reminders.map((r) => r.jobId.split("__")[2])).toEqual(["14", "3", "1"]);
    await first.close();

    // "Deploy": a brand-new process on the same file, seeded again (idempotent).
    const second = await buildTestApp("sqlite", { sqlitePath: file, clock });
    const login = await request(second.app).post("/api/v1/auth/login").send({ email: "p@example.com", password: "Passw0rd!x" });
    const mine = await request(second.app).get(`/api/v1/me/orders/${order.body.id}`).set(auth(login.body.token as string));
    expect(mine.body.status).toBe("paid");
    expect(mine.body.events.map((e: { to: string }) => e.to)).toEqual(["created", "paid"]);
    expect(second.queue.pendingDelayed()).toHaveLength(3); // nothing lost
    expect((await second.c.repos.shops.listAll()).length).toBe(19); // seed did not duplicate

    // 14 days before the install deadline, the reminder fires exactly once.
    clock.set(new Date(new Date(SEED_CAMPAIGN.installDeadline).getTime() - 14 * DAY_MS + 60_000));
    expect(await second.queue.runDue()).toBe(1);
    await second.queue.runDue();
    const logs = await second.c.notifications.listLogs();
    expect(logs.filter((l) => l.kind === "install_reminder")).toHaveLength(1);
    await second.close();
  });

  it("re-runs a job that was interrupted mid-flight (at-least-once)", async () => {
    const db = openSqlite(file);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO jobs (queue, name, data, job_key, status, run_at, attempts_left, created_at, updated_at)
       VALUES ('maintenance', 'noop', '{}', 'maintenance/x', 'running', ?, 3, ?, ?)`
    ).run(now, now, now);
    db.close();
    const app = await buildTestApp("sqlite", { sqlitePath: file, seed: false });
    expect(app.queue.pendingDelayed().map((j) => j.jobId)).toEqual(["x"]);
    await app.close();
  });

  it("writes a consistent online backup", async () => {
    const app = await buildTestApp("sqlite", { sqlitePath: file });
    const dest = join(dir, "backup.db");
    const live = new Database(file, { readonly: true });
    await live.backup(dest);
    live.close();
    const copy = new Database(dest, { readonly: true });
    expect(copy.prepare("SELECT COUNT(*) AS n FROM shops").get()).toEqual({ n: 19 });
    copy.close();
    await app.close();
  });
});

describe("SQLite schema", () => {
  it("migrates once and records the version", () => {
    const db = new Database(":memory:");
    expect(migrate(db)).toEqual({ from: 0, to: MIGRATIONS.length });
    expect(migrate(db)).toEqual({ from: MIGRATIONS.length, to: MIGRATIONS.length });
    db.close();
  });

  it("upgrades a deployed v2 database with existing orders to v3 without losing data", () => {
    const db = new Database(":memory:");
    // What a server deployed before order management has: migrations 1–2 and some rows.
    db.transaction(() => {
      for (const sql of MIGRATIONS.slice(0, 2)) db.exec(sql);
      db.pragma("user_version = 2");
    })();
    db.prepare(
      `INSERT INTO orders (id, number, user_id, campaign_id, campaign_title, shop_id, shop_name, shop_address,
         vehicle_model_id, vehicle_model_label, plate, amount_cents, status, install_deadline, created_at, updated_at)
       VALUES ('o1', 'VSEV-1', 'u', 'c', 't', 's', 's', 'a', 'm', 'm', 'ABC-1234', 3280000, 'paid', 'x', 'x', 'x')`
    ).run();
    db.prepare(
      `INSERT INTO order_events (id, order_id, from_status, to_status, actor, note, created_at)
       VALUES ('e1', 'o1', 'created', 'paid', 'gateway', NULL, 'x')`
    ).run();

    expect(migrate(db)).toEqual({ from: 2, to: MIGRATIONS.length });
    expect(db.prepare("SELECT status, tracking_number, cancel_requested_at FROM orders").get())
      .toEqual({ status: "paid", tracking_number: null, cancel_requested_at: null });
    expect(db.prepare("SELECT kind FROM order_events").get()).toEqual({ kind: "status" }); // old rows default
    expect(() => db.prepare("UPDATE order_events SET kind = 'bogus'").run()).toThrow(/CHECK/);
    db.close();
  });

  it("refuses to run against a newer schema", () => {
    const db = new Database(":memory:");
    db.pragma(`user_version = ${MIGRATIONS.length + 1}`);
    expect(() => migrate(db)).toThrow(/newer than this build/);
    db.close();
  });

  it("enforces integer money, enum values and ledger idempotency in the database itself", () => {
    const db = openSqlite(":memory:");
    const insertOrder = (amount: number, status: string) =>
      db.prepare(
        `INSERT INTO orders (id, number, user_id, campaign_id, campaign_title, shop_id, shop_name, shop_address,
           vehicle_model_id, vehicle_model_label, plate, amount_cents, status, install_deadline, created_at, updated_at)
         VALUES (?, ?, 'u', 'c', 't', 's', 's', 'a', 'm', 'm', 'P', ?, ?, 'x', 'x', 'x')`
      ).run(`id-${Math.random()}`, `n-${Math.random()}`, amount, status);
    expect(() => insertOrder(3280000, "paid")).not.toThrow();
    expect(() => insertOrder(32800.5, "paid")).toThrow(); // STRICT: no fractional money
    expect(() => insertOrder(100, "shipped_to_moon")).toThrow(/CHECK/);

    const add = (reason: string, ref: string | null) =>
      db.prepare(
        `INSERT INTO points_ledger (id, user_id, delta, reason, ref_id, actor, created_at)
         VALUES (?, 'u', 10, ?, ?, 'system', 'x') ON CONFLICT (reason, ref_id) DO NOTHING`
      ).run(`p-${Math.random()}`, reason, ref).changes;
    expect(add("purchase", "order-1")).toBe(1);
    expect(add("purchase", "order-1")).toBe(0); // replayed award is a no-op
    expect(add("adjustment", null)).toBe(1);
    expect(add("adjustment", null)).toBe(1); // manual adjustments never collide
    db.close();
  });
});
