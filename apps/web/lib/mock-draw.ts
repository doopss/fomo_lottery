import {
  defaultEligibilityConfig,
  evaluateEligibility,
  type DrawWindow,
  type EligibilityBuyer,
  type EligibilityResult,
  type FailReason,
  type MerkleEntrant,
} from "@draw/shared";

import { formatCents } from "./format";

export const MOCK_WINDOW: DrawWindow = {
  start: new Date("2026-10-01T02:00:00.000Z"),
  end: new Date("2026-10-01T03:00:00.000Z"),
};

export const MOCK_POT_LAMPORTS = 12_500_000_000n;
export const MOCK_CLOSE_ISO = MOCK_WINDOW.end.toISOString();
export const MIN_HOLD_USD_CENTS = defaultEligibilityConfig.minHoldUsdCents;
export const MIN_WINDOW_BUY_USD_CENTS = defaultEligibilityConfig.minWindowBuyUsdCents;
export const BONUS_ENTRIES = defaultEligibilityConfig.bonusEntries;

const inWindow = "2026-10-01T02:30:00.000Z";

export const MOCK_BUYERS: EligibilityBuyer[] = [
  {
    wallet: "Wa11etAaa11111111111111111111111111111111",
    fomoHandle: "nova",
    thesis: { text: "x", postedAt: new Date("2026-09-29T08:00:00.000Z") },
    swaps: [{ side: "buy", usdValueCents: 500, blockTime: new Date(inWindow) }],
    balanceRaw: 1_000_000n,
    holdingValueUsdCents: 1_500,
    sharedFundingSource: false,
    duplicateThesis: false,
    duplicateFomoAccount: false,
  },
  {
    wallet: "Wa11etBbb11111111111111111111111111111111",
    fomoHandle: "pebble",
    thesis: { text: "buying the draw", postedAt: new Date("2026-09-30T12:30:00.000Z") },
    swaps: [{ side: "buy", usdValueCents: 499, blockTime: new Date(inWindow) }],
    balanceRaw: 2_000_000n,
    holdingValueUsdCents: 2_000,
    sharedFundingSource: false,
    duplicateThesis: false,
    duplicateFomoAccount: false,
  },
  {
    wallet: "Wa11etCcc11111111111111111111111111111111",
    fomoHandle: "quartz",
    thesis: null,
    swaps: [{ side: "buy", usdValueCents: 2_500, blockTime: new Date(inWindow) }],
    balanceRaw: 4_000_000n,
    holdingValueUsdCents: 4_000,
    sharedFundingSource: false,
    duplicateThesis: false,
    duplicateFomoAccount: false,
  },
  {
    wallet: "Wa11etDdd11111111111111111111111111111111",
    fomoHandle: "ridge",
    thesis: { text: "holding through the snapshot", postedAt: new Date("2026-09-28T00:00:00.000Z") },
    swaps: [{ side: "buy", usdValueCents: 800, blockTime: new Date(inWindow) }],
    balanceRaw: 0n,
    holdingValueUsdCents: 0,
    sharedFundingSource: false,
    duplicateThesis: false,
    duplicateFomoAccount: false,
  },
  {
    wallet: "Wa11etEee11111111111111111111111111111111",
    fomoHandle: "nova",
    thesis: { text: "second wallet", postedAt: new Date("2026-09-29T00:00:00.000Z") },
    swaps: [{ side: "buy", usdValueCents: 5_000, blockTime: new Date(inWindow) }],
    balanceRaw: 9_000_000n,
    holdingValueUsdCents: 9_000,
    sharedFundingSource: true,
    duplicateThesis: false,
    duplicateFomoAccount: true,
  },
  {
    wallet: "Wa11etFff11111111111111111111111111111111",
    fomoHandle: "umber",
    thesis: { text: "same words as someone else", postedAt: new Date("2026-09-30T15:00:00.000Z") },
    swaps: [{ side: "buy", usdValueCents: 1_200, blockTime: new Date(inWindow) }],
    balanceRaw: 3n,
    holdingValueUsdCents: 1_200,
    sharedFundingSource: true,
    duplicateThesis: true,
    duplicateFomoAccount: false,
  },
];

export interface MockDraw {
  id: string;
  status: "open" | "settled";
  windowStart: string;
  windowEnd: string;
  entrants: MerkleEntrant[];
  potLamports: bigint;
  winnerWallet: string | null;
  winnerFomo: string | null;
  settleSig: string | null;
}

export function eligibleEntrants(buyers: EligibilityBuyer[] = MOCK_BUYERS, window: DrawWindow = MOCK_WINDOW): MerkleEntrant[] {
  const entrants: MerkleEntrant[] = [];
  for (const buyer of buyers) {
    const result = evaluateEligibility(buyer, window);
    if (result.eligible) {
      entrants.push({ wallet: buyer.wallet, entryCount: result.entryCount });
    }
  }
  return entrants;
}

const openEntrants = eligibleEntrants();

function oneEntryEach(wallets: readonly string[]): MerkleEntrant[] {
  return wallets.map((wallet) => ({ wallet, entryCount: 1 }));
}

