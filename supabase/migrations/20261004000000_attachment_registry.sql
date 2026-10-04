-- Stage 1 P2: authenticated attachment registry.
-- The client uploads the raw object to the private `attachments` storage
-- bucket (owner-only RLS, existing migration 20260904000000), then registers
-- it here. Server-side readers resolve an attachment ONLY through this
-- registry and only after verifying ownership, bucket, path prefix, MIME and
-- size — the client never supplies a readable path.

create table if not exists public.attachments_registry (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null default 'attachments',
  object_path text not null,
  mime text not null default '',
  size bigint not null default 0 check (size >= 0),
  name text not null default '',
  status text not null default 'uploaded',
  parent_attachment_id uuid references public.attachments_registry(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.attachments_registry enable row level security;

drop policy if exists "attachments_registry_owner_select" on public.attachments_registry;
create policy "attachments_registry_owner_select"
  on public.attachments_registry for select
  using (auth.uid() = user_id);

drop policy if exists "attachments_registry_owner_insert" on public.attachments_registry;
create policy "attachments_registry_owner_insert"
  on public.attachments_registry for insert
  with check (auth.uid() = user_id and id = id);

drop policy if exists "attachments_registry_owner_delete" on public.attachments_registry;
create policy "attachments_registry_owner_delete"
  on public.attachments_registry for delete
  using (auth.uid() = user_id);

create index if not exists attachments_registry_user_idx
  on public.attachments_registry (user_id, created_at desc);
