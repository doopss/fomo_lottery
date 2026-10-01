import { describe, expect, it } from "vitest";

import { parseHoldersPage, type HoldersPage } from "./holders.js";
import { usdToCents } from "./money.js";
import { parseTokenBalance } from "./rpc-balance.js";
import { closeHolderSnapshot } from "./snapshot.js";
import type { DrawWindow } from "./rules.js";

const window: DrawWindow = {
  start: new Date("2026-10-01T02:00:00.000Z"),
  end: new Date("2026-10-01T03:00:00.000Z"),
};

const observedAt = new Date("2026-10-01T02:30:00.000Z");

function page(overrides: Partial<HoldersPage> = {}): HoldersPage {
  return {
    source: "live-fomo",
    count: 1,
    totalHolders: 10,
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
    ...overrides,
  };
}

describe("usdToCents", () => {
  it("rounds a dollar amount to integer cents", () => {
    expect(usdToCents(5)).toBe(500);
    expect(usdToCents(4.994)).toBe(499);
    expect(usdToCents(0)).toBe(0);
  });

  it("rejects values that are not a non-negative finite number", () => {
    expect(() => usdToCents(Number.NaN)).toThrow(/usd value/);
    expect(() => usdToCents(-1)).toThrow(/usd value/);
  });
});

describe("parseHoldersPage", () => {
  it("parses a tracked holder with a thesis string", () => {
    const parsed = parseHoldersPage(page());
    expect(parsed.holders[0]?.handle).toBe("nova");
    expect(parsed.totalHolders).toBe(10);
  });

  it("rejects a holder without a handle", () => {
    expect(() => parseHoldersPage({ count: 1, holders: [{ amount: 1, valueUsd: 1 }] })).toThrow();
  });
});

describe("parseTokenBalance", () => {
  it("sums base-unit amounts and ignores the float ui amount", () => {
    const balance = parseTokenBalance({
      jsonrpc: "2.0",
      result: {
        value: [
          {
            account: {
              data: {
                parsed: {
                  info: { tokenAmount: { amount: "1000", decimals: 6, uiAmount: 0.001 } },
                },
              },
            },
          },
          {
            account: {
              data: {
                parsed: { info: { tokenAmount: { amount: "5", decimals: 6, uiAmount: 0.000005 } } },
              },
            },
          },
        ],
      },
    });
    expect(balance).toBe(1005n);
  });
});

