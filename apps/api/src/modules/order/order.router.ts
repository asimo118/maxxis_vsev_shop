import { createHmac, timingSafeEqual } from "node:crypto";
import { adminNoteBody, adminOrderQuery, commerceWebhookBody, createOrderBody, paymentWebhookBody } from "@vsev/shared";
import { Router } from "express";
import { errors } from "../../platform/errors";
import { asyncHandler, param, parseWith } from "../../platform/http";
import { adminOf, userIdOf, type AuthMiddleware } from "../auth/auth.middleware";
import type { OrderService } from "./order.service";

function verifySignature(secret: string, raw: Buffer | undefined, header: string | undefined): boolean {
  if (!raw || !header) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header, "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function createOrderRouter(
  orders: OrderService,
  mw: AuthMiddleware,
  opts: { webhookSecret?: string; commerceWebhookSecret?: string }
): Router {
  const router = Router();

  router.post(
    "/orders",
    mw.requireUser,
    asyncHandler(async (req, res) => {
      // Give the specific code (E2005) for the "forgot to tick the deadline box" case.
      if ((req.body as { deadlineAcknowledged?: unknown } | undefined)?.deadlineAcknowledged !== true) {
        throw errors.deadlineNotAcknowledged();
      }
      res.status(201).json(await orders.create(userIdOf(req), parseWith(createOrderBody, req.body)));
    })
  );

  router.get(
    "/me/orders",
    mw.requireUser,
    asyncHandler(async (req, res) => {
      res.json(await orders.listMine(userIdOf(req)));
    })
  );

  router.get(
    "/me/orders/:id",
    mw.requireUser,
    asyncHandler(async (req, res) => {
      res.json(await orders.getMine(userIdOf(req), param(req, "id")));
    })
  );

  router.post(
    "/orders/:id/pay",
    mw.requireUser,
    asyncHandler(async (req, res) => {
      res.json(await orders.pay(userIdOf(req), param(req, "id")));
    })
  );

  /** Lets the storefront word its checkout step ("pay here" vs "continue to the shop's cart"). */
  router.get("/checkout-config", (_req, res) => {
    res.json({ mode: orders.checkoutMode });
  });

  /** Storefront "pay" step: built-in payment, or a redirect to the external cart (see CheckoutDto). */
  router.post(
    "/orders/:id/checkout",
    mw.requireUser,
    asyncHandler(async (req, res) => {
      res.json(await orders.checkout(userIdOf(req), param(req, "id")));
    })
  );

  router.post(
    "/orders/:id/cancel",
    mw.requireUser,
    asyncHandler(async (req, res) => {
      res.json(await orders.cancelMine(userIdOf(req), param(req, "id")));
    })
  );

  /** Gateway callback. Idempotent per gatewayTxnId; signature-checked when a secret is configured. */
  router.post(
    "/payments/webhook",
    asyncHandler(async (req, res) => {
      if (opts.webhookSecret && !verifySignature(opts.webhookSecret, req.rawBody, req.header("x-vsev-signature"))) {
        throw errors.unauthenticated();
      }
      const body = parseWith(paymentWebhookBody, req.body);
      await orders.handlePaymentResult(body.orderId, body.gatewayTxnId, body.status);
      res.json({ ok: true });
    })
  );

  /**
   * Cart connector callback. Answers 404 unless a cart connector is configured; the
   * HMAC-SHA256 signature (hex, header x-vsev-signature) over the raw body is always required.
   */
  router.post(
    "/connectors/commerce/webhook",
    asyncHandler(async (req, res) => {
      if (orders.checkoutMode !== "external" || !opts.commerceWebhookSecret) throw errors.notFound();
      if (!verifySignature(opts.commerceWebhookSecret, req.rawBody, req.header("x-vsev-signature"))) {
        throw errors.unauthenticated();
      }
      res.json(await orders.handleCommerceEvent(parseWith(commerceWebhookBody, req.body)));
    })
  );

  return router;
}

export function createOrderAdminRouter(orders: OrderService, mw: AuthMiddleware): Router {
  const router = Router();

  router.get(
    "/orders",
    asyncHandler(async (req, res) => {
      res.json(await orders.adminSearch(parseWith(adminOrderQuery, req.query)));
    })
  );

  router.get(
    "/orders/:id",
    asyncHandler(async (req, res) => {
      res.json(await orders.adminGet(param(req, "id")));
    })
  );

  router.post(
    "/orders/:id/cancel",
    mw.allow("operator", "manager"),
    asyncHandler(async (req, res) => {
      const { note } = parseWith(adminNoteBody, req.body ?? {});
      res.json(await orders.adminCancel(param(req, "id"), adminOf(req).adminId, note));
    })
  );

  router.post(
    "/orders/:id/refund",
    mw.allow("finance", "manager"),
    asyncHandler(async (req, res) => {
      const { note } = parseWith(adminNoteBody, req.body ?? {});
      res.json(await orders.adminRefund(param(req, "id"), adminOf(req).adminId, note));
    })
  );

  return router;
}
