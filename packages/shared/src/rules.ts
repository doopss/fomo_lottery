/** Integer US cents. 500 = $5.00. */
export const DEFAULT_MIN_BUY_USD_CENTS = 500;

export type FailReason =
  | "unresolved_identity"
  | "duplicate_fomo_account"
  | "no_buy_in_window"
  | "below_min_buy"
  | "no_thesis"
  | "not_holding";

/** Recorded for review. These do not make a buyer ineligible. */
export type EligibilityFlag = "shared_funding_source" | "duplicate_thesis";

export interface EligibilitySwap {
  side: "buy" | "sell";
  /** Integer US cents at swap time. Never a float. */
  usdValueCents: number;
  blockTime: Date;
}

export interface EligibilityBuyer {
  wallet: string;
  fomoHandle: string | null;
  thesis: { text: string; postedAt: Date } | null;
  swaps: EligibilitySwap[];
  /** Token amount in base units. Any value above 0n counts as holding. */
  balanceRaw: bigint;
  sharedFundingSource: boolean;
  duplicateThesis: boolean;
  /**
   * True when another wallet already claimed this fomo handle for the window.
   * The caller chooses which wallet keeps the entry.
   */
  duplicateFomoAccount: boolean;
}

export interface DrawWindow {
  start: Date;
  end: Date;
}

export interface EligibilityConfig {
  minBuyUsdCents: number;
}

export interface EligibilityResult {
  eligible: boolean;
  failReason: FailReason | null;
  flags: EligibilityFlag[];
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function flagsFor(buyer: EligibilityBuyer): EligibilityFlag[] {
  const flags: EligibilityFlag[] = [];
  if (buyer.sharedFundingSource) {
    flags.push("shared_funding_source");
  }
  if (buyer.duplicateThesis) {
    flags.push("duplicate_thesis");
  }
  return flags;
}

function fail(reason: FailReason, flags: EligibilityFlag[]): EligibilityResult {
  return { eligible: false, failReason: reason, flags };
}

/**
 * One fail reason, first match wins:
 * unresolved identity, duplicate fomo account, no in-window buy,
 * buy sum under the minimum, missing thesis, then zero balance.
 *
 * A resolved fomo handle is the "bought through fomo" signal. There is no
 * separate venue check. Account age and trade history are not inputs, so a
 * brand-new fomo user can pass.
 *
 * In-window buy cents are summed. Sells do not reduce that sum.
 * Thesis text has no minimum length. A thesis posted before the window counts.
 * Shared-funding-source and duplicate-thesis are flags, not failures.
 */
export function evaluateEligibility(
  buyer: EligibilityBuyer,
  window: DrawWindow,
  config: EligibilityConfig = { minBuyUsdCents: DEFAULT_MIN_BUY_USD_CENTS },
): EligibilityResult {
  if (window.start.getTime() > window.end.getTime()) {
    throw new Error("window start must be at or before window end");
  }
  assertNonNegativeSafeInteger(config.minBuyUsdCents, "minBuyUsdCents");

  const flags = flagsFor(buyer);
  const handle = buyer.fomoHandle?.trim() ?? "";
  if (handle.length === 0) {
    return fail("unresolved_identity", flags);
  }
  if (buyer.duplicateFomoAccount) {
    return fail("duplicate_fomo_account", flags);
  }

  let buyCents = 0;
  let sawBuy = false;
  for (const swap of buyer.swaps) {
    assertNonNegativeSafeInteger(swap.usdValueCents, "usdValueCents");
    const at = swap.blockTime.getTime();
    const inWindow = at >= window.start.getTime() && at <= window.end.getTime();
    if (!inWindow || swap.side !== "buy") {
      continue;
    }
    sawBuy = true;
    buyCents += swap.usdValueCents;
    if (!Number.isSafeInteger(buyCents)) {
      throw new Error("in-window buy sum is outside the safe integer range");
    }
  }

  if (!sawBuy) {
    return fail("no_buy_in_window", flags);
  }
  if (buyCents < config.minBuyUsdCents) {
    return fail("below_min_buy", flags);
  }

  const thesis = buyer.thesis;
  const postedAt = thesis?.postedAt.getTime();
  if (
    thesis === null ||
    thesis.text.trim().length === 0 ||
    postedAt === undefined ||
    Number.isNaN(postedAt) ||
    postedAt > window.end.getTime()
  ) {
    return fail("no_thesis", flags);
  }
  if (buyer.balanceRaw <= 0n) {
    return fail("not_holding", flags);
  }

  return { eligible: true, failReason: null, flags };
}