describe("closeHolderSnapshot", () => {
  it("gives one base entry to a thesis holder at or above $5 and does not publish without a confirmed balance", () => {
    const snapshot = closeHolderSnapshot({ page: page(), window, observedAt });
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]?.result).toMatchObject({ eligible: true, entryCount: 1, bonusApplied: false, failReason: null });
    expect(snapshot.rows[0]?.balanceRaw).toBeNull();
    expect(snapshot.publishable).toBe(false);
    expect(snapshot.publishBlockers).toContain("token balances were not confirmed");
  });

  it("fails a holder under $5 and a holder with no thesis", () => {
    const snapshot = closeHolderSnapshot({
      page: page({
        count: 2,
        holders: [
          { handle: "pebble", wallet: { solana: "Wa11etBbb" }, amount: 10, valueUsd: 4.99, thesis: "almost" },
          { handle: "quartz", wallet: { solana: "Wa11etCcc" }, amount: 80, valueUsd: 20, thesis: null },
        ],
      }),
      window,
      observedAt,
      confirmedBalances: new Map([
        ["Wa11etBbb", 10n],
        ["Wa11etCcc", 80n],
      ]),
    });
    expect(snapshot.rows.find((row) => row.fomoHandle === "pebble")?.result.failReason).toBe("below_min_hold");
    expect(snapshot.rows.find((row) => row.fomoHandle === "quartz")?.result.failReason).toBe("no_thesis");
    expect(snapshot.publishable).toBe(true);
  });

  it("skips a tracked holder with no solana wallet", () => {
    const snapshot = closeHolderSnapshot({
      page: page({
        holders: [{ handle: "evm-only", wallet: { solana: null, evm: "0xabc" }, amount: 5, valueUsd: 20, thesis: "yes" }],
      }),
      window,
      observedAt,
      confirmedBalances: new Map(),
    });
    expect(snapshot.rows).toHaveLength(0);
    expect(snapshot.skippedWithoutSolanaWallet).toBe(1);
    expect(snapshot.publishable).toBe(true);
  });

  it("keeps the larger wallet for one fomo handle and flags a copied thesis", () => {
    const snapshot = closeHolderSnapshot({
      page: page({
        count: 2,
        holders: [
          { handle: "nova", wallet: { solana: "Wa11etAaa" }, amount: 1, valueUsd: 6, thesis: "same words" },
          { handle: "nova", wallet: { solana: "Wa11etEee" }, amount: 1, valueUsd: 40, thesis: "same words" },
          { handle: "umber", wallet: { solana: "Wa11etFff" }, amount: 1, valueUsd: 12, thesis: "Same Words" },
        ],
      }),
      window,
      observedAt,
      confirmedBalances: new Map([
        ["Wa11etAaa", 2n],
        ["Wa11etEee", 9n],
        ["Wa11etFff", 4n],
      ]),
    });
    expect(snapshot.rows.find((row) => row.wallet === "Wa11etAaa")?.result.failReason).toBe("duplicate_fomo_account");
    expect(snapshot.rows.find((row) => row.wallet === "Wa11etEee")?.result).toMatchObject({
      eligible: true,
      entryCount: 1,
      flags: ["duplicate_thesis"],
    });
    expect(snapshot.rows.find((row) => row.wallet === "Wa11etFff")?.result.flags).toEqual(["duplicate_thesis"]);
  });

  it("collapses two handles on one solana wallet and flags shared funding", () => {
    const snapshot = closeHolderSnapshot({
      page: page({
        holders: [
          { handle: "nova", wallet: { solana: "Wa11etAaa" }, amount: 1, valueUsd: 6, thesis: "one" },
          { handle: "umber", wallet: { solana: "Wa11etAaa" }, amount: 1, valueUsd: 9, thesis: "two" },
        ],
      }),
      window,
      observedAt,
      confirmedBalances: new Map([["Wa11etAaa", 3n]]),
    });
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({
      fomoHandle: "umber",
      result: { eligible: true, flags: ["shared_funding_source"] },
    });
  });

  it("turns a confirmed zero balance into not holding even when fomo still prices the bag", () => {
    const snapshot = closeHolderSnapshot({
      page: page(),
      window,
      observedAt,
      confirmedBalances: new Map([["Wa11etAaa", 0n]]),
    });
    expect(snapshot.rows[0]?.result.failReason).toBe("not_holding");
    expect(snapshot.rows[0]?.holdingValueUsdCents).toBe(0);
    expect(snapshot.publishable).toBe(true);
  });

  it("accepts a live holder list that omits stale and age", () => {
    const snapshot = closeHolderSnapshot({
      page: page({ ageSeconds: undefined, stale: undefined, source: "live-fomo" }),
      window,
      observedAt,
      confirmedBalances: new Map([["Wa11etAaa", 5n]]),
    });
    expect(snapshot.stale).toBe(false);
    expect(snapshot.publishable).toBe(true);
    expect(snapshot.publishBlockers).toEqual([]);
  });

  it("refuses a holder list marked stale in the source name", () => {
    const snapshot = closeHolderSnapshot({
      page: page({ source: "live-fomo-stale", stale: undefined, ageSeconds: undefined }),
      window,
      observedAt,
      confirmedBalances: new Map([["Wa11etAaa", 5n]]),
    });
    expect(snapshot.publishable).toBe(false);
    expect(snapshot.publishBlockers).toContain("holder list is stale");
  });

  it("refuses a stale holder list that was captured outside the window", () => {
    const snapshot = closeHolderSnapshot({
      page: page({ stale: true, ageSeconds: 4000 }),
      window,
      observedAt: new Date("2026-10-01T01:10:00.000Z"),
      confirmedBalances: new Map([["Wa11etAaa", 5n]]),
    });
    expect(snapshot.publishable).toBe(false);
    expect(snapshot.publishBlockers).toEqual([
      "holder list is stale",
      "holder list is older than 120 seconds",
      "holder list was captured outside the window",
    ]);
  });
});
