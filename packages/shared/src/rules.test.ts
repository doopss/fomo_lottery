import { describe, expect, it } from "vitest";

import {
  evaluateEligibility,
  type DrawWindow,
  type EligibilityBuyer,
  type EligibilitySwap,
} from "./rules.js";

const window: DrawWindow = {
  start: new Date("2026-09-30T12:00:00.000Z"),
  end: new Date("2026-09-30T18:00:00.000Z"),
};

function buy(cents: number, iso: string): EligibilitySwap {
  return { side: "buy", usdValueCents: cents, blockTime: new Date(iso) };
}

function passingBuyer(overrides: Partial<EligibilityBuyer> = {}): EligibilityBuyer {
  return {
    wallet: "Wa11etAaa11111111111111111111111111111111",
    fomoHandle: "nova",
    thesis: { text: "x", postedAt: new Date("2026-09-29T00:00:00.000Z") },
    swaps: [buy(500, "2026-09-30T13:00:00.000Z")],
    balanceRaw: 1n,
    holdingValueUsdCents: 500,
    sharedFundingSource: false,
    duplicateThesis: false,
    duplicateFomoAccount: false,
    ...overrides,
  };
}

describe("evaluateEligibility", () => {
  it("gives one entry to a new holder with a thesis and no window buy", () => {
    const result = evaluateEligibility(passingBuyer({ swaps: [] }), window);
    expect(result).toEqual({
      eligible: true,
      entryCount: 1,
      bonusApplied: false,
      failReason: null,
      flags: [],
    });
  });

  it("adds two bonus entries for a $5 buy in the window", () => {
    const result = evaluateEligibility(passingBuyer(), window);
    expect(result.eligible).toBe(true);
    expect(result.entryCount).toBe(3);
    expect(result.bonusApplied).toBe(true);
  });

  it("does not award the bonus at 499 cents, and does at exactly 500", () => {
    const under = evaluateEligibility(passingBuyer({ swaps: [buy(499, "2026-09-30T13:00:00.000Z")] }), window);
    expect(under.entryCount).toBe(1);
    expect(under.bonusApplied).toBe(false);

    const exact = evaluateEligibility(passingBuyer({ swaps: [buy(500, "2026-09-30T13:00:00.000Z")] }), window);
    expect(exact.entryCount).toBe(3);
  });

  it("sums in-window buys, ignores sells, and counts the window boundaries", () => {
    const summed = evaluateEligibility(
      passingBuyer({
        swaps: [
          buy(200, "2026-09-30T13:00:00.000Z"),
          buy(300, "2026-09-30T14:00:00.000Z"),
          { side: "sell", usdValueCents: 10_000, blockTime: new Date("2026-09-30T15:00:00.000Z") },
        ],
      }),
      window,
    );
    expect(summed.entryCount).toBe(3);

    const outside = evaluateEligibility(passingBuyer({ swaps: [buy(5_000, "2026-09-30T11:59:59.000Z")] }), window);
    expect(outside.entryCount).toBe(1);

    const atStart = evaluateEligibility(passingBuyer({ swaps: [buy(500, "2026-09-30T12:00:00.000Z")] }), window);
    const atEnd = evaluateEligibility(passingBuyer({ swaps: [buy(500, "2026-09-30T18:00:00.000Z")] }), window);
    expect(atStart.bonusApplied).toBe(true);
    expect(atEnd.bonusApplied).toBe(true);
  });

  it("does not let a window buy qualify a wallet that fails the base entry", () => {
    const underHold = evaluateEligibility(
      passingBuyer({ holdingValueUsdCents: 499, swaps: [buy(5_000, "2026-09-30T13:00:00.000Z")] }),
      window,
    );
    expect(underHold.eligible).toBe(false);
    expect(underHold.entryCount).toBe(0);
    expect(underHold.failReason).toBe("below_min_hold");
  });

  it("fails closed when the handle is missing", () => {
    expect(evaluateEligibility(passingBuyer({ fomoHandle: null }), window).failReason).toBe("unresolved_identity");
    expect(evaluateEligibility(passingBuyer({ fomoHandle: "  " }), window).failReason).toBe("unresolved_identity");
  });

  it("fails when the fomo handle is already claimed", () => {
    const result = evaluateEligibility(passingBuyer({ duplicateFomoAccount: true }), window);
    expect(result.failReason).toBe("duplicate_fomo_account");
    expect(result.entryCount).toBe(0);
  });

  it("fails when the thesis is missing, blank, undated, or posted after the window", () => {
    expect(evaluateEligibility(passingBuyer({ thesis: null }), window).failReason).toBe("no_thesis");
    expect(evaluateEligibility(passingBuyer({ thesis: { text: "  ", postedAt: window.start } }), window).failReason).toBe(
      "no_thesis",
    );
    expect(
      evaluateEligibility(
        passingBuyer({ thesis: { text: "late", postedAt: new Date("2026-09-30T18:00:00.001Z") } }),
        window,
      ).failReason,
    ).toBe("no_thesis");
    expect(
      evaluateEligibility(passingBuyer({ thesis: { text: "undated", postedAt: new Date("not-a-date") } }), window)
        .failReason,
    ).toBe("no_thesis");
  });

  it("accepts a one-character thesis posted before the window or at window end", () => {
    expect(evaluateEligibility(passingBuyer({ swaps: [] }), window).eligible).toBe(true);
    expect(
      evaluateEligibility(
        passingBuyer({ swaps: [], thesis: { text: "x", postedAt: new Date("2026-09-30T18:00:00.000Z") } }),
        window,
      ).entryCount,
    ).toBe(1);
  });

  it("fails when the snapshot balance is empty or worth under $5", () => {
    expect(evaluateEligibility(passingBuyer({ balanceRaw: 0n }), window).failReason).toBe("not_holding");
    expect(evaluateEligibility(passingBuyer({ balanceRaw: -1n }), window).failReason).toBe("not_holding");
    expect(evaluateEligibility(passingBuyer({ holdingValueUsdCents: 499 }), window).failReason).toBe("below_min_hold");
    expect(evaluateEligibility(passingBuyer({ holdingValueUsdCents: 500, swaps: [] }), window).entryCount).toBe(1);
  });

  it("keeps shared-funding and duplicate-thesis holders eligible", () => {
    const both = evaluateEligibility(passingBuyer({ sharedFundingSource: true, duplicateThesis: true, swaps: [] }), window);
    expect(both.eligible).toBe(true);
    expect(both.entryCount).toBe(1);
    expect(both.flags).toEqual(["shared_funding_source", "duplicate_thesis"]);
  });

  it("still reports flags when another rule fails", () => {
    const result = evaluateEligibility(
      passingBuyer({ fomoHandle: null, sharedFundingSource: true, duplicateThesis: true }),
      window,
    );
    expect(result.failReason).toBe("unresolved_identity");
    expect(result.flags).toEqual(["shared_funding_source", "duplicate_thesis"]);
  });

  it("uses the earliest failing rule", () => {
    expect(
      evaluateEligibility(
        passingBuyer({ fomoHandle: null, duplicateFomoAccount: true, thesis: null, balanceRaw: 0n, holdingValueUsdCents: 0 }),
        window,
      ).failReason,
    ).toBe("unresolved_identity");
    expect(
      evaluateEligibility(
        passingBuyer({ duplicateFomoAccount: true, thesis: null, balanceRaw: 0n, holdingValueUsdCents: 0 }),
        window,
      ).failReason,
    ).toBe("duplicate_fomo_account");
    expect(evaluateEligibility(passingBuyer({ thesis: null, balanceRaw: 0n, holdingValueUsdCents: 0 }), window).failReason).toBe(
      "no_thesis",
    );
    expect(evaluateEligibility(passingBuyer({ balanceRaw: 0n, holdingValueUsdCents: 0 }), window).failReason).toBe(
      "not_holding",
    );
  });

  it("honors custom thresholds and rejects non-integers", () => {
    const custom = evaluateEligibility(passingBuyer({ swaps: [buy(100, "2026-09-30T13:00:00.000Z")], holdingValueUsdCents: 100 }), window, {
      minHoldUsdCents: 100,
      minWindowBuyUsdCents: 100,
      bonusEntries: 1,
    });
    expect(custom.entryCount).toBe(2);

    expect(() => evaluateEligibility(passingBuyer({ holdingValueUsdCents: 10.5 }), window)).toThrow(/holdingValueUsdCents/);
    expect(() => evaluateEligibility(passingBuyer({ swaps: [buy(10.5, "2026-09-30T13:00:00.000Z")] }), window)).toThrow(
      /usdValueCents/,
    );
  });
});
