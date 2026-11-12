/** Money is always an integer in minor units: 100 cents = NT$1. Floats are never used for money. */
export const CENTS_PER_NTD = 100;

export function assertInteger(value: number, label = "value"): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer, got ${value}`);
  }
  return value;
}

/** Whole New Taiwan dollars → cents. */
export function ntd(amount: number): number {
  return assertInteger(amount, "NT$ amount") * CENTS_PER_NTD;
}

/** Cents → "NT$ 32,800". Fractional NT$ (never produced by the app) are shown with two decimals. */
export function formatTWD(cents: number): string {
  assertInteger(cents, "cents");
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / CENTS_PER_NTD);
  const rest = abs % CENTS_PER_NTD;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}NT$ ${grouped}${rest === 0 ? "" : `.${rest.toString().padStart(2, "0")}`}`;
}
