-- Admin OS staff gate. APPLIED TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
-- This is the only "internal user" concept; iTrova's owner/manager/cashier roles are untouched.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- A signed-in user may read only their own membership row.
drop policy if exists "own platform admin row" on public.platform_admins;
create policy "own platform admin row" on public.platform_admins
  for select to authenticated using (user_id = auth.uid());
-- No insert/update/delete policy: membership is managed by the service role (dashboard).

-- The gate's check. SECURITY DEFINER so it resolves regardless of RLS.
create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;
grant execute on function public.is_platform_admin() to authenticated;

-- Seed the first internal admin (replace the email, or insert the auth uid directly):
-- insert into public.platform_admins (user_id)
--   select id from auth.users where email = 'you@allspire.tech'
--   on conflict do nothing;
