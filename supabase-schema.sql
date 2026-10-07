create table public.shop_data (owner_id uuid primary key references auth.users(id) on delete cascade, data jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
alter table public.shop_data enable row level security;
create policy "read own data" on public.shop_data for select using (auth.uid()=owner_id);
create policy "write own data" on public.shop_data for all using (auth.uid()=owner_id) with check (auth.uid()=owner_id);
