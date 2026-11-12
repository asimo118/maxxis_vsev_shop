import type { CheckoutDto } from "@vsev/shared";
import { api } from "./api";

/**
 * Runs the order's checkout step. With the built-in payment the order comes back paid; with the cart
 * connector the browser is sent to the external cart, which returns the shopper to /orders/:id?from=checkout.
 * Returns true when the page is being redirected away.
 */
export async function startCheckout(orderId: string): Promise<boolean> {
  const res = await api.post<CheckoutDto>(`/orders/${orderId}/checkout`);
  if (res.mode === "redirect") {
    window.location.assign(res.url);
    return true;
  }
  return false;
}

export async function checkoutMode(): Promise<"internal" | "external"> {
  try {
    return (await api.get<{ mode: "internal" | "external" }>("/checkout-config")).mode;
  } catch {
    return "internal";
  }
}
