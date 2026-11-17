/**
 * Versioned schema migrations. `PRAGMA user_version` records how many have been applied.
 * Migrations are append-only: never edit a shipped entry — add a new one.
 *
 * Conventions
 * - STRICT tables: SQLite enforces column types (no silent REAL in an INTEGER column).
 * - Timestamps are ISO-8601 UTC TEXT (`Date#toISOString()`), which sorts and compares correctly as text.
 * - Money (`*_cents`) and points (`delta`) are INTEGER — floats are rejected by STRICT.
 * - Enum columns carry CHECK constraints that mirror @vsev/shared.
 * - Tables are logically owned by one module (see comments); only that module's
 *   *.repository.sqlite.ts touches them. `reporting` reads across tables (read-only exception);
 *   `jobs` belongs to the platform queue.
 */
export const MIGRATIONS: readonly string[] = [
  /* ───────────── 1: initial schema ───────────── */
  `
  -- auth
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    phone         TEXT,
    created_at    TEXT NOT NULL
  ) STRICT;

  CREATE TABLE admin_users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('operator', 'manager', 'finance')),
    active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at    TEXT NOT NULL
  ) STRICT;

  -- catalog
  CREATE TABLE campaigns (
    id               TEXT PRIMARY KEY,
    slug             TEXT NOT NULL UNIQUE,
    title            TEXT NOT NULL,
    subtitle         TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'ended')),
    order_deadline   TEXT NOT NULL,
    install_deadline TEXT NOT NULL,
    product_name     TEXT NOT NULL,
    size_label       TEXT NOT NULL,
    includes         TEXT NOT NULL CHECK (json_valid(includes)),
    list_price_cents INTEGER NOT NULL CHECK (list_price_cents >= 0),
    sale_price_cents INTEGER NOT NULL CHECK (sale_price_cents >= 0),
    content          TEXT NOT NULL CHECK (json_valid(content)),
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  ) STRICT;

  CREATE TABLE campaign_eligible_models (
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    model_id    TEXT NOT NULL,
    position    INTEGER NOT NULL,
    PRIMARY KEY (campaign_id, model_id)
  ) STRICT;

  -- vehicle
  CREATE TABLE vehicle_models (
    id     TEXT PRIMARY KEY,
    label  TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
  ) STRICT;

  CREATE TABLE user_vehicles (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    model_id   TEXT NOT NULL,
    plate      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, plate)
  ) STRICT;

  -- shop-network
  CREATE TABLE shops (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    region  TEXT NOT NULL CHECK (region IN ('north', 'hsinchu', 'taichung', 'changhua', 'yunlin', 'south')),
    city    TEXT NOT NULL,
    address TEXT NOT NULL,
    phone   TEXT,
    hours   TEXT NOT NULL CHECK (json_valid(hours)),
    active  INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
  ) STRICT;

  CREATE TABLE campaign_shops (
    campaign_id TEXT NOT NULL,
    shop_id     TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    PRIMARY KEY (campaign_id, shop_id)
  ) STRICT;
  CREATE INDEX campaign_shops_shop ON campaign_shops (shop_id);

  CREATE TABLE coverage_requests (
    id         TEXT PRIMARY KEY,
    city       TEXT NOT NULL,
    note       TEXT,
    email      TEXT,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX coverage_requests_city ON coverage_requests (city);

  -- order
  CREATE TABLE orders (
    id                  TEXT PRIMARY KEY,
    number              TEXT NOT NULL UNIQUE,
    user_id             TEXT NOT NULL,
    campaign_id         TEXT NOT NULL,
    campaign_title      TEXT NOT NULL,
    shop_id             TEXT NOT NULL,
    shop_name           TEXT NOT NULL,
    shop_address        TEXT NOT NULL,
    vehicle_model_id    TEXT NOT NULL,
    vehicle_model_label TEXT NOT NULL,
    plate               TEXT NOT NULL,
    amount_cents        INTEGER NOT NULL CHECK (amount_cents >= 0),
    status              TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
                          'created', 'paid', 'shipped', 'arrived_at_shop', 'booked', 'installed',
                          'warranty_active', 'cancelled', 'refunded', 'expired')),
    referred_by_user_id TEXT,
    install_deadline    TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  ) STRICT;
  CREATE INDEX orders_user ON orders (user_id);
  CREATE INDEX orders_status ON orders (status);
  CREATE INDEX orders_shop ON orders (shop_id);
  CREATE INDEX orders_campaign ON orders (campaign_id);

  CREATE TABLE order_events (
    id          TEXT PRIMARY KEY,
    order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status   TEXT NOT NULL,
    actor       TEXT NOT NULL,
    note        TEXT,
    created_at  TEXT NOT NULL
  ) STRICT;
  CREATE INDEX order_events_order ON order_events (order_id);

  CREATE TABLE payment_events (
    gateway_txn_id TEXT PRIMARY KEY,
    order_id       TEXT NOT NULL,
    status         TEXT NOT NULL,
    created_at     TEXT NOT NULL
  ) STRICT;

  -- fulfillment
  CREATE TABLE bookings (
    id         TEXT PRIMARY KEY,
    order_id   TEXT NOT NULL UNIQUE,
    shop_id    TEXT NOT NULL,
    slot_at    TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'completed', 'no_show', 'cancelled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX bookings_shop_slot ON bookings (shop_id, slot_at);

  -- loyalty: append-only ledger; a balance is always SUM(delta)
  CREATE TABLE points_ledger (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    delta      INTEGER NOT NULL CHECK (delta <> 0),
    reason     TEXT NOT NULL CHECK (reason IN ('purchase', 'referral', 'adjustment')),
    ref_id     TEXT,
    note       TEXT,
    actor      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (reason, ref_id)  -- idempotency; NULL ref_ids (manual adjustments) never collide
  ) STRICT;
  CREATE INDEX points_ledger_user ON points_ledger (user_id);

  CREATE TABLE referral_codes (
    user_id    TEXT PRIMARY KEY,
    code       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  ) STRICT;

  -- notification
  CREATE TABLE notification_templates (
    kind    TEXT PRIMARY KEY CHECK (kind IN (
              'order_paid', 'order_shipped', 'order_arrived', 'booking_confirmed', 'install_reminder', 'warranty_active')),
    title   TEXT NOT NULL,
    body    TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
  ) STRICT;

  CREATE TABLE notification_logs (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    order_id   TEXT,
    channel    TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    dedupe_key TEXT UNIQUE,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX notification_logs_created ON notification_logs (created_at);

  -- maintenance
  CREATE TABLE mileage_entries (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    odometer_km INTEGER NOT NULL CHECK (odometer_km >= 0),
    recorded_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX mileage_entries_user ON mileage_entries (user_id, recorded_at);

  CREATE TABLE maintenance_profiles (
    order_id             TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL,
    rotation_interval_km INTEGER NOT NULL DEFAULT 10000,
    created_at           TEXT NOT NULL
  ) STRICT;
  CREATE INDEX maintenance_profiles_user ON maintenance_profiles (user_id);

  -- reporting
  CREATE TABLE funnel_events (
    id            INTEGER PRIMARY KEY,
    session_id    TEXT NOT NULL,
    event         TEXT NOT NULL,
    campaign_slug TEXT NOT NULL,
    created_at    TEXT NOT NULL
  ) STRICT;
  CREATE INDEX funnel_events_campaign ON funnel_events (campaign_slug, event);

  -- platform: durable job queue (used when no Redis is configured)
  CREATE TABLE jobs (
    id            INTEGER PRIMARY KEY,
    queue         TEXT NOT NULL,
    name          TEXT NOT NULL,
    data          TEXT NOT NULL,
    job_key       TEXT UNIQUE,
    status        TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
    run_at        TEXT NOT NULL,
    attempts_left INTEGER NOT NULL,
    last_error    TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  ) STRICT;
  CREATE INDEX jobs_due ON jobs (status, run_at);
  `,

  /* ───────────── 2: cart connector — the external commerce system's reference per order ───────────── */
  `
  ALTER TABLE orders ADD COLUMN external_ref TEXT;
  CREATE INDEX orders_external_ref ON orders (external_ref);
  `
];
