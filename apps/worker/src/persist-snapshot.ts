import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { CloseSnapshot } from "@draw/shared";
import { Client } from "pg";

import type { DrawWindowSpan } from "./scheduler.js";

const LOCKED_STATUSES = new Set(["committed", "randomized", "settled", "rolled_over"]);

export interface StoredSwap {
  signature: string;
  wallet: string;
  side: "buy" | "sell";
  tokenAmount: bigint;
  solLamports: bigint;
  usdValueCents: number;
  slot: number;
  blockTime: Date;
}

export interface SavedSnapshot {
  drawId: string;
  status: "open" | "closed";
  entries: number;
  entrantCount: number;
  swapCount: number;
  replaced: boolean;
}

export async function saveClosedSnapshot(input: {
  databaseUrl: string;
  tokenMint: string;
  window: DrawWindowSpan;
  snapshot: CloseSnapshot;
  sourceUrl: string;
  swaps: readonly StoredSwap[];
}): Promise<SavedSnapshot> {
  const client = new Client({
    connectionString: connectionStringFor(input.databaseUrl),
    ssl: needsSsl(input.databaseUrl) ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    await client.query("begin");
    await ensureSchema(client);
    const saved = await writeSnapshot(client, input);
    await client.query("commit");
    return saved;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

function needsSsl(databaseUrl: string): boolean {
  return databaseUrl.includes("supabase.co") || databaseUrl.includes("sslmode=require");
}

function connectionStringFor(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete("sslmode");
  return url.toString();
}

function migrationsDir(): string {
  const candidates = [
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../supabase/migrations"),
    resolve(process.cwd(), "../../supabase/migrations"),
    resolve(process.cwd(), "supabase/migrations"),
  ];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, "001_init.sql"))) {
      return dir;
    }
  }
  throw new Error("could not find supabase/migrations/001_init.sql");
}

async function ensureSchema(client: Client): Promise<void> {
  const found = await client.query<{ draws: boolean; snapshot_column: boolean }>(
    `select
       exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'draws'
       ) as draws,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'entries' and column_name = 'balance_confirmed'
       ) as snapshot_column`,
  );
  const state = found.rows[0];
  if (state === undefined) {
    throw new Error("schema check returned no row");
  }
  const dir = migrationsDir();
  if (!state.draws) {
    await client.query(readFileSync(resolve(dir, "001_init.sql"), "utf8"));
  }
  if (!state.draws || !state.snapshot_column) {
    await client.query(readFileSync(resolve(dir, "002_snapshot.sql"), "utf8"));
  }
}

