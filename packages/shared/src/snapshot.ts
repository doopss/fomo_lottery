import { solanaWallet, thesisText, type FomoHolder, type HoldersPage } from "./holders.js";
import { usdToCents } from "./money.js";
import {
  evaluateEligibility,
  defaultEligibilityConfig,
  type DrawWindow,
  type EligibilityConfig,
  type EligibilityResult,
  type EligibilitySwap,
} from "./rules.js";

/** Holder lists older than this are not a close. Two minutes. */
export const MAX_SNAPSHOT_AGE_SECONDS = 120;

export interface SnapshotRow {
  wallet: string;
  fomoHandle: string;
  thesisText: string | null;
  holdingValueUsdCents: number;
  /** Null until Helius confirms the base-unit balance. */
  balanceRaw: bigint | null;
  balanceConfirmed: boolean;
  result: EligibilityResult;
}

export interface CloseSnapshot {
  observedAt: Date;
  source: string | null;
  stale: boolean;
  ageSeconds: number | null;
  totalHolders: number | null;
  trackedHolders: number;
  skippedWithoutSolanaWallet: number;
  rows: SnapshotRow[];
  publishable: boolean;
  publishBlockers: string[];
}

interface Candidate {
  wallet: string;
  handle: string;
  thesisText: string | null;
  valueUsd: number;
  amountPositive: boolean;
  sharedFundingSource: boolean;
}

/**
 * One fomo account, one wallet. The kept wallet is the larger confirmed
 * balance, then the larger fomo USD value, then the lexicographic wallet.
 * Same Solana wallet on two handles collapses to one row and sets
 * shared_funding_source. Identical thesis text is a flag, not a failure.
 *
 * Window buys add bonus entries. Sells do not. A missing swap map means
 * buys were not checked and no bonus is applied.
 * A non-empty thesis string is dated at the snapshot time, clamped to the
 * window end so a late read does not masquerade as "no thesis". Publishing
 * is blocked when that snapshot was not taken inside the window.
 */
export function closeHolderSnapshot(input: {
  page: HoldersPage;
  window: DrawWindow;
  observedAt: Date;
  confirmedBalances?: ReadonlyMap<string, bigint>;
  /** Wallet to in-window swaps. Omit when buys were not loaded. */
  windowSwaps?: ReadonlyMap<string, readonly EligibilitySwap[]>;
  config?: EligibilityConfig;
}): CloseSnapshot {
  const config = input.config ?? defaultEligibilityConfig;
  const skippedWithoutSolanaWallet = input.page.holders.filter((holder) => solanaWallet(holder) === null).length;
  const candidates = collapseWallets(input.page.holders);
  const duplicateHandles = duplicateHandleSet(candidates);
  const duplicateTheses = duplicateThesisSet(candidates);

  const thesisPostedAt = input.observedAt.getTime() > input.window.end.getTime() ? input.window.end : input.observedAt;

  const rows = candidates
    .map((candidate) => {
      const confirmed = input.confirmedBalances?.get(candidate.wallet);
      const balanceConfirmed = confirmed !== undefined;
      const balanceRaw = balanceConfirmed ? confirmed : candidate.amountPositive ? 1n : 0n;
      const holdingValueUsdCents = balanceConfirmed && confirmed === 0n ? 0 : usdToCents(candidate.valueUsd);
      const result = evaluateEligibility(
        {
          wallet: candidate.wallet,
          fomoHandle: candidate.handle,
          thesis:
            candidate.thesisText === null
              ? null
              : { text: candidate.thesisText, postedAt: thesisPostedAt },
          swaps: [...(input.windowSwaps?.get(candidate.wallet) ?? [])],
          balanceRaw,
          holdingValueUsdCents,
          sharedFundingSource: candidate.sharedFundingSource,
          duplicateThesis: duplicateTheses.has(normalizeThesis(candidate.thesisText ?? "")),
          duplicateFomoAccount:
            duplicateHandles.has(candidate.handle) && !isKeptWallet(candidate, candidates, input.confirmedBalances),
        },
        input.window,
        config,
      );
      return {
        wallet: candidate.wallet,
        fomoHandle: candidate.handle,
        thesisText: candidate.thesisText,
        holdingValueUsdCents,
        balanceRaw: balanceConfirmed ? confirmed : null,
        balanceConfirmed,
        result,
      } satisfies SnapshotRow;
    })
    .sort((a, b) => a.wallet.localeCompare(b.wallet));

  const publishBlockers = freshnessBlockers(input.page, input.window, input.observedAt);
  if (input.confirmedBalances === undefined) {
    publishBlockers.push("token balances were not confirmed");
  } else if (rows.some((row) => !row.balanceConfirmed)) {
    publishBlockers.push("one or more token balances were not confirmed");
  }

  return {
    observedAt: input.observedAt,
    source: input.page.source ?? null,
    stale: listIsStale(input.page),
    ageSeconds: input.page.ageSeconds ?? null,
    totalHolders: input.page.totalHolders ?? null,
    trackedHolders: input.page.holders.length,
    skippedWithoutSolanaWallet,
    rows,
    publishable: publishBlockers.length === 0,
    publishBlockers,
  };
}

