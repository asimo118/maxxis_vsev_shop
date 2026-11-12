import type { Express } from "express";
import { createApp } from "../src/app";
import { createContainer, type Container } from "../src/container";
import { FakeClock } from "../src/platform/clock";
import { loadConfig } from "../src/platform/config";
import { createSilentLogger } from "../src/platform/logger";
import type { QueueDriver, QueueName } from "../src/platform/queue";
import { seed } from "../src/seed";

export const DRIVERS = ["memory", "sqlite"] as const;
export type Driver = (typeof DRIVERS)[number];

/** Both test-facing queue drivers (inline + SQLite) expose these extra hooks. */
export type TestQueue = QueueDriver & {
  runDue(): Promise<number>;
  pendingDelayed(): { queue: QueueName; jobId: string; runAt: Date }[];
};

export interface TestApp {
  app: Express;
  c: Container;
  clock: FakeClock;
  queue: TestQueue;
  close(): Promise<void>;
}

export const TEST_START = "2026-10-28T02:00:00.000Z"; // Wed 10:00 Taipei

export function testConfig(driver: Driver, sqlitePath = ":memory:", env: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: "test",
    DATA_DRIVER: driver,
    SQLITE_PATH: sqlitePath,
    JWT_SECRET_STOREFRONT: "s".repeat(40),
    JWT_SECRET_ADMIN: "a".repeat(40),
    BCRYPT_COST: "4",
    ...env
  });
}

export interface BuildOptions {
  sqlitePath?: string;
  clock?: FakeClock;
  seed?: boolean;
  /** Extra environment variables (e.g. connector settings). */
  env?: Record<string, string>;
}

export async function buildTestApp(driver: Driver = "memory", opts: BuildOptions = {}): Promise<TestApp> {
  const clock = opts.clock ?? new FakeClock(TEST_START);
  const c = await createContainer(testConfig(driver, opts.sqlitePath, opts.env), createSilentLogger(), {
    clock,
    startQueue: false
  });
  if (opts.seed ?? true) await seed(c, { adminEmail: "admin@vsev.local", adminPassword: "ChangeMe!2026" });
  return { app: createApp(c), c, clock, queue: c.queue as TestQueue, close: () => c.close() };
}
