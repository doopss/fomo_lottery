-- $DRAW M1 schema.
-- SOL and pot amounts are lamports (bigint).
-- Token amounts are base units (bigint).
-- USD amounts are integer cents (bigint). 500 = $5.00.
-- No float columns.

create table draws (
  id bigint generated always as identity primary key,
  window_start timestamptz not null,
  window_end timestamptz not null,
  status text not null check (
    status in ('open', 'closed', 'committed', 'randomized', 'settled', 'rolled_over')
  ),
  entrant_count integer,
  merkle_root text,
  list_uri text,
  randomness_account text,
  winner_wallet text,
  winner_fomo text,
  pot_amount bigint,
  settle_sig text,
  check (window_end > window_start),
  check (entrant_count is null or entrant_count >= 0),
  check (pot_amount is null or pot_amount >= 0)
);

comment on column draws.pot_amount is 'lamports';

create table swaps (
  signature text primary key,
  wallet text not null,
  side text not null check (side in ('buy', 'sell')),
  token_amount bigint not null,
  sol_value bigint not null,
  usd_value bigint not null,
  slot bigint not null,
  block_time timestamptz not null,
  via_fomo boolean not null,
  check (token_amount >= 0),
  check (sol_value >= 0),
  check (usd_value >= 0),
  check (slot >= 0)
);

comment on column swaps.token_amount is 'token base units';
comment on column swaps.sol_value is 'lamports';
comment on column swaps.usd_value is 'integer US cents at swap time';

create index swaps_wallet_block_time_idx on swaps (wallet, block_time);

create table identities (
  wallet text primary key,
  fomo_handle text,
  resolved_at timestamptz not null,
  raw jsonb
);

comment on column identities.raw is 'provider response kept for audit';

create index identities_fomo_handle_idx on identities (fomo_handle);

create table theses (
  fomo_handle text not null,
  token_mint text not null,
  text text not null,
  posted_at timestamptz,
  source_url text,
  primary key (fomo_handle, token_mint)
);

create index theses_token_mint_idx on theses (token_mint);

create table entries (
  draw_id bigint not null references draws (id),
  wallet text not null,
  fomo_handle text,
  eligible boolean not null,
  fail_reason text,
  entry_count integer not null,
  leaf_index integer,
  primary key (draw_id, wallet),
  check (
    (eligible = true and fail_reason is null and entry_count >= 1)
    or (eligible = false and fail_reason is not null and entry_count = 0)
  ),
  check (
    fail_reason is null
    or fail_reason in (
      'unresolved_identity',
      'duplicate_fomo_account',
      'no_thesis',
      'not_holding',
      'below_min_hold'
    )
  ),
  check (leaf_index is null or leaf_index >= 0)
);

create index entries_draw_eligible_idx on entries (draw_id, eligible);

create table fee_claims (
  signature text primary key,
  amount bigint not null,
  pot_share bigint not null,
  buyback_share bigint not null,
  burned_amount bigint not null,
  claimed_at timestamptz not null,
  check (amount >= 0),
  check (pot_share >= 0),
  check (buyback_share >= 0),
  check (burned_amount >= 0),
  check (amount = pot_share + buyback_share)
);

comment on column fee_claims.amount is 'lamports';
comment on column fee_claims.pot_share is 'lamports';
comment on column fee_claims.buyback_share is 'lamports';
comment on column fee_claims.burned_amount is 'token base units';
