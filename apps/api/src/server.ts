import { createApp } from "./app";
import { createContainer } from "./container";
import { loadConfig } from "./platform/config";
import { createLogger } from "./platform/logger";
import { seed } from "./seed";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger();
  const container = await createContainer(config, logger);
  // Pull external master data (vehicle models, shops) before anything depends on it. A failure is
  // logged and the last good local copy is used; the scheduled sync keeps retrying.
  for (const s of await container.connectors.syncAll()) {
    if (s.lastResult === "error") logger.warn({ connector: s.name, reason: s.lastMessage }, "initial connector sync failed");
  }
  if (config.SEED_ON_BOOT) {
    await seed(container, { adminEmail: config.SEED_ADMIN_EMAIL, adminPassword: config.SEED_ADMIN_PASSWORD });
    logger.info("seed data ensured");
  }
  const server = createApp(container).listen(config.PORT, () => logger.info({ port: config.PORT }, "api listening"));
  const shutdown = (): void => {
    server.close(() => {
      void container.close().finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
