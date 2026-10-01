export function formatLamports(lamports: bigint): string {
  const negative = lamports < 0n;
  const abs = negative ? -lamports : lamports;
  const whole = abs / 1_000_000_000n;
  const frac = (abs % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  const body = frac.length > 0 ? `${whole.toString()}.${frac}` : whole.toString();
  return negative ? `-${body}` : body;
}

export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new Error("cents must be an integer");
  }
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}$${whole.toString()}.${frac}`;
}
