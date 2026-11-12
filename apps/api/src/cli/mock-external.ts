import { createMockExternalApp } from "../dev/mock-external";

/**
 * `pnpm mock:external` — a fake external system on :4100 for local development.
 * Point the API at it (see docs/connectors.md → "Try it locally").
 */
const port = Number(process.env["MOCK_EXTERNAL_PORT"] ?? 4100);
const { app } = createMockExternalApp({
  publicUrl: `http://localhost:${port}`,
  apiUrl: process.env["MOCK_API_URL"] ?? "http://localhost:4000",
  webhookSecret: process.env["COMMERCE_WEBHOOK_SECRET"] ?? "dev-commerce-webhook-secret",
  token: process.env["MOCK_EXTERNAL_TOKEN"]
});
app.listen(port, () => console.log(`mock external system on http://localhost:${port}`));
