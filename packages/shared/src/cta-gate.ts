/**
 * The purchase-button gate. Three conditions must ALL hold before the CTA activates:
 * vehicle model chosen → install shop chosen → install deadline acknowledged.
 * The storefront renders it; the API re-checks the same conditions on POST /orders.
 */
export type CtaMissing = "vehicle" | "shop" | "deadline";

export interface CtaGateInput {
  vehicleModelId?: string | null;
  shopId?: string | null;
  deadlineAcknowledged: boolean;
  /** Already-formatted price, e.g. "NT$ 32,800". */
  priceLabel: string;
}

export interface CtaGateResult {
  ready: boolean;
  missing: CtaMissing[];
  /** Button text — tells the shopper which step is still open. */
  label: string;
}

const PROMPTS: Record<CtaMissing, string> = {
  vehicle: "請先選擇車型",
  shop: "請選擇安裝店家",
  deadline: "請確認安裝期限"
};

export function evaluateCtaGate(input: CtaGateInput): CtaGateResult {
  const missing: CtaMissing[] = [];
  if (!input.vehicleModelId) missing.push("vehicle");
  if (!input.shopId) missing.push("shop");
  if (!input.deadlineAcknowledged) missing.push("deadline");

  const first = missing[0];
  return {
    ready: missing.length === 0,
    missing,
    label: first ? PROMPTS[first] : `加入購物車・${input.priceLabel}`
  };
}
