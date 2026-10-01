import { describe, expect, it } from "vitest";

import { closeHolderSnapshot } from "./snapshot.js";
import { parseHoldersPage } from "./holders.js";
import {
  lamportsToUsdCents,
  parseEnhancedSwap,
  priceWindowSwap,
  uiSolToLamports,
  usdPriceToCents,
  WSOL_MINT,
} from "./swaps.js";

const mint = "DrawMint";
const buyer = "BuyerWallet";

function swapTx(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fee: 5000,
    feePayer: buyer,
    signature: "sig-buy",
    slot: 10,
    timestamp: 1_780_000_000,
    tokenTransfers: [
      { fromUserAccount: "Pool", toUserAccount: buyer, mint, tokenAmount: 1000 },
      { fromUserAccount: buyer, toUserAccount: "Pool", mint: WSOL_MINT, tokenAmount: 0.05 },
    ],
    accountData: [
      {
        account: buyer,
        nativeBalanceChange: -50_005_000,
        tokenBalanceChanges: [
          { userAccount: buyer, mint, rawTokenAmount: { tokenAmount: "1000000", decimals: 6 } },
        ],
      },
    ],
    ...overrides,
  };
}

describe("swap pricing", () => {
  it("converts a SOL price string and lamports into integer cents", () => {
    expect(usdPriceToCents("100")).toBe(10_000);
    expect(usdPriceToCents("150.2")).toBe(15_020);
    expect(usdPriceToCents("150.256")).toBe(15_026);
    expect(lamportsToUsdCents(50_000_000n, 10_000)).toBe(500);
    expect(uiSolToLamports(0.05)).toBe(50_000_000n);
  });
});

describe("parseEnhancedSwap", () => {
  it("reads a buy as the mint received and the WSOL spent", () => {
    const swap = parseEnhancedSwap(swapTx(), mint);
    expect(swap).toMatchObject({
      signature: "sig-buy",
      wallet: buyer,
      side: "buy",
      tokenAmount: 1_000_000n,
      solLamports: 50_000_000n,
      slot: 10,
    });
    expect(priceWindowSwap(swap!, 10_000).usdValueCents).toBe(500);
  });

  it("reads a sell without treating the SOL received as a buy", () => {
    const swap = parseEnhancedSwap(
      swapTx({
        signature: "sig-sell",
        tokenTransfers: [
          { fromUserAccount: buyer, toUserAccount: "Pool", mint, tokenAmount: 1000 },
          { fromUserAccount: "Pool", toUserAccount: buyer, mint: WSOL_MINT, tokenAmount: 0.2 },
        ],
        accountData: [
          {
            account: buyer,
            nativeBalanceChange: -5000,
            tokenBalanceChanges: [
              { userAccount: buyer, mint, rawTokenAmount: { tokenAmount: "-1000000", decimals: 6 } },
            ],
          },
        ],
      }),
      mint,
    );
    expect(swap?.side).toBe("sell");
    expect(swap?.solLamports).toBe(200_000_000n);
  });

  it("ignores a swap that does not change the fee payer's mint balance", () => {
    expect(parseEnhancedSwap(swapTx({ accountData: [] }), mint)).toBeNull();
  });
});

describe("closeHolderSnapshot window buys", () => {
  const window = {
    start: new Date("2026-10-01T02:00:00.000Z"),
    end: new Date("2026-10-01T03:00:00.000Z"),
  };
  const observedAt = new Date("2026-10-01T02:30:00.000Z");
  const page = parseHoldersPage({
    source: "live-fomo",
    count: 1,
    stale: false,
    ageSeconds: 10,
    holders: [
      {
        handle: "nova",
        wallet: { solana: "Wa11etAaa" },
        amount: 100,
        valueUsd: 15,
        thesis: "holding through the hour",
      },
    ],
  });

  it("adds two entries when in-window buys reach $5 and ignores sells", () => {
    const withBonus = closeHolderSnapshot({
      page,
      window,
      observedAt,
      confirmedBalances: new Map([["Wa11etAaa", 5n]]),
      windowSwaps: new Map([
        [
          "Wa11etAaa",
          [
            { side: "buy", usdValueCents: 200, blockTime: observedAt },
            { side: "buy", usdValueCents: 300, blockTime: observedAt },
            { side: "sell", usdValueCents: 10_000, blockTime: observedAt },
          ],
        ],
      ]),
    });
    expect(withBonus.rows[0]?.result).toMatchObject({ eligible: true, entryCount: 3, bonusApplied: true });

    const short = closeHolderSnapshot({
      page,
      window,
      observedAt,
      confirmedBalances: new Map([["Wa11etAaa", 5n]]),
      windowSwaps: new Map([["Wa11etAaa", [{ side: "buy", usdValueCents: 499, blockTime: observedAt }]]]),
    });
    expect(short.rows[0]?.result).toMatchObject({ eligible: true, entryCount: 1, bonusApplied: false });
  });
});
