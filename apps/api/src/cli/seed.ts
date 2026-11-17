import { createContainer } from "../container";
import { loadConfig } from "../platform/config";
import { createLogger } from "../platform/logger";
import { seed } from "../seed";

/** `pnpm db:seed` — idempotent: creates the first campaign, shops, templates and admin if missing. */
const config = loadConfig();
const container = await createContainer(config, createLogger(), { startQueue: false });
await container.connectors.syncAll(); // external vehicle models / shops first, so seed can assign them
await seed(container, { adminEmail: config.SEED_ADMIN_EMAIL, adminPassword: config.SEED_ADMIN_PASSWORD });
await container.close();
console.log(`seeded ${config.DATA_DRIVER === "sqlite" ? config.SQLITE_PATH : "(memory)"}`);
