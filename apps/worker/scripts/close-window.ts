import {
  closeHolderSnapshot,
  fomoApiConfigFromEnv,
  lamportsToUsdCents,
  parseBinanceSolPrice,
  parseCoinbaseSolPrice,
  parseHoldersPage,
  parseTokenBalance,
  readSwapPage,
  swapsByWallet,
  type CloseSnapshot,
  type DrawWindow,
  type HoldersPage,
  type ParsedWindowSwap,
} from "@draw/shared";

import { saveClosedSnapshot, type StoredSwap } from "../src/persist-snapshot.js";
import { readWindowHours, windowAt } from "../src/scheduler.js";

const HOLDER_LIMIT = 500;
const SWAP_PAGE_LIMIT = 100;
const MAX_SWAP_PAGES = 40;

export function formatCents(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `$${dollars}.${remainder.toString().padStart(2, "0")}`;
}

export function snapshotObservedAt(page: HoldersPage, now: Date): Date {
  if (page.ageSeconds === undefined) {
    return now;
  }
  return new Date(now.getTime() - page.ageSeconds * 1000);
}

export async function fetchHolders(config: {
  baseUrl: string;
  apiKey: string;
  tokenMint: string;
  fetchImpl?: typeof fetch;
}): Promise<HoldersPage> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const url = `${config.baseUrl}/token/${encodeURIComponent(config.tokenMint)}/holders?limit=${HOLDER_LIMIT}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
  });
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`fomoapi holders: non-JSON response ${response.status}`);
    }
  }
  if (!response.ok) {
    throw new Error(`fomoapi holders: ${response.status}`);
  }
  const page = parseHoldersPage(body);
  if (page.holders.length >= HOLDER_LIMIT || page.count > page.holders.length) {
    throw new Error(
      `fomoapi holders page is truncated (${page.holders.length} returned, count ${page.count}). Refusing to close on a partial list.`,
    );
  }
  return page;
}

async function postRpcBatch(rpcUrl: string, body: unknown[], fetchImpl: typeof fetch): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }
    if (!response.ok) {
      throw new Error(`helius rpc: ${response.status}`);
    }
    return response.json() as Promise<unknown>;
  }
  throw new Error("helius rpc: 429");
}

export async function confirmBalances(input: {
  rpcUrl: string;
  mint: string;
  wallets: string[];
  fetchImpl?: typeof fetch;
}): Promise<Map<string, bigint>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const balances = new Map<string, bigint>();
  const chunkSize = 10;
  for (let index = 0; index < input.wallets.length; index += chunkSize) {
    const chunk = input.wallets.slice(index, index + chunkSize);
    const body = chunk.map((wallet, offset) => ({
      jsonrpc: "2.0",
      id: index + offset,
      method: "getTokenAccountsByOwner",
      params: [wallet, { mint: input.mint }, { encoding: "jsonParsed" }],
    }));
    const payload = await postRpcBatch(input.rpcUrl, body, fetchImpl);
    if (!Array.isArray(payload)) {
      throw new Error("helius rpc: expected a batch response");
    }
    const byId = new Map<number, unknown>();
    for (const item of payload) {
      if (typeof item === "object" && item !== null && "id" in item && typeof item.id === "number") {
        byId.set(item.id, item);
      }
    }
    for (let offset = 0; offset < chunk.length; offset += 1) {
      const wallet = chunk[offset];
      const item = byId.get(index + offset);
      if (wallet === undefined || item === undefined) {
        throw new Error("helius rpc: missing balance for a wallet");
      }
      balances.set(wallet, parseTokenBalance(item));
    }
    if (index + chunkSize < input.wallets.length) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return balances;
}

function renderSnapshot(snapshot: CloseSnapshot, blockers: string[]): string {
  const counts = new Map<string, number>();
  for (const row of snapshot.rows) {
    const key = row.result.eligible ? `eligible ${row.result.entryCount}` : (row.result.failReason ?? "unknown");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const lines = [
    blockers.length === 0 ? "Ready to publish" : "Unpublished snapshot",
    `observed ${snapshot.observedAt.toISOString()}`,
    `source ${snapshot.source ?? "unknown"} stale ${snapshot.stale} ageSeconds ${snapshot.ageSeconds ?? "unknown"}`,
    `tracked ${snapshot.trackedHolders} totalHolders ${snapshot.totalHolders ?? "unknown"} skipped without solana wallet ${snapshot.skippedWithoutSolanaWallet}`,
    blockers.length === 0 ? "publish blockers: none" : `not published: ${blockers.join("; ")}`,
    counts.size === 0
      ? "no solana wallets on the tracked list"
      : [...counts.entries()].map(([key, count]) => `${key} ${count}`).join(", "),
    "handle\twallet\thold\tbalance\tentries\treason\tflags",
  ];
  for (const row of snapshot.rows) {
    const balance = row.balanceConfirmed ? String(row.balanceRaw ?? 0n) : "unconfirmed";
    lines.push(
      [
        row.fomoHandle,
        row.wallet,
        formatCents(row.holdingValueUsdCents),
        balance,
        row.result.eligible ? String(row.result.entryCount) : "0",
        row.result.failReason ?? "",
        row.result.flags.join(","),
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

async function fetchWindowSwaps(input: {
  apiKey: string;
  mint: string;
  window: DrawWindow;
  fetchImpl?: typeof fetch;
}): Promise<{ swaps: ParsedWindowSwap[]; complete: boolean }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const swaps: ParsedWindowSwap[] = [];
  let before: string | undefined;
  let rateLimitRetries = 0;
  for (let page = 0; page < MAX_SWAP_PAGES; page += 1) {
    const url = new URL(`https://api.helius.xyz/v0/addresses/${input.mint}/transactions`);
    url.searchParams.set("api-key", input.apiKey);
    url.searchParams.set("type", "SWAP");
    url.searchParams.set("limit", String(SWAP_PAGE_LIMIT));
    if (before !== undefined) {
      url.searchParams.set("before", before);
    }
    const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" } });
    if (response.status === 429) {
      rateLimitRetries += 1;
      if (rateLimitRetries > 4) {
        throw new Error("helius swaps: 429");
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * rateLimitRetries));
      page -= 1;
      continue;
    }
    rateLimitRetries = 0;
    if (!response.ok) {
      throw new Error(`helius swaps: ${response.status}`);
    }
    const parsed = readSwapPage(await response.json(), input.mint, input.window);
    swaps.push(...parsed.swaps);
    const done =
      parsed.count === 0 ||
      parsed.reachedBeforeWindow ||
      parsed.count < SWAP_PAGE_LIMIT ||
      parsed.lastSignature === null;
    if (done) {
      return { swaps: uniqueSwaps(swaps), complete: true };
    }
    before = parsed.lastSignature ?? undefined;
    if (page + 1 === MAX_SWAP_PAGES) {
      return { swaps: uniqueSwaps(swaps), complete: false };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { swaps: uniqueSwaps(swaps), complete: false };
}

