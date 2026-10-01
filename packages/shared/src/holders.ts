import { z } from "zod";

/**
 * GET /token/{mint}/holders
 *
 * Tracked fomo traders who hold the mint, ranked by USD value. This is not the
 * full on-chain holder set. `totalHolders` is fomo's broader count.
 * `thesis` is the holder's text when fomo sent one, otherwise null. The route
 * does not include a thesis timestamp.
 */

const holderSchema = z
  .object({
    handle: z.string().min(1),
    wallet: z
      .object({
        solana: z.string().nullable().optional(),
        evm: z.string().nullable().optional(),
      })
      .optional(),
    amount: z.number().finite().nonnegative(),
    valueUsd: z.number().finite().nonnegative(),
    priceUsd: z.number().finite().nonnegative().optional(),
    thesis: z.string().nullable().optional(),
  })
  .passthrough();

const holdersPageSchema = z
  .object({
    source: z.string().optional(),
    count: z.number().int().nonnegative(),
    totalHolders: z.number().int().nonnegative().optional(),
    holders: z.array(holderSchema),
    stale: z.boolean().optional(),
    ageSeconds: z.number().finite().nonnegative().optional(),
  })
  .passthrough();

export type FomoHolder = z.infer<typeof holderSchema>;
export type HoldersPage = z.infer<typeof holdersPageSchema>;

export function parseHoldersPage(data: unknown): HoldersPage {
  return holdersPageSchema.parse(data);
}

export function solanaWallet(holder: FomoHolder): string | null {
  const wallet = holder.wallet?.solana?.trim() ?? "";
  return wallet.length > 0 ? wallet : null;
}

export function thesisText(holder: FomoHolder): string | null {
  const text = holder.thesis?.trim() ?? "";
  return text.length > 0 ? text : null;
}
