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
    sharedFundingSource: false,
    duplicateThesis: false,
    duplicateFomoAccount: false,
    ...overrides,
  };
}

describe("evaluateEligibility", () => {
  it("accepts a brand-new fomo user with a one-character thesis and no extra history", () => {
    const result = evaluateEligibility(passingBuyer(), window);
    expect(result).toEqual({ eligible: true, failReason: null, flags: [] });
  });

  it("fails closed when the handle is missing", () => {
    expect(evaluateEligibility(passingBuyer({ fomoHandle: null }), window).failReason).toBe("unresolved_identity");
    expect(evaluateEligibility(passingBuyer({ fomoHandle: "  " }), window).failReason).toBe("unresolved_identity");
  });

  it("fails when the fomo handle is already claimed", () => {
    expect(evaluateEligibility(passingBuyer({ duplicateFomoAccount: true }), window).failReason).toBe(
      "duplicate_fomo_account",
    );
  });

  it("fails when there is no in-window buy", () => {
    expect(evaluateEligibility(passingBuyer({ swaps: [] }), window).failReason).toBe("no_buy_in_window");
    expect(
      evaluateEligibility(
        passingBuyer({
          swaps: [{ side: "sell", usdValueCents: 5_000, blockTime: new Date("2026-09-30T13:00:00.000Z") }],
        }),
        window,
      ).failReason,
    ).toBe("no_buy_in_window");
    expect(
      evaluateEligibility(passingBuyer({ swaps: [buy(5_000, "2026-09-30T11:59:59.000Z")] }), window).failReason,
    ).toBe("no_buy_in_window");
    expect(
      evaluateEligibility(passingBuyer({ swaps: [buy(5_000, "2026-09-30T18:00:00.001Z")] }), window).failReason,
    ).toBe("no_buy_in_window");
  });

  it("treats window start and end as inclusive", () => {
    expect(
      evaluateEligibility(passingBuyer({ swaps: [buy(500, "2026-09-30T12:00:00.000Z")] }), window).eligible,
    ).toBe(true);
    expect(
      evaluateEligibility(passingBuyer({ swaps: [buy(500, "2026-09-30T18:00:00.000Z")] }), window).eligible,
    ).toBe(true);
  });

  it("fails below $5 and passes at exactly 500 cents", () => {
    expect(evaluateEligibility(passingBuyer({ swaps: [buy(499, "2026-09-30T13:00:00.000Z")] }), window).failReason).toBe(
      "below_min_buy",
    );
    expect(evaluateEligibility(passingBuyer({ swaps: [buy(500, "2026-09-30T13:00:00.000Z")] }), window).eligible).toBe(
      true,
    );
  });

  it("sums in-window buys and does not subtract sells", () => {
    const summed = evaluateEligibility(
      passingBuyer({
        swaps: [buy(200, "2026-09-30T13:00:00.000Z"), buy(300, "2026-09-30T14:00:00.000Z")],
      }),
      window,
    );
    expect(summed.eligible).toBe(true);

    const sold = evaluateEligibility(
      passingBuyer({
        swaps: [
          buy(500, "2026-09-30T13:00:00.000Z"),
          { side: "sell", usdValueCents: 500, blockTime: new Date("2026-09-30T15:00:00.000Z") },
        ],
      }),
      window,
    );
    expect(sold.eligible).toBe(true);
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

  it("accepts a thesis posted before the window and one posted at window end", () => {
    expect(evaluateEligibility(passingBuyer(), window).eligible).toBe(true);
    expect(
      evaluateEligibility(
        passingBuyer({ thesis: { text: "x", postedAt: new Date("2026-09-30T18:00:00.000Z") } }),
        window,
      ).eligible,
    ).toBe(true);
  });

  it("fails when the snapshot balance is not positive", () => {
    expect(evaluateEligibility(passingBuyer({ balanceRaw: 0n }), window).failReason).toBe("not_holding");
    expect(evaluateEligibility(passingBuyer({ balanceRaw: -1n }), window).failReason).toBe("not_holding");
  });

  it("keeps shared-funding and duplicate-thesis buyers eligible", () => {
    const shared = evaluateEligibility(passingBuyer({ sharedFundingSource: true }), window);
    expect(shared).toEqual({ eligible: true, failReason: null, flags: ["shared_funding_source"] });

    const copied = evaluateEligibility(passingBuyer({ duplicateThesis: true }), window);
    expect(copied).toEqual({ eligible: true, failReason: null, flags: ["duplicate_thesis"] });

    const both = evaluateEligibility(passingBuyer({ sharedFundingSource: true, duplicateThesis: true }), window);
    expect(both.eligible).toBe(true);
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
    const unresolved = evaluateEligibility(
      passingBuyer({ fomoHandle: null, duplicateFomoAccount: true, swaps: [], thesis: null, balanceRaw: 0n }),
      window,
    );
    expect(unresolved.failReason).toBe("unresolved_identity");

    const duplicate = evaluateEligibility(
      passingBuyer({ duplicateFomoAccount: true, swaps: [], thesis: null, balanceRaw: 0n }),
      window,
    );
    expect(duplicate.failReason).toBe("duplicate_fomo_account");

    const noBuy = evaluateEligibility(passingBuyer({ swaps: [], thesis: null, balanceRaw: 0n }), window);
    expect(noBuy.failReason).toBe("no_buy_in_window");

    const cheap = evaluateEligibility(
      passingBuyer({ swaps: [buy(100, "2026-09-30T13:00:00.000Z")], thesis: null, balanceRaw: 0n }),
      window,
    );
    expect(cheap.failReason).toBe("below_min_buy");

    const noThesis = evaluateEligibility(passingBuyer({ thesis: null, balanceRaw: 0n }), window);
    expect(noThesis.failReason).toBe("no_thesis");
  });

  it("honors a custom minimum and rejects non-integers", () => {
    const lowBar = evaluateEligibility(passingBuyer({ swaps: [buy(100, "2026-09-30T13:00:00.000Z")] }), window, {
      minBuyUsdCents: 100,
    });
    expect(lowBar.eligible).toBe(true);
    expect(() => evaluateEligibility(passingBuyer({ swaps: [buy(10.5, "2026-09-30T13:00:00.000Z")] }), window)).toThrow(
      /usdValueCents/,
    );
    expect(() => evaluateEligibility(passingBuyer(), window, { minBuyUsdCents: 5.5 })).toThrow(/minBuyUsdCents/);
  });
});