function uniqueSwaps(swaps: ParsedWindowSwap[]): ParsedWindowSwap[] {
  const bySignature = new Map<string, ParsedWindowSwap>();
  for (const swap of swaps) {
    bySignature.set(swap.signature, swap);
  }
  return [...bySignature.values()];
}

async function fetchSolUsdCents(fetchImpl: typeof fetch = fetch): Promise<number> {
  const coinbase = await fetchImpl("https://api.coinbase.com/v2/prices/SOL-USD/spot", {
    headers: { accept: "application/json" },
  });
  if (coinbase.ok) {
    return parseCoinbaseSolPrice(await coinbase.json());
  }
  const binance = await fetchImpl("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT", {
    headers: { accept: "application/json" },
  });
  if (!binance.ok) {
    throw new Error(`sol price: coinbase ${coinbase.status}, binance ${binance.status}`);
  }
  return parseBinanceSolPrice(await binance.json());
}

function storedSwaps(swaps: readonly ParsedWindowSwap[], solUsdCents: number): StoredSwap[] {
  return swaps.map((swap) => ({
    signature: swap.signature,
    wallet: swap.wallet,
    side: swap.side,
    tokenAmount: swap.tokenAmount,
    solLamports: swap.solLamports,
    usdValueCents: lamportsToUsdCents(swap.solLamports, solUsdCents),
    slot: swap.slot,
    blockTime: swap.blockTime,
  }));
}

