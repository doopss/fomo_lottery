import { z } from "zod";

import type { IdentityProvider, ResolvedIdentity, Thesis } from "./types.js";

/**
 * Adapter for the unofficial fomoapi.io HTTP API.
 *
 * Confirmed routes (https://fomoapi.io/docs, reviewed with the spec):
 * - GET /v2/users/{handle}
 * - GET /v2/thesis/user/{id}
 * - GET /v2/thesis/user/{id}/token/{mint}  (documented filter on the user route)
 * - GET /v2/thesis/token/{mint}
 *
 * Wallet → handle is NOT confirmed. Search matches handle and display name only.
 * lookupHandleByWallet fails closed and does not call the network.
 */

const traderSchema = z
  .object({
    handle: z.string().min(1),
    userId: z.string().min(1).optional(),
    displayName: z.string().optional(),
    wallets: z
      .object({
        solana: z.string().nullable().optional(),
        evm: z.string().nullable().optional(),
      })
      .optional(),
  })
  .passthrough();

const thesisRowSchema = z
  .object({
    text: z.string(),
    handle: z.string().optional(),
    userId: z.string().optional(),
    id: z.string().nullable().optional(),
    tradeId: z.string().nullable().optional(),
    ts: z.string().optional(),
    likes: z.number().optional(),
  })
  .passthrough();

const thesisListSchema = z
  .object({
    theses: z.array(thesisRowSchema).optional(),
    available: z.boolean().optional(),
    source: z.string().optional(),
    threshold: z.number().optional(),
    capturedAt: z.string().optional(),
    totalAvailable: z.number().optional(),
  })
  .passthrough();

export type Trader = z.infer<typeof traderSchema>;
export type ThesisList = z.infer<typeof thesisListSchema>;

export interface FomoApiConfig {
  baseUrl: string;
  apiKey: string;
  tokenMint: string;
  /** Reserved. Ignored until a wallet→handle path and schema are confirmed. */
  walletLookupPath: string;
}

export function fomoApiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): FomoApiConfig {
  const baseUrl = env.FOMO_API_BASE_URL?.trim() ?? "";
  const apiKey = env.FOMO_API_KEY?.trim() ?? "";
  const tokenMint = env.DRAW_MINT?.trim() ?? "";
  if (baseUrl.length === 0 || apiKey.length === 0 || tokenMint.length === 0) {
    throw new Error("FOMO_API_BASE_URL, FOMO_API_KEY, and DRAW_MINT are required");
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    tokenMint,
    walletLookupPath: env.FOMO_WALLET_LOOKUP_PATH?.trim() ?? "",
  };
}

export function parseTrader(data: unknown): Trader {
  return traderSchema.parse(data);
}

export function parseThesisList(data: unknown): ThesisList {
  return thesisListSchema.parse(data);
}

/**
 * Picks the newest non-empty thesis. `sourceUrl` is the API request URL.
 *
 * TODO: fomoapi thesis rows do not document a public permalink. Callers keep
 * the API URL until a public thesis URL shape is confirmed.
 */
export function selectThesis(list: ThesisList, sourceUrl: string): Thesis | null {
  const rows = (list.theses ?? []).filter((row) => row.text.trim().length > 0);
  if (rows.length === 0) {
    return null;
  }
  const sorted = [...rows].sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));
  const row = sorted[0];
  if (row === undefined) {
    return null;
  }
  return {
    text: row.text,
    postedAt: row.ts ?? "",
    url: sourceUrl,
  };
}

export class FomoApiIdentityProvider implements IdentityProvider {
  constructor(
    private readonly config: FomoApiConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async resolveWallet(wallet: string): Promise<ResolvedIdentity> {
    const handle = await this.lookupHandleByWallet(wallet);
    if (handle === null) {
      return {
        fomoHandle: null,
        thesis: null,
        raw: {
          wallet,
          error: "unresolved",
          reason: "wallet_lookup_unconfigured",
          detail:
            "fomoapi.io docs confirm handle→wallet and thesis reads, not wallet→handle. Lookup fails closed and does not guess an endpoint.",
          walletLookupPathIgnored: this.config.walletLookupPath.length > 0 ? this.config.walletLookupPath : null,
        },
      };
    }

    const trader = await this.getTrader(handle);
    const id = trader.userId ?? trader.handle;
    const thesisResult = await this.getThesesForUser(id, this.config.tokenMint);
    return {
      fomoHandle: trader.handle,
      thesis: thesisResult.thesis,
      raw: {
        trader,
        thesis: thesisResult.raw,
      },
    };
  }

  async getTrader(handle: string): Promise<Trader> {
    const url = `${this.config.baseUrl}/v2/users/${encodeURIComponent(handle)}`;
    return parseTrader(await this.getJson(url));
  }

  async getThesesForUser(id: string, tokenMint?: string): Promise<{ thesis: Thesis | null; raw: unknown }> {
    const tokenSuffix =
      tokenMint !== undefined && tokenMint.length > 0 ? `/token/${encodeURIComponent(tokenMint)}` : "";
    const url = `${this.config.baseUrl}/v2/thesis/user/${encodeURIComponent(id)}${tokenSuffix}`;
    const raw = await this.getJson(url);
    return { thesis: selectThesis(parseThesisList(raw), url), raw };
  }

  async getThesesForToken(mint: string): Promise<{ thesis: Thesis | null; raw: unknown }> {
    const url = `${this.config.baseUrl}/v2/thesis/token/${encodeURIComponent(mint)}`;
    const raw = await this.getJson(url);
    return { thesis: selectThesis(parseThesisList(raw), url), raw };
  }

  /**
   * TODO(fomo-wallet-lookup): No confirmed wallet→handle route.
   * FOMO_WALLET_LOOKUP_PATH is intentionally unused. Do not invent a path or schema.
   * Fail closed by returning null. resolveWallet then records reason wallet_lookup_unconfigured.
   */
  private async lookupHandleByWallet(wallet: string): Promise<string | null> {
    void wallet;
    void this.config.walletLookupPath;
    return null;
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
    });
    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        throw new Error(`fomoapi: non-JSON response ${response.status} from ${url}`);
      }
    }
    if (!response.ok) {
      throw new Error(`fomoapi: ${response.status} from ${url}`);
    }
    return body;
  }
}