function collapseWallets(holders: FomoHolder[]): Candidate[] {
  const byWallet = new Map<string, Candidate>();
  for (const holder of holders) {
    const wallet = solanaWallet(holder);
    if (wallet === null) {
      continue;
    }
    const next: Candidate = {
      wallet,
      handle: holder.handle.trim(),
      thesisText: thesisText(holder),
      valueUsd: holder.valueUsd,
      amountPositive: holder.amount > 0,
      sharedFundingSource: false,
    };
    const existing = byWallet.get(wallet);
    if (existing === undefined) {
      byWallet.set(wallet, next);
      continue;
    }
    existing.sharedFundingSource = true;
    next.sharedFundingSource = true;
    const keepNext = next.valueUsd > existing.valueUsd || (next.valueUsd === existing.valueUsd && next.handle < existing.handle);
    if (keepNext) {
      next.thesisText = next.thesisText ?? existing.thesisText;
      byWallet.set(wallet, next);
    } else {
      existing.thesisText = existing.thesisText ?? next.thesisText;
    }
  }
  return [...byWallet.values()];
}

function duplicateHandleSet(candidates: Candidate[]): Set<string> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.handle, (counts.get(candidate.handle) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [handle, count] of counts) {
    if (count > 1) {
      duplicates.add(handle);
    }
  }
  return duplicates;
}

function isKeptWallet(
  candidate: Candidate,
  candidates: Candidate[],
  confirmedBalances: ReadonlyMap<string, bigint> | undefined,
): boolean {
  const sameHandle = candidates.filter((row) => row.handle === candidate.handle);
  const ranked = [...sameHandle].sort((a, b) => {
    const balanceA = confirmedBalances?.get(a.wallet) ?? 0n;
    const balanceB = confirmedBalances?.get(b.wallet) ?? 0n;
    if (balanceA !== balanceB) {
      return balanceA > balanceB ? -1 : 1;
    }
    if (a.valueUsd !== b.valueUsd) {
      return b.valueUsd - a.valueUsd;
    }
    return a.wallet.localeCompare(b.wallet);
  });
  return ranked[0]?.wallet === candidate.wallet;
}

function duplicateThesisSet(candidates: Candidate[]): Set<string> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = normalizeThesis(candidate.thesisText ?? "");
    if (key.length === 0) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [text, count] of counts) {
    if (count > 1) {
      duplicates.add(text);
    }
  }
  return duplicates;
}

function normalizeThesis(text: string): string {
  return text.trim().toLowerCase();
}

function listIsStale(page: HoldersPage): boolean {
  return page.stale === true || (page.source?.includes("stale") ?? false);
}

function freshnessBlockers(page: HoldersPage, window: DrawWindow, observedAt: Date): string[] {
  const blockers: string[] = [];
  const stale = listIsStale(page);
  if (stale) {
    blockers.push("holder list is stale");
  }
  // A live-fomo payload omits both stale and ageSeconds. That list is current.
  if (page.ageSeconds === undefined) {
    if (stale || page.source !== "live-fomo") {
      blockers.push("holder list age is unknown");
    }
  } else if (page.ageSeconds > MAX_SNAPSHOT_AGE_SECONDS) {
    blockers.push(`holder list is older than ${MAX_SNAPSHOT_AGE_SECONDS} seconds`);
  }
  if (observedAt.getTime() < window.start.getTime() || observedAt.getTime() > window.end.getTime()) {
    blockers.push("holder list was captured outside the window");
  }
  return blockers;
}