async function main(): Promise<void> {
  const config = fomoApiConfigFromEnv();
  const now = new Date();
  const window = windowAt(now, readWindowHours(process.env.DRAW_WINDOW_HOURS));
  const page = await fetchHolders(config);
  const observedAt = snapshotObservedAt(page, now);
  const rpcUrl = process.env.HELIUS_RPC_URL?.trim() ?? "";
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const wallets = [
    ...new Set(
      page.holders.map((holder) => holder.wallet?.solana?.trim() ?? "").filter((wallet) => wallet.length > 0),
    ),
  ];
  const confirmedBalances =
    rpcUrl.length > 0 ? await confirmBalances({ rpcUrl, mint: config.tokenMint, wallets }) : undefined;
  const heliusApiKey = process.env.HELIUS_API_KEY?.trim() ?? "";
  const blockers: string[] = [];
  let pricedSwaps: StoredSwap[] = [];
  let windowSwaps: ReturnType<typeof swapsByWallet> | undefined;
  if (heliusApiKey.length === 0) {
    blockers.push("HELIUS_API_KEY is not set");
  } else {
    const fetched = await fetchWindowSwaps({ apiKey: heliusApiKey, mint: config.tokenMint, window });
    if (!fetched.complete) {
      blockers.push("window swap history is incomplete");
    }
    if (fetched.swaps.length === 0) {
      windowSwaps = new Map();
    } else {
      try {
        const solUsdCents = await fetchSolUsdCents();
        pricedSwaps = storedSwaps(fetched.swaps, solUsdCents);
        windowSwaps = swapsByWallet(fetched.swaps, solUsdCents);
        const dollars = Math.floor(solUsdCents / 100);
        const remainder = solUsdCents % 100;
        console.log(
          `sol spot $${dollars}.${remainder.toString().padStart(2, "0")} across ${fetched.swaps.length} swaps`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "sol price failed";
        blockers.push(message);
      }
    }
  }
  const snapshot = closeHolderSnapshot({ page, window, observedAt, confirmedBalances, windowSwaps });
  blockers.push(...snapshot.publishBlockers);
  if (databaseUrl.length === 0) {
    blockers.push("DATABASE_URL is not set");
  }
  const bonusWallets = snapshot.rows.filter((row) => row.result.bonusApplied).length;
  console.log(`window ${window.start.toISOString()} -> ${window.end.toISOString()}`);
  console.log(renderSnapshot(snapshot, blockers));
  console.log(`bonus entries: ${bonusWallets}`);
  if (blockers.length > 0 || databaseUrl.length === 0) {
    console.log("no rows written");
    return;
  }
  const sourceUrl = `${config.baseUrl}/token/${encodeURIComponent(config.tokenMint)}/holders?limit=${HOLDER_LIMIT}`;
  const saved = await saveClosedSnapshot({
    databaseUrl,
    tokenMint: config.tokenMint,
    window,
    snapshot,
    sourceUrl,
    swaps: pricedSwaps,
  });
  const verb = saved.replaced ? "updated" : "wrote";
  console.log(
    `${verb} draw ${saved.drawId} (${saved.status}): ${saved.entries} rows, ${saved.entrantCount} entries, ${saved.swapCount} swaps`,
  );
}

const isDirectRun = process.argv[1]?.includes("close-window") === true;
if (isDirectRun) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(message);
    process.exitCode = 1;
  });
}
