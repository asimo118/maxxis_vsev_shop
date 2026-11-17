import { z } from "zod";

/** `.env` files often leave a variable present but empty — treat that as "not set". */
const blank = (v: unknown): unknown => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalUrl = z.preprocess(blank, z.string().url().optional());
const optionalSecret = z.preprocess(blank, z.string().min(1).optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().default(4000),
    /** "sqlite" = SQLite file (production). "memory" = in-process store, lost on restart (tests, demos). */
    DATA_DRIVER: z.enum(["sqlite", "memory"]).default("sqlite"),
    /** SQLite database file. Relative paths resolve against the API's working directory. */
    SQLITE_PATH: z.string().min(1).default("./data/vsev.db"),
    /** Optional. Empty = in-process cache + durable SQLite job queue. Set = Redis cache + BullMQ. */
    REDIS_URL: z.string().optional(),
    JWT_SECRET_STOREFRONT: z.string().min(32, "JWT_SECRET_STOREFRONT must be at least 32 chars"),
    JWT_SECRET_ADMIN: z.string().min(32, "JWT_SECRET_ADMIN must be at least 32 chars"),
    CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:5174"),
    NOTIFY_ADAPTER: z.enum(["console"]).default("console"),
    BCRYPT_COST: z.coerce.number().int().min(4).max(14).default(10),
    /** When set, POST /payments/webhook requires a matching HMAC-SHA256 `x-vsev-signature` header. */
    PAYMENT_WEBHOOK_SECRET: z.string().optional(),
    /** The mock gateway auto-confirms payments. Never enable in production. */
    PAYMENT_GATEWAY: z.enum(["mock"]).default("mock"),
    /**
     * Staging / demo only: let a production build run with the auto-approving mock gateway.
     * Every payment then succeeds without money moving — never enable this on the live site.
     */
    ALLOW_MOCK_PAYMENTS: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    /** Reverse-proxy hops in front of the API (bundled nginx = 1; add one per extra proxy such as Traefik). */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
    /** Build identifier (git SHA), set by the Docker image; reported by GET /api/v1/health. */
    APP_VERSION: z.string().min(1).default("dev"),
    /** Ensure the first campaign, shops, templates and admin exist on boot (idempotent). */
    SEED_ON_BOOT: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    SEED_ADMIN_EMAIL: z.string().email().default("admin@vsev.local"),
    SEED_ADMIN_PASSWORD: z.string().min(8).default("ChangeMe!2026"),

    /* ── Connectors (docs/connectors.md). "local" = managed in this system (default). ── */
    /** Vehicle models: "local" (seed / this DB) or "http" (synced from VEHICLE_SOURCE_URL). */
    VEHICLE_SOURCE: z.enum(["local", "http"]).default("local"),
    VEHICLE_SOURCE_URL: optionalUrl,
    VEHICLE_SOURCE_TOKEN: optionalSecret,
    /** Install-shop directory: "local" (admin console) or "http" (synced from SHOP_SOURCE_URL, read-only here). */
    SHOP_SOURCE: z.enum(["local", "http"]).default("local"),
    SHOP_SOURCE_URL: optionalUrl,
    SHOP_SOURCE_TOKEN: optionalSecret,
    /** Minutes between feed syncs (also synced once at boot, and on demand from the admin console). */
    CONNECTOR_SYNC_INTERVAL_MIN: z.coerce.number().int().min(1).max(24 * 60).default(30),
    CONNECTOR_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(8000),
    /** Cart / checkout: "internal" (built-in PaymentGateway) or "http" (redirect to an external cart). */
    COMMERCE_CONNECTOR: z.enum(["internal", "http"]).default("internal"),
    COMMERCE_API_URL: optionalUrl,
    COMMERCE_API_TOKEN: optionalSecret,
    /** HMAC secret the external system signs commerce webhooks with. Required when COMMERCE_CONNECTOR=http. */
    COMMERCE_WEBHOOK_SECRET: optionalSecret,
    /** Where the external cart returns the shopper; `{orderId}` is substituted. */
    COMMERCE_RETURN_URL: z.string().default("http://localhost:5173/orders/{orderId}?from=checkout"),
    /** JSON object: campaign slug → external SKU, e.g. {"vs-ev-plus-bmw-ix2-2026q4":"VSEVP-2454020-SET4"}. */
    COMMERCE_SKU_MAP: z.preprocess(
      blank,
      z
        .string()
        .default("{}")
        .transform((raw, ctx) => {
          try {
            return z.record(z.string(), z.string().min(1)).parse(JSON.parse(raw));
          } catch {
            ctx.addIssue({ code: "custom", message: 'must be a JSON object such as {"campaign-slug":"SKU"}' });
            return z.NEVER;
          }
        })
    )
  })
  .superRefine((env, ctx) => {
    const need = (when: boolean, key: keyof typeof env, message: string): void => {
      if (when && !env[key]) ctx.addIssue({ code: "custom", path: [key], message });
    };
    need(env.VEHICLE_SOURCE === "http", "VEHICLE_SOURCE_URL", "required when VEHICLE_SOURCE=http");
    need(env.SHOP_SOURCE === "http", "SHOP_SOURCE_URL", "required when SHOP_SOURCE=http");
    need(env.COMMERCE_CONNECTOR === "http", "COMMERCE_API_URL", "required when COMMERCE_CONNECTOR=http");
    need(env.COMMERCE_CONNECTOR === "http", "COMMERCE_WEBHOOK_SECRET", "required when COMMERCE_CONNECTOR=http (unsigned webhooks could mark orders paid)");
    if (env.COMMERCE_CONNECTOR === "http" && !env.COMMERCE_RETURN_URL.includes("{orderId}")) {
      ctx.addIssue({ code: "custom", path: ["COMMERCE_RETURN_URL"], message: "must contain {orderId}" });
    }

    // With an external cart the money is taken there, so the built-in gateway rules don't apply.
    const internalPayments = env.COMMERCE_CONNECTOR === "internal" && !env.ALLOW_MOCK_PAYMENTS;
    if (internalPayments && env.NODE_ENV === "production" && env.PAYMENT_GATEWAY === "mock") {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_GATEWAY"],
        message: "the mock gateway auto-approves payments; implement a real PaymentGateway adapter before production"
      });
    }
    if (internalPayments && env.NODE_ENV === "production" && !env.PAYMENT_WEBHOOK_SECRET) {
      ctx.addIssue({ code: "custom", path: ["PAYMENT_WEBHOOK_SECRET"], message: "required in production" });
    }
    if (env.NODE_ENV === "production" && env.DATA_DRIVER === "memory") {
      ctx.addIssue({ code: "custom", path: ["DATA_DRIVER"], message: "memory driver is not allowed in production" });
    }
  });

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  return parsed.data;
}
