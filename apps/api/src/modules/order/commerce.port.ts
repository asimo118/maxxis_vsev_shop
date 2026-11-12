import type { ExternalCheckoutRequest, ExternalCheckoutResponse } from "@vsev/shared";

/**
 * Port for the cart / checkout connector. When one is configured, payment happens in the external
 * commerce system: the order (with every local validation already passed) is handed over and the
 * shopper is redirected to `checkoutUrl`; the external system reports back via the commerce webhook.
 * When none is configured, checkout uses the built-in PaymentGateway.
 *
 * The adapter adds `sku` and `returnUrl` from its own configuration.
 */
export type CommerceCheckoutInput = Omit<ExternalCheckoutRequest, "sku" | "returnUrl">;

export interface CommerceConnector {
  createCheckout(input: CommerceCheckoutInput): Promise<ExternalCheckoutResponse>;
}
