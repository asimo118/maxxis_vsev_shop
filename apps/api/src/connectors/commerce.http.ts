import { externalCheckoutResponse, type ExternalCheckoutRequest } from "@vsev/shared";
import type { CommerceCheckoutInput, CommerceConnector } from "../modules/order/commerce.port";
import type { HttpJsonClient } from "./http-json";

export interface HttpCommerceOptions {
  client: HttpJsonClient;
  /** Base URL of the external commerce API; checkouts are created with POST {base}/checkouts. */
  baseUrl: string;
  /** Campaign slug → external SKU. Unmapped campaigns send their slug as the SKU. */
  skuMap: Record<string, string>;
  /** Where the external cart sends the shopper back; `{orderId}` is substituted. */
  returnUrlTemplate: string;
}

/** Cart connector: hands the validated local order to an external cart and returns its checkout URL. */
export function createHttpCommerceConnector(opts: HttpCommerceOptions): CommerceConnector {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/checkouts`;
  return {
    async createCheckout(input: CommerceCheckoutInput) {
      const body: ExternalCheckoutRequest = {
        ...input,
        sku: opts.skuMap[input.campaignSlug] ?? input.campaignSlug,
        returnUrl: opts.returnUrlTemplate.replaceAll("{orderId}", encodeURIComponent(input.orderId))
      };
      return opts.client.post(url, body, externalCheckoutResponse);
    }
  };
}