export const MOCK_DRAWS: MockDraw[] = [
  {
    id: "7",
    status: "open",
    windowStart: MOCK_WINDOW.start.toISOString(),
    windowEnd: MOCK_WINDOW.end.toISOString(),
    entrants: openEntrants,
    potLamports: MOCK_POT_LAMPORTS,
    winnerWallet: null,
    winnerFomo: null,
    settleSig: null,
  },
  {
    id: "6",
    status: "settled",
    windowStart: "2026-09-30T06:00:00.000Z",
    windowEnd: "2026-09-30T12:00:00.000Z",
    entrants: oneEntryEach([
      "Wa11etAaa11111111111111111111111111111111",
      "Wa11etFff11111111111111111111111111111111",
      "Wa11etMmm11111111111111111111111111111111",
    ]),
    potLamports: 8_000_000_000n,
    winnerWallet: "Wa11etFff11111111111111111111111111111111",
    winnerFomo: "umber",
    settleSig: "5settledraw6s1gnature111111111111111111111111111111111111111111111111111111",
  },
  {
    id: "5",
    status: "settled",
    windowStart: "2026-09-30T00:00:00.000Z",
    windowEnd: "2026-09-30T06:00:00.000Z",
    entrants: oneEntryEach([
      "Wa11etAaa11111111111111111111111111111111",
      "Wa11etMmm11111111111111111111111111111111",
    ]),
    potLamports: 3_250_000_000n,
    winnerWallet: "Wa11etAaa11111111111111111111111111111111",
    winnerFomo: "nova",
    settleSig: "5settledraw5s1gnature111111111111111111111111111111111111111111111111111111",
  },
];

export function findDraw(drawId: string): MockDraw | undefined {
  return MOCK_DRAWS.find((draw) => draw.id === drawId);
}

export function findBuyer(query: string): EligibilityBuyer | undefined {
  const trimmed = query.trim().replace(/^@/, "");
  const lower = trimmed.toLowerCase();
  return MOCK_BUYERS.find((buyer) => buyer.wallet === trimmed || buyer.fomoHandle?.toLowerCase() === lower);
}

export function unknownBuyer(query: string): EligibilityBuyer {
  return {
    wallet: query.trim(),
    fomoHandle: null,
    thesis: null,
    swaps: [],
    balanceRaw: 0n,
    holdingValueUsdCents: 0,
    sharedFundingSource: false,
    duplicateThesis: false,
    duplicateFomoAccount: false,
  };
}

export interface RuleRow {
  label: string;
  pass: boolean;
  detail: string;
}

export const FAIL_COPY: Record<FailReason, string> = {
  unresolved_identity: "No fomo account resolved for this wallet.",
  duplicate_fomo_account: "This fomo account already has an entry in the window.",
  no_thesis: "No thesis on $DRAW posted by the snapshot.",
  not_holding: "No $DRAW balance at the snapshot.",
  below_min_hold: "Holdings are worth under $5 at the snapshot.",
};

function inWindowBuys(buyer: EligibilityBuyer, window: DrawWindow): number {
  let cents = 0;
  for (const swap of buyer.swaps) {
    const at = swap.blockTime.getTime();
    if (swap.side === "buy" && at >= window.start.getTime() && at <= window.end.getTime()) {
      cents += swap.usdValueCents;
    }
  }
  return cents;
}

export function ruleRows(buyer: EligibilityBuyer, window: DrawWindow = MOCK_WINDOW): RuleRow[] {
  const handle = buyer.fomoHandle?.trim() ?? "";
  const buyCents = inWindowBuys(buyer, window);
  const thesis = buyer.thesis;
  const postedAt = thesis?.postedAt.getTime();
  const thesisOk =
    thesis !== null &&
    thesis.text.trim().length > 0 &&
    postedAt !== undefined &&
    !Number.isNaN(postedAt) &&
    postedAt <= window.end.getTime();
  return [
    {
      label: "Fomo account",
      pass: handle.length > 0 && !buyer.duplicateFomoAccount,
      detail: handle.length === 0 ? "Unresolved" : buyer.duplicateFomoAccount ? `@${handle} already entered` : `@${handle}`,
    },
    {
      label: "Thesis on $DRAW",
      pass: thesisOk,
      detail: thesis !== null && thesisOk ? thesis.text : "Missing",
    },
    {
      label: "Holding at least $5",
      pass: buyer.balanceRaw > 0n && buyer.holdingValueUsdCents >= MIN_HOLD_USD_CENTS,
      detail: buyer.balanceRaw <= 0n ? "Zero balance" : formatCents(buyer.holdingValueUsdCents),
    },
    {
      label: "Window buy bonus",
      pass: buyCents >= MIN_WINDOW_BUY_USD_CENTS,
      detail: buyCents >= MIN_WINDOW_BUY_USD_CENTS ? `+${BONUS_ENTRIES} entries` : buyCents === 0 ? "No in-window buy" : formatCents(buyCents),
    },
  ];
}

export function checkQuery(query: string): { buyer: EligibilityBuyer; result: EligibilityResult; known: boolean } {
  const knownBuyer = findBuyer(query);
  const buyer = knownBuyer ?? unknownBuyer(query);
  return {
    buyer,
    result: evaluateEligibility(buyer, MOCK_WINDOW),
    known: knownBuyer !== undefined,
  };
}
