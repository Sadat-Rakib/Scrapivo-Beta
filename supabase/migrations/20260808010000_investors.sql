-- Seeded investors / VC directory (read for authenticated users).
-- App primarily reads data/investors.json; this table supports sync/import.

create table if not exists public.investors (
  id text primary key,
  name text not null,
  firm text not null default '',
  title text not null default '',
  investor_type text not null default 'unknown',
  check_sweet_spot_usd bigint not null default 0,
  check_min_usd bigint not null default 0,
  check_max_usd bigint not null default 0,
  locations text[] not null default '{}',
  focus_areas jsonb not null default '[]'::jsonb,
  stages text[] not null default '{}',
  status text not null default 'active',
  verification jsonb not null default '{"state":"unverified","last_checked_at":null,"notes":""}'::jsonb,
  links jsonb not null default '{"linkedin":null,"firm":null,"profile":null}'::jsonb,
  source_batch text not null default 'user_seed_2026',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists investors_status_idx on public.investors (status);
create index if not exists investors_firm_idx on public.investors (firm);
create index if not exists investors_stages_gin on public.investors using gin (stages);

alter table public.investors enable row level security;

drop policy if exists "investors_select_authenticated" on public.investors;
create policy "investors_select_authenticated"
  on public.investors for select
  to authenticated
  using (true);
