import type { AdminRole } from "@vsev/shared";
import { MemoryCache, RedisCache, type Cache } from "./platform/cache";
import { systemClock, type Clock } from "./platform/clock";
import type { Config } from "./platform/config";
import { InProcessEventBus, type EventBus } from "./platform/events";
import type { Logger } from "./platform/logger";
import { createMemoryStore } from "./platform/memory-store";
import { InlineQueueDriver, type QueueDriver } from "./platform/queue";
import { SqliteQueueDriver } from "./platform/queue.sqlite";
import { openSqlite, type SqliteDb } from "./platform/sqlite";
import { createTokenService, type TokenService } from "./platform/tokens";
import { createAuthMiddleware, type AuthMiddleware } from "./modules/auth/auth.middleware";
import type { AuthRepository } from "./modules/auth/auth.repository";
import { createMemoryAuthRepository } from "./modules/auth/auth.repository.memory";
import { createSqliteAuthRepository } from "./modules/auth/auth.repository.sqlite";
import { AuthService } from "./modules/auth/auth.service";
import type { CatalogRepository } from "./modules/catalog/catalog.repository";
import { createMemoryCatalogRepository } from "./modules/catalog/catalog.repository.memory";
import { createSqliteCatalogRepository } from "./modules/catalog/catalog.repository.sqlite";
import { CatalogService } from "./modules/catalog/catalog.service";
import { registerCatalogSubscribers } from "./modules/catalog/catalog.subscribers";
import { createHttpCommerceConnector } from "./connectors/commerce.http";
import { createHttpShopFeed, createHttpVehicleFeed } from "./connectors/feeds.http";
import { ConnectorError, createHttpJsonClient, endpointHost } from "./connectors/http-json";
import { ConnectorRegistry } from "./connectors/registry";
import type { CommerceConnector } from "./modules/order/commerce.port";
import type { FulfillmentRepository } from "./modules/fulfillment/fulfillment.repository";
import { createMemoryFulfillmentRepository } from "./modules/fulfillment/fulfillment.repository.memory";
import { createSqliteFulfillmentRepository } from "./modules/fulfillment/fulfillment.repository.sqlite";
import { FulfillmentService } from "./modules/fulfillment/fulfillment.service";
import { registerFulfillmentJobs } from "./modules/fulfillment/fulfillment.subscribers";
import type { LoyaltyRepository } from "./modules/loyalty/loyalty.repository";
import { createMemoryLoyaltyRepository } from "./modules/loyalty/loyalty.repository.memory";
import { createSqliteLoyaltyRepository } from "./modules/loyalty/loyalty.repository.sqlite";
import { LoyaltyService } from "./modules/loyalty/loyalty.service";
import { registerLoyaltySubscribers } from "./modules/loyalty/loyalty.subscribers";
import type { MaintenanceRepository } from "./modules/maintenance/maintenance.repository";
import { createMemoryMaintenanceRepository } from "./modules/maintenance/maintenance.repository.memory";
import { createSqliteMaintenanceRepository } from "./modules/maintenance/maintenance.repository.sqlite";
import { MaintenanceService } from "./modules/maintenance/maintenance.service";
import { registerMaintenanceSubscribers } from "./modules/maintenance/maintenance.subscribers";
import type { NotificationRepository } from "./modules/notification/notification.repository";
import { createMemoryNotificationRepository } from "./modules/notification/notification.repository.memory";
import { createSqliteNotificationRepository } from "./modules/notification/notification.repository.sqlite";
import { ConsoleChannel, NotificationService, type NotificationChannel } from "./modules/notification/notification.service";
import { registerNotificationSubscribers } from "./modules/notification/notification.subscribers";
import type { OrderRepository } from "./modules/order/order.repository";
import { createMemoryOrderRepository } from "./modules/order/order.repository.memory";
import { createSqliteOrderRepository } from "./modules/order/order.repository.sqlite";
import { MockPaymentGateway, OrderService, type PaymentGateway } from "./modules/order/order.service";
import type { ReportingRepository } from "./modules/reporting/reporting.repository";
import { createMemoryReportingRepository } from "./modules/reporting/reporting.repository.memory";
import { createSqliteReportingRepository } from "./modules/reporting/reporting.repository.sqlite";
import { ReportingService } from "./modules/reporting/reporting.service";
import type { ShopNetworkRepository } from "./modules/shop-network/shop-network.repository";
import { createMemoryShopNetworkRepository } from "./modules/shop-network/shop-network.repository.memory";
import { createSqliteShopNetworkRepository } from "./modules/shop-network/shop-network.repository.sqlite";
import { ShopNetworkService } from "./modules/shop-network/shop-network.service";
import type { VehicleRepository } from "./modules/vehicle/vehicle.repository";
import { createMemoryVehicleRepository } from "./modules/vehicle/vehicle.repository.memory";
import { createSqliteVehicleRepository } from "./modules/vehicle/vehicle.repository.sqlite";
import { VehicleService } from "./modules/vehicle/vehicle.service";

