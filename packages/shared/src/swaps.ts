import { z } from "zod";

import type { DrawWindow, EligibilitySwap } from "./rules.js";

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

const LAMPORTS_PER_SOL = 1_000_000_000n;

export interface ParsedWindowSwap {
  signature: string;
  wallet: string;
  side: "buy" | "sell";
  /** Absolute token amount in base units. */
  tokenAmount: bigint;
  /** SOL leg in lamports. Buys are SOL spent. Sells are SOL received. */
  solLamports: bigint;
  slot: number;
  blockTime: Date;
}

const rawAmountSchema = z.object({
  tokenAmount: z.string().regex(/^-?\d+$/),
  decimals: z.number().int().nonnegative(),
});

const enhancedSwapSchema = z
  .object({
    fee: z.number().int().nonnegative().optional(),
    feePayer: z.string().min(1),
    signature: z.string().min(1),
    slot: z.number().int().nonnegative(),
    timestamp: z.number().int().nonnegative(),
    tokenTransfers: z
      .array(
        z
          .object({
            fromUserAccount: z.string().nullable().optional(),
            toUserAccount: z.string().nullable().optional(),
            mint: z.string(),
            tokenAmount: z.number().finite().nonnegative(),
          })
          .passthrough(),
      )
      .optional(),
    accountData: z
      .array(
        z
          .object({
            account: z.string(),
            nativeBalanceChange: z.number().int().optional(),
            tokenBalanceChanges: z
              .array(
                z
                  .object({
                    userAccount: z.string().optional(),
                    mint: z.string(),
                    rawTokenAmount: rawAmountSchema,
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export type EnhancedSwapTransaction = z.infer<typeof enhancedSwapSchema>;

/** Coinbase-style decimal string to integer cents. "150.2" → 15020. */
export function usdPriceToCents(amount: string): number {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error("usd price must be a non-negative decimal string");
  }
  const [whole, fraction = ""] = amount.split(".");
  const centsText = `${fraction}00`.slice(0, 2);
  const roundUp = (fraction[2] ?? "0") >= "5";
  const cents = Number(whole) * 100 + Number(centsText) + (roundUp ? 1 : 0);
  if (!Number.isSafeInteger(cents)) {
    throw new Error("usd price is outside the safe integer cent range");
  }
  return cents;
}

/** SOL lamports times a SOL price in integer cents, rounded to the nearest cent. */
export function lamportsToUsdCents(lamports: bigint, solUsdCents: number): number {
  if (!Number.isSafeInteger(solUsdCents) || solUsdCents < 0) {
    throw new Error("solUsdCents must be a non-negative safe integer");
  }
  if (lamports < 0n) {
    throw new Error("lamports must be non-negative");
  }
  const cents = (lamports * BigInt(solUsdCents) + LAMPORTS_PER_SOL / 2n) / LAMPORTS_PER_SOL;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("swap usd value is outside the safe integer cent range");
  }
  return Number(cents);
}

export function uiSolToLamports(amount: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("sol amount must be a non-negative finite number");
  }
  const [whole, fraction = ""] = amount.toFixed(9).split(".");
  return BigInt(whole ?? "0") * LAMPORTS_PER_SOL + BigInt((fraction ?? "").padEnd(9, "0").slice(0, 9));
}

/**
 * One enhanced Helius swap. A buy receives the mint and spends WSOL.
 * A sell sends the mint. Transactions that do not change the fee payer's
 * balance of the mint are ignored.
 */
export function parseEnhancedSwap(data: unknown, mint: string): ParsedWindowSwap | null {
  const tx = enhancedSwapSchema.parse(data);
  let rawDelta = 0n;
  for (const account of tx.accountData ?? []) {
    for (const change of account.tokenBalanceChanges ?? []) {
      if (change.mint !== mint) {
        continue;
      }
      const owner = change.userAccount ?? account.account;
      if (owner !== tx.feePayer) {
        continue;
      }
      rawDelta += BigInt(change.rawTokenAmount.tokenAmount);
    }
  }
  if (rawDelta === 0n) {
    return null;
  }

  const side = rawDelta > 0n ? "buy" : "sell";
  let solLamports = 0n;
  for (const transfer of tx.tokenTransfers ?? []) {
    if (transfer.mint !== WSOL_MINT) {
      continue;
    }
    const fromPayer = transfer.fromUserAccount === tx.feePayer;
    const toPayer = transfer.toUserAccount === tx.feePayer;
    if (side === "buy" && fromPayer) {
      solLamports += uiSolToLamports(transfer.tokenAmount);
    }
    if (side === "sell" && toPayer) {
      solLamports += uiSolToLamports(transfer.tokenAmount);
    }
  }
  if (solLamports === 0n && side === "buy") {
    const payer = (tx.accountData ?? []).find((account) => account.account === tx.feePayer);
    const change = payer?.nativeBalanceChange;
    if (change !== undefined && change < 0) {
      const spent = BigInt(-change);
      const fee = BigInt(tx.fee ?? 0);
      solLamports = spent > fee ? spent - fee : spent;
    }
  }

  return {
    signature: tx.signature,
    wallet: tx.feePayer,
    side,
    tokenAmount: rawDelta > 0n ? rawDelta : -rawDelta,
    solLamports,
    slot: tx.slot,
    blockTime: new Date(tx.timestamp * 1000),
  };
}

const coinbaseSolPriceSchema = z
  .object({
    data: z.object({ amount: z.string() }).passthrough(),
  })
  .passthrough();

const binanceSolPriceSchema = z.object({ price: z.string() }).passthrough();

export function parseCoinbaseSolPrice(data: unknown): number {
  return usdPriceToCents(coinbaseSolPriceSchema.parse(data).data.amount);
}

export function parseBinanceSolPrice(data: unknown): number {
  return usdPriceToCents(binanceSolPriceSchema.parse(data).price);
}

export interface SwapPage {
  swaps: ParsedWindowSwap[];
  count: number;
  oldestMs: number | null;
  lastSignature: string | null;
  reachedBeforeWindow: boolean;
}

/** Keeps swaps inside the window. Newest-first pages set reachedBeforeWindow once history is older than the start. */
export function readSwapPage(data: unknown, mint: string, window: DrawWindow): SwapPage {
  if (!Array.isArray(data)) {
    throw new Error("helius swaps: expected an array");
  }
  const swaps: ParsedWindowSwap[] = [];
  let oldestMs: number | null = null;
  let lastSignature: string | null = null;
  let reachedBeforeWindow = false;
  for (const item of data) {
    const tx = enhancedSwapSchema.parse(item);
    const atMs = tx.timestamp * 1000;
    oldestMs = oldestMs === null ? atMs : Math.min(oldestMs, atMs);
    lastSignature = tx.signature;
    if (atMs < window.start.getTime()) {
      reachedBeforeWindow = true;
      continue;
    }
    if (atMs > window.end.getTime()) {
      continue;
    }
    const swap = parseEnhancedSwap(tx, mint);
    if (swap !== null) {
      swaps.push(swap);
    }
  }
  return { swaps, count: data.length, oldestMs, lastSignature, reachedBeforeWindow };
}

export function priceWindowSwap(swap: ParsedWindowSwap, solUsdCents: number): EligibilitySwap {
  return {
    side: swap.side,
    usdValueCents: lamportsToUsdCents(swap.solLamports, solUsdCents),
    blockTime: swap.blockTime,
  };
}

export function swapsByWallet(
  swaps: readonly ParsedWindowSwap[],
  solUsdCents: number,
): Map<string, EligibilitySwap[]> {
  const grouped = new Map<string, EligibilitySwap[]>();
  for (const swap of swaps) {
    const priced = priceWindowSwap(swap, solUsdCents);
    const existing = grouped.get(swap.wallet);
    if (existing === undefined) {
      grouped.set(swap.wallet, [priced]);
    } else {
      existing.push(priced);
    }
  }
  return grouped;
}
