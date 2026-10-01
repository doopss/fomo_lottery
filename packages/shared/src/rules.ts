/** Integer US cents. 500 = $5.00. */
export const DEFAULT_MIN_HOLD_USD_CENTS = 500;
export const DEFAULT_MIN_WINDOW_BUY_USD_CENTS = 500;
/** Extra entries added on top of the base entry. */
export const DEFAULT_BONUS_ENTRIES = 2;

export type FailReason =
  | "unresolved_identity"
  | "duplicate_fomo_account"
  | "no_thesis"
  | "not_holding"
  | "below_min_hold";

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
  /** Token amount in base units at the snapshot. Zero fails the hold. */
  balanceRaw: bigint;
  /** Mark-to-market value of that balance in integer US cents. */
  holdingValueUsdCents: number;
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
  minHoldUsdCents: number;
  minWindowBuyUsdCents: number;
  bonusEntries: number;
}

export interface EligibilityResult {
  eligible: boolean;
  /** 0 when ineligible, 1 for a base entry, 1 + bonusEntries when the window buy qualifies. */
  entryCount: number;
  bonusApplied: boolean;
  failReason: FailReason | null;
  flags: EligibilityFlag[];
}

export const defaultEligibilityConfig: EligibilityConfig = {
  minHoldUsdCents: DEFAULT_MIN_HOLD_USD_CENTS,
  minWindowBuyUsdCents: DEFAULT_MIN_WINDOW_BUY_USD_CENTS,
  bonusEntries: DEFAULT_BONUS_ENTRIES,
};

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
  return { eligible: false, entryCount: 0, bonusApplied: false, failReason: reason, flags };
}

/**
 * Base entry: a resolved fomo account, a thesis, and at least $5 held at the
 * snapshot. A buy of at least $5 during the window adds bonus entries. The
 * buy does not qualify anyone by itself.
 *
 * One fail reason, first match wins: unresolved identity, duplicate fomo
 * account, missing thesis, zero balance, then hold value under the minimum.
 *
 * Account age and trade history are not inputs. In-window buy cents are
 * summed at swap time. Sells do not reduce that sum. Thesis text has no
 * minimum length. A thesis posted before the window counts.
 * Shared-funding-source and duplicate-thesis are flags, not failures.
 */
export function evaluateEligibility(
  buyer: EligibilityBuyer,
  window: DrawWindow,
  config: EligibilityConfig = defaultEligibilityConfig,
): EligibilityResult {
  if (window.start.getTime() > window.end.getTime()) {
    throw new Error("window start must be at or before window end");
  }
  assertNonNegativeSafeInteger(config.minHoldUsdCents, "minHoldUsdCents");
  assertNonNegativeSafeInteger(config.minWindowBuyUsdCents, "minWindowBuyUsdCents");
  assertNonNegativeSafeInteger(config.bonusEntries, "bonusEntries");
  assertNonNegativeSafeInteger(buyer.holdingValueUsdCents, "holdingValueUsdCents");

  const flags = flagsFor(buyer);
  const handle = buyer.fomoHandle?.trim() ?? "";
  if (handle.length === 0) {
    return fail("unresolved_identity", flags);
  }
  if (buyer.duplicateFomoAccount) {
    return fail("duplicate_fomo_account", flags);
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
  if (buyer.holdingValueUsdCents < config.minHoldUsdCents) {
    return fail("below_min_hold", flags);
  }

  let buyCents = 0;
  for (const swap of buyer.swaps) {
    assertNonNegativeSafeInteger(swap.usdValueCents, "usdValueCents");
    const at = swap.blockTime.getTime();
    const inWindow = at >= window.start.getTime() && at <= window.end.getTime();
    if (!inWindow || swap.side !== "buy") {
      continue;
    }
    buyCents += swap.usdValueCents;
    if (!Number.isSafeInteger(buyCents)) {
      throw new Error("in-window buy sum is outside the safe integer range");
    }
  }

  const bonusApplied = buyCents >= config.minWindowBuyUsdCents;
  const entryCount = 1 + (bonusApplied ? config.bonusEntries : 0);
  return { eligible: true, entryCount, bonusApplied, failReason: null, flags };
}
