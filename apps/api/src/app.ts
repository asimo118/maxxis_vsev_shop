import cors from "cors";
import express, { Router, type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Container } from "./container";
import { errorMiddleware, notFoundHandler } from "./platform/http";
import { createRateLimiter } from "./platform/rate-limit";
import { createAdminAccountsRouter, createAdminAuthRouter, createAuthRouter } from "./modules/auth/auth.router";
import { createCatalogAdminRouter, createCatalogRouter } from "./modules/catalog/catalog.router";
import { createFulfillmentAdminRouter, createFulfillmentRouter } from "./modules/fulfillment/fulfillment.router";
import { createLoyaltyAdminRouter, createLoyaltyRouter } from "./modules/loyalty/loyalty.router";
import { createMaintenanceRouter } from "./modules/maintenance/maintenance.router";
import { createNotificationAdminRouter } from "./modules/notification/notification.router";
import { createOrderAdminRouter, createOrderRouter } from "./modules/order/order.router";
import { createReportingAdminRouter, createTrackingRouter } from "./modules/reporting/reporting.router";
import { createShopNetworkAdminRouter, createShopNetworkRouter } from "./modules/shop-network/shop-network.router";
import { createVehicleAdminRouter, createVehicleRouter } from "./modules/vehicle/vehicle.router";
import { createConnectorsAdminRouter } from "./connectors/connectors.router";

export function createApp(c: Container): Express {
  const app = express();
  const mw = c.middleware;
  app.disable("x-powered-by");
  app.set("trust proxy", c.config.TRUST_PROXY);
  app.use(helmet());
  app.use(cors({ origin: c.config.CORS_ORIGINS.split(",").map((s) => s.trim()), credentials: false }));
  if (c.config.NODE_ENV !== "test") app.use(pinoHttp({ logger: c.logger }));
  app.use(
    express.json({
      limit: "100kb",
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      }
    })
  );

  const credentialLimit = createRateLimiter({ windowMs: 60_000, max: 20, clock: c.clock });
  const trackLimit = createRateLimiter({ windowMs: 60_000, max: 120, clock: c.clock });

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // ── storefront API ──
  const api = Router();
  api.use(["/auth/login", "/auth/register", "/auth/password"], credentialLimit);
  api.use("/track", trackLimit);
  /** Public liveness + build version — CI uses it to confirm a deploy actually rolled out. */
  api.get("/health", (_req, res) => {
    res.json({ ok: true, version: c.config.APP_VERSION });
  });
  api.use(createAuthRouter(c.auth, mw));
  api.use(createCatalogRouter(c.catalog));
  api.use(createVehicleRouter(c.vehicles, mw));
  api.use(createShopNetworkRouter(c.shops));
  api.use(
    createOrderRouter(c.orders, mw, {
      webhookSecret: c.config.PAYMENT_WEBHOOK_SECRET,
      commerceWebhookSecret: c.config.COMMERCE_WEBHOOK_SECRET
    })
  );
  api.use(createFulfillmentRouter(c.fulfillment, mw));
  api.use(createLoyaltyRouter(c.loyalty, mw));
  api.use(createMaintenanceRouter(c.maintenance, mw));
  api.use(createTrackingRouter(c.reporting));

  // ── admin API (separate audience; login is public, everything else guarded) ──
  const admin = Router();
  admin.use(["/auth/login", "/auth/password"], credentialLimit);
  admin.use(createAdminAuthRouter(c.auth, mw));
  admin.use(mw.requireAdmin);
  admin.use(createAdminAccountsRouter(c.auth, mw));
  admin.use(createReportingAdminRouter(c.reporting, mw));
  admin.use(createOrderAdminRouter(c.orders, mw));
  admin.use(createFulfillmentAdminRouter(c.fulfillment, mw));
  admin.use(createShopNetworkAdminRouter(c.shops, mw));
  admin.use(createVehicleAdminRouter(c.vehicles));
  admin.use(createCatalogAdminRouter(c.catalog, mw));
  admin.use(createNotificationAdminRouter(c.notifications, mw));
  admin.use(createLoyaltyAdminRouter(c.loyalty, mw));
  admin.use(createConnectorsAdminRouter(c.connectors, mw));

  app.use("/api/v1/admin", admin);
  app.use("/api/v1", api);
  app.use(notFoundHandler());
  app.use(errorMiddleware(c.logger));
  return app;
}
