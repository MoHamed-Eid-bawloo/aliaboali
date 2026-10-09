create table public.shop_data (owner_id uuid primary key references auth.users(id) on delete cascade, data jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
alter table public.shop_data enable row level security;

-- Users signed in through Supabase Auth need table privileges in addition to RLS policies.
grant usage on schema public to authenticated;
grant select, insert, update on table public.shop_data to authenticated;

create policy "read own data" on public.shop_data for select to authenticated using (auth.uid() = owner_id);
create policy "insert own data" on public.shop_data for insert to authenticated with check (auth.uid() = owner_id);
create policy "update own data" on public.shop_data for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