async function writeSnapshot(
  client: Client,
  input: {
    tokenMint: string;
    window: DrawWindowSpan;
    snapshot: CloseSnapshot;
    sourceUrl: string;
    swaps: readonly StoredSwap[];
  },
): Promise<SavedSnapshot> {
  const existing = await client.query<{ id: string; status: string }>(
    `select id::text as id, status
     from draws
     where window_start = $1 and window_end = $2
     order by id desc
     limit 1
     for update`,
    [input.window.start.toISOString(), input.window.end.toISOString()],
  );
  const current = existing.rows[0];
  if (current !== undefined && LOCKED_STATUSES.has(current.status)) {
    throw new Error(`draw ${current.id} is ${current.status} and cannot be replaced`);
  }

  const entrantCount = input.snapshot.rows.reduce((sum, entry) => sum + entry.result.entryCount, 0);
  const status: "open" | "closed" =
    input.snapshot.observedAt.getTime() >= input.window.end.getTime() ? "closed" : "open";
  const snapshotValues = [
    input.snapshot.source,
    input.snapshot.ageSeconds ?? null,
    input.snapshot.stale,
    input.snapshot.observedAt.toISOString(),
  ];

  let drawId: string;
  let replaced = false;
  if (current === undefined) {
    const inserted = await client.query<{ id: string }>(
      `insert into draws (
         window_start, window_end, status, entrant_count,
         snapshot_source, snapshot_age_seconds, snapshot_stale, snapshot_observed_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id::text as id`,
      [
        input.window.start.toISOString(),
        input.window.end.toISOString(),
        status,
        entrantCount,
        ...snapshotValues,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (id === undefined) {
      throw new Error("insert draw did not return an id");
    }
    drawId = id;
  } else {
    replaced = true;
    drawId = current.id;
    await client.query(
      `update draws set
         status = $2,
         entrant_count = $3,
         snapshot_source = $4,
         snapshot_age_seconds = $5,
         snapshot_stale = $6,
         snapshot_observed_at = $7
       where id = $1`,
      [drawId, status, entrantCount, ...snapshotValues],
    );
    await client.query("delete from entries where draw_id = $1", [drawId]);
  }

  const postedAt = thesisPostedAt(input.snapshot.observedAt, input.window.end);
  for (const entry of input.snapshot.rows) {
    await client.query(
      `insert into entries (
         draw_id, wallet, fomo_handle, eligible, fail_reason, entry_count,
         holding_value_usd_cents, balance_raw, balance_confirmed, flags
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        drawId,
        entry.wallet,
        entry.fomoHandle,
        entry.result.eligible,
        entry.result.failReason,
        entry.result.entryCount,
        entry.holdingValueUsdCents,
        entry.balanceRaw === null ? null : entry.balanceRaw.toString(),
        entry.balanceConfirmed,
        entry.result.flags,
      ],
    );
    await client.query(
      `insert into identities (wallet, fomo_handle, resolved_at, raw)
       values ($1, $2, $3, $4::jsonb)
       on conflict (wallet) do update set
         fomo_handle = excluded.fomo_handle,
         resolved_at = excluded.resolved_at,
         raw = excluded.raw`,
      [
        entry.wallet,
        entry.fomoHandle,
        input.snapshot.observedAt.toISOString(),
        JSON.stringify({
          source: input.snapshot.source,
          observedAt: input.snapshot.observedAt.toISOString(),
          holdingValueUsdCents: entry.holdingValueUsdCents,
          balanceRaw: entry.balanceRaw === null ? null : entry.balanceRaw.toString(),
        }),
      ],
    );
    if (entry.thesisText !== null) {
      await client.query(
        `insert into theses (fomo_handle, token_mint, text, posted_at, source_url)
         values ($1, $2, $3, $4, $5)
         on conflict (fomo_handle, token_mint) do update set
           text = excluded.text,
           posted_at = excluded.posted_at,
           source_url = excluded.source_url`,
        [entry.fomoHandle, input.tokenMint, entry.thesisText, postedAt.toISOString(), input.sourceUrl],
      );
    }
  }

  for (const swap of input.swaps) {
    await client.query(
      `insert into swaps (
         signature, wallet, side, token_amount, sol_value, usd_value, slot, block_time, via_fomo
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, false)
       on conflict (signature) do update set
         wallet = excluded.wallet,
         side = excluded.side,
         token_amount = excluded.token_amount,
         sol_value = excluded.sol_value,
         usd_value = excluded.usd_value,
         slot = excluded.slot,
         block_time = excluded.block_time,
         via_fomo = excluded.via_fomo`,
      [
        swap.signature,
        swap.wallet,
        swap.side,
        swap.tokenAmount.toString(),
        swap.solLamports.toString(),
        swap.usdValueCents,
        swap.slot,
        swap.blockTime.toISOString(),
      ],
    );
  }

  return {
    drawId,
    status,
    entries: input.snapshot.rows.length,
    entrantCount,
    swapCount: input.swaps.length,
    replaced,
  };
}

function thesisPostedAt(observedAt: Date, windowEnd: Date): Date {
  return observedAt.getTime() > windowEnd.getTime() ? windowEnd : observedAt;
}