export interface Repositories {
  auth: AuthRepository;
  vehicle: VehicleRepository;
  shops: ShopNetworkRepository;
  catalog: CatalogRepository;
  orders: OrderRepository;
  fulfillment: FulfillmentRepository;
  loyalty: LoyaltyRepository;
  notification: NotificationRepository;
  maintenance: MaintenanceRepository;
  reporting: ReportingRepository;
}

export interface Container {
  config: Config;
  clock: Clock;
  logger: Logger;
  tokens: TokenService;
  events: EventBus;
  queue: QueueDriver;
  cache: Cache;
  repos: Repositories;
  middleware: AuthMiddleware;
  auth: AuthService;
  vehicles: VehicleService;
  shops: ShopNetworkService;
  catalog: CatalogService;
  orders: OrderService;
  fulfillment: FulfillmentService;
  loyalty: LoyaltyService;
  notifications: NotificationService;
  maintenance: MaintenanceService;
  reporting: ReportingService;
  connectors: ConnectorRegistry;
  /** Releases DB / Redis connections. */
  close(): Promise<void>;
}

export interface ContainerOverrides {
  clock?: Clock;
  payments?: PaymentGateway;
  channel?: NotificationChannel;
  queue?: QueueDriver;
  cache?: Cache;
  /** false = don't start background polling (tests drive the queue with runDue()/drain()). */
  startQueue?: boolean;
  /** Injected into every HTTP connector (tests point it at a fake external system). */
  fetchImpl?: typeof fetch;
}

function buildRepositories(config: Config): { repos: Repositories; db: SqliteDb | null; close: () => Promise<void> } {
  if (config.DATA_DRIVER === "memory") {
    const store = createMemoryStore();
    return {
      db: null,
      close: async () => undefined,
      repos: {
        auth: createMemoryAuthRepository(store),
        vehicle: createMemoryVehicleRepository(store),
        shops: createMemoryShopNetworkRepository(store),
        catalog: createMemoryCatalogRepository(store),
        orders: createMemoryOrderRepository(store),
        fulfillment: createMemoryFulfillmentRepository(store),
        loyalty: createMemoryLoyaltyRepository(store),
        notification: createMemoryNotificationRepository(store),
        maintenance: createMemoryMaintenanceRepository(store),
        reporting: createMemoryReportingRepository(store)
      }
    };
  }
  const db = openSqlite(config.SQLITE_PATH);
  return {
    db,
    close: async () => {
      db.close();
    },
    repos: {
      auth: createSqliteAuthRepository(db),
      vehicle: createSqliteVehicleRepository(db),
      shops: createSqliteShopNetworkRepository(db),
      catalog: createSqliteCatalogRepository(db),
      orders: createSqliteOrderRepository(db),
      fulfillment: createSqliteFulfillmentRepository(db),
      loyalty: createSqliteLoyaltyRepository(db),
      notification: createSqliteNotificationRepository(db),
      maintenance: createSqliteMaintenanceRepository(db),
      reporting: createSqliteReportingRepository(db)
    }
  };
}

