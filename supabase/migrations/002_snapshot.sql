-- Columns a window close needs when the holder snapshot is published.
-- balance_raw is token base units. holding_value_usd_cents is integer US cents.

alter table draws
  add column snapshot_source text,
  add column snapshot_age_seconds integer,
  add column snapshot_stale boolean,
  add column snapshot_observed_at timestamptz;

alter table draws
  add constraint draws_snapshot_age_nonnegative
  check (snapshot_age_seconds is null or snapshot_age_seconds >= 0);

alter table entries
  add column holding_value_usd_cents bigint,
  add column balance_raw bigint,
  add column balance_confirmed boolean not null default false,
  add column flags text[] not null default '{}';

alter table entries
  add constraint entries_holding_value_nonnegative
  check (holding_value_usd_cents is null or holding_value_usd_cents >= 0);

alter table entries
  add constraint entries_balance_raw_nonnegative
  check (balance_raw is null or balance_raw >= 0);

comment on column entries.holding_value_usd_cents is 'integer US cents at the snapshot';
comment on column entries.balance_raw is 'token base units confirmed by RPC, null when unconfirmed';
