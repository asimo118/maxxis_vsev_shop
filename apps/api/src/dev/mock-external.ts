import { createHmac, randomUUID } from "node:crypto";
import {
  SEED_SHOPS,
  SEED_VEHICLE_MODELS,
  formatTWD,
  type CommerceWebhookBody,
  type ExternalCheckoutRequest,
  type ExternalShop,
  type ExternalVehicleModel
} from "@vsev/shared";
import express, { type Express } from "express";

/**
 * A FAKE external system implementing the three connector contracts (docs/connectors.md).
 * For local development and tests only — it is not a real cart and never takes money.
 *
 *   GET  /vehicle-models          vehicle feed
 *   GET  /shops                   shop-directory feed
 *   POST /checkouts               create an external checkout → { externalRef, checkoutUrl }
 *   GET  /cart/:ref               a plain "external cart" page with pay / cancel buttons
 *   POST /cart/:ref/:action       sends the signed webhook back to the API, then returns the shopper
 */
export interface MockExternalOptions {
  /** Public base URL of this mock (used to build checkoutUrl). */
  publicUrl: string;
  /** API base, e.g. http://localhost:4000 — webhooks go to {apiUrl}/api/v1/connectors/commerce/webhook. */
  apiUrl: string;
  webhookSecret: string;
  /** When set, every request must carry `Authorization: Bearer <token>`. */
  token?: string;
}

export interface MockExternalState {
  vehicles: ExternalVehicleModel[];
  shops: ExternalShop[];
  checkouts: Map<string, ExternalCheckoutRequest>;
  /** Make the next request fail, to exercise error handling. */
  failNext: null | "http500" | "badPayload" | "hang";
}

export function createMockExternalApp(opts: MockExternalOptions): { app: Express; state: MockExternalState } {
  const state: MockExternalState = {
    vehicles: SEED_VEHICLE_MODELS.map((m) => ({ id: m.id, label: m.label, active: true })),
    shops: SEED_SHOPS.map((s) => ({ ...s, phone: s.phone ?? null, active: true })),
    checkouts: new Map(),
    failNext: null
  };
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    if (req.path.startsWith("/cart/")) return next(); // browser pages
    if (opts.token && req.header("authorization") !== `Bearer ${opts.token}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const fail = state.failNext;
    state.failNext = null;
    if (fail === "http500") {
      res.status(500).json({ error: "boom" });
      return;
    }
    if (fail === "badPayload") {
      res.json({ items: [{ id: "", label: 42 }] });
      return;
    }
    if (fail === "hang") return; // never answers → client timeout
    next();
  });

  app.get("/vehicle-models", (_req, res) => {
    res.json({ items: state.vehicles });
  });
  app.get("/shops", (_req, res) => {
    res.json(state.shops);
  });
  app.post("/checkouts", (req, res) => {
    const body = req.body as ExternalCheckoutRequest;
    const externalRef = `EXT-${randomUUID().slice(0, 8).toUpperCase()}`;
    state.checkouts.set(externalRef, body);
    res.status(201).json({ externalRef, checkoutUrl: `${opts.publicUrl}/cart/${externalRef}` });
  });

  app.get("/cart/:ref", (req, res) => {
    const c = state.checkouts.get(req.params.ref);
    if (!c) {
      res.status(404).send("not found");
      return;
    }
    const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
    res.type("html").send(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>模擬外部購物車（開發用）</title>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#1b222b">
<p style="background:#fff4d6;border:1px solid #e8c25a;padding:8px 12px;border-radius:6px">⚠ 這是開發用的模擬外部系統，不會真的扣款。</p>
<h1 style="font-size:22px">外部購物車 &nbsp;${esc(req.params.ref)}</h1>
<p>${esc(c.productName)} × ${c.quantity} &nbsp;<b>${esc(formatTWD(c.unitPriceCents))}</b></p>
<p>訂單 ${esc(c.orderNumber)}・SKU ${esc(c.sku)}<br>安裝店家：${esc(c.installShop.name)}<br>車型／車牌：${esc(c.vehicle.modelLabel)}・${esc(c.vehicle.plate)}</p>
<form method="post" action="/cart/${esc(req.params.ref)}/pay" style="display:inline"><button style="padding:10px 18px">模擬付款成功</button></form>
<form method="post" action="/cart/${esc(req.params.ref)}/cancel" style="display:inline;margin-left:8px"><button style="padding:10px 18px">取消</button></form>
</body></html>`);
  });

  app.post("/cart/:ref/:action", async (req, res) => {
    const c = state.checkouts.get(req.params.ref);
    if (!c || (req.params.action !== "pay" && req.params.action !== "cancel")) {
      res.status(404).send("not found");
      return;
    }
    const event: CommerceWebhookBody = {
      eventId: randomUUID(),
      type: req.params.action === "pay" ? "order.paid" : "order.cancelled",
      orderId: c.orderId,
      externalRef: req.params.ref
    };
    await sendSignedWebhook(opts.apiUrl, opts.webhookSecret, event);
    res.redirect(303, c.returnUrl);
  });

  return { app, state };
}

/** Exactly what a real external system must do: HMAC-SHA256 (hex) over the raw JSON body. */
export async function sendSignedWebhook(apiUrl: string, secret: string, event: CommerceWebhookBody): Promise<Response> {
  const raw = JSON.stringify(event);
  return fetch(`${apiUrl}/api/v1/connectors/commerce/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-vsev-signature": signBody(secret, raw) },
    body: raw
  });
}

export function signBody(secret: string, raw: string): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
}