/** Composition root — the only file that knows every module. Wires services, subscribers and queue jobs. */
export async function createContainer(
  config: Config,
  logger: Logger,
  overrides: ContainerOverrides = {}
): Promise<Container> {
  const clock = overrides.clock ?? systemClock;
  const { repos, db, close: closeDb } = buildRepositories(config);

  // Queue: BullMQ when Redis is configured; otherwise a durable queue in the same SQLite file;
  // the in-process queue only for the memory driver (tests / demos — delayed jobs are lost on restart).
  let queue: QueueDriver;
  let cache: Cache;
  const startQueue = overrides.startQueue ?? true;
  if (overrides.queue) queue = overrides.queue;
  else if (config.REDIS_URL) {
    const { BullMqQueueDriver } = await import("./platform/queue.bullmq");
    queue = new BullMqQueueDriver(config.REDIS_URL, logger);
  } else if (db) {
    const durable = new SqliteQueueDriver(db, clock, logger);
    if (startQueue) durable.start();
    queue = durable;
  } else {
    const inline = new InlineQueueDriver(clock, logger);
    if (startQueue) inline.start();
    queue = inline;
  }
  if (overrides.cache) cache = overrides.cache;
  else cache = config.REDIS_URL ? new RedisCache(config.REDIS_URL) : new MemoryCache(clock);

  const events = new InProcessEventBus(logger);
  const tokens = createTokenService({ storefront: config.JWT_SECRET_STOREFRONT, admin: config.JWT_SECRET_ADMIN });

  const auth = new AuthService({ repo: repos.auth, tokens, bcryptCost: config.BCRYPT_COST });
  const middleware = createAuthMiddleware(tokens, auth);
  const vehicles = new VehicleService(repos.vehicle, { events, managedExternally: config.VEHICLE_SOURCE === "http" });
  const shops = new ShopNetworkService({
    repo: repos.shops,
    clock,
    events,
    managedExternally: config.SHOP_SOURCE === "http"
  });
  const catalog = new CatalogService({ repo: repos.catalog, cache, shops, vehicles, events, clock });
  const loyalty = new LoyaltyService({ repo: repos.loyalty, auth });
  const fulfillmentRef: { current?: FulfillmentService } = {};
  const connectors = new ConnectorRegistry({ clock, logger });
  const http = (name: "vehicles" | "shops" | "commerce", token: string | undefined) =>
    createHttpJsonClient({ name, token, timeoutMs: config.CONNECTOR_TIMEOUT_MS, fetchImpl: overrides.fetchImpl });

  let commerce: CommerceConnector | null = null;
  if (config.COMMERCE_CONNECTOR === "http" && config.COMMERCE_API_URL) {
    const inner = createHttpCommerceConnector({
      client: http("commerce", config.COMMERCE_API_TOKEN),
      baseUrl: config.COMMERCE_API_URL,
      skuMap: config.COMMERCE_SKU_MAP,
      returnUrlTemplate: config.COMMERCE_RETURN_URL
    });
    // Record each call's outcome for the admin connector page.
    commerce = {
      async createCheckout(input) {
        try {
          const res = await inner.createCheckout(input);
          connectors.recordCall("commerce", "ok", null);
          return res;
        } catch (err) {
          const reason = err instanceof ConnectorError ? err.reason : String(err);
          connectors.recordCall("commerce", "error", reason);
          logger.error({ connector: "commerce", orderId: input.orderId, err: reason }, "external checkout failed");
          throw err;
        }
      }
    };
  }

  const orders = new OrderService({
    repo: repos.orders, catalog, shops, vehicles, loyalty, auth, events, clock,
    payments: overrides.payments ?? new MockPaymentGateway(),
    commerce,
    bookings: { findByOrderId: (id) => fulfillmentRef.current?.findByOrderId(id) ?? Promise.resolve(null) }
  });
  const fulfillment = new FulfillmentService({ repo: repos.fulfillment, orders, shops, clock, logger });
  fulfillmentRef.current = fulfillment;
  const notifications = new NotificationService({
    repo: repos.notification, auth, orders, channel: overrides.channel ?? new ConsoleChannel(logger), logger
  });
  const maintenance = new MaintenanceService({ repo: repos.maintenance });
  const reporting = new ReportingService({ repo: repos.reporting, catalog, clock });

  registerCatalogSubscribers({ events, catalog });
  registerLoyaltySubscribers({ events, queue, loyalty });
  registerMaintenanceSubscribers({ events, queue, maintenance });
  registerNotificationSubscribers({ events, queue, notifications, now: () => clock.now() });
  await registerFulfillmentJobs({ queue, fulfillment });

  const vehicleUrl = config.VEHICLE_SOURCE === "http" ? config.VEHICLE_SOURCE_URL : undefined;
  const vehicleFeed = vehicleUrl ? createHttpVehicleFeed(http("vehicles", config.VEHICLE_SOURCE_TOKEN), vehicleUrl) : null;
  connectors.register({
    name: "vehicles",
    label: "車型資料",
    mode: vehicleFeed ? "http" : "local",
    endpointHost: endpointHost(vehicleUrl),
    sync: vehicleFeed ? async () => vehicles.syncFromFeed(await vehicleFeed.fetchAll()) : undefined
  });
  const shopUrl = config.SHOP_SOURCE === "http" ? config.SHOP_SOURCE_URL : undefined;
  const shopFeed = shopUrl ? createHttpShopFeed(http("shops", config.SHOP_SOURCE_TOKEN), shopUrl) : null;
  connectors.register({
    name: "shops",
    label: "安裝店家清單",
    mode: shopFeed ? "http" : "local",
    endpointHost: endpointHost(shopUrl),
    sync: shopFeed ? async () => shops.syncFromFeed(await shopFeed.fetchAll()) : undefined
  });
  connectors.register({
    name: "commerce",
    label: "購物車／結帳",
    mode: commerce ? "http" : "local",
    endpointHost: endpointHost(commerce ? config.COMMERCE_API_URL : undefined)
  });
  await connectors.schedule(queue, config.CONNECTOR_SYNC_INTERVAL_MIN * 60_000);

  return {
    config, clock, logger, tokens, events, queue, cache, repos, middleware,
    auth, vehicles, shops, catalog, orders, fulfillment, loyalty, notifications, maintenance, reporting, connectors,
    close: async () => {
      await queue.close();
      await closeDb();
    }
  };
}

export type { AdminRole };
