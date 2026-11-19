import { randomBytes } from "node:crypto";
import { createContainer } from "../container";
import { loadConfig } from "../platform/config";
import { createLogger } from "../platform/logger";

/**
 * Break-glass recovery when no manager can sign in:
 *   docker exec -it <api container> node dist/admin-reset.mjs someone@example.com
 * Sets a random temporary password (printed once), re-activates the account as a manager and ends its
 * sessions. Creates the account if it does not exist. Change the password in 帳號設定 right after.
 */
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("usage: node dist/admin-reset.mjs <email>");
  process.exit(2);
}
const config = loadConfig();
const container = await createContainer(config, createLogger(), { startQueue: false });
const password = randomBytes(12).toString("base64url");
const admin = await container.auth.upsertAdmin({ email, password, name: email.split("@")[0] ?? "Admin", role: "manager" });
await container.close();
console.log(`admin ${admin.email} is an active manager. Temporary password (shown once): ${password}`);
