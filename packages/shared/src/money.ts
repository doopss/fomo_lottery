/** Nearest integer US cent. 5 → 500. Rejects NaN, negatives, and unsafe results. */
export function usdToCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("usd value must be a non-negative finite number");
  }
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new Error("usd value is outside the safe integer cent range");
  }
  return cents;
}
