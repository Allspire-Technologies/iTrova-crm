-- CRM Referrals module. Tracks the referral program (docs in the iTrova repo): a registry of
-- referrers (affiliates / staff / businesses), the affiliate applications that arrive from the
-- website, and a computed view of who referred which business + what's owed. Rewards are applied
-- MANUALLY by admins (extend subscription_renews_at / pay transfers) — no billing here.
--
-- Depends on the iTrova migration 20260730100000 (applied first on this shared project): it adds
-- businesses.referred_by_code / referral_code and the referral_config table.

-- ---------------------------------------------------------------- referrer registry
create table if not exists public.cs_referrer (
  code          text primary key,                    -- stored upper-case; matches businesses.referred_by_code
  name          text not null,
  kind          text not null check (kind in ('affiliate', 'staff', 'business')),
  business_id   uuid references public.businesses(id) on delete set null, -- for kind 'business'
  phone         text not null,                        -- feeds the code's last-4 digits
  email         text,
  bank_name       text,                               -- payout bank details, broken out
  account_number  text,
  account_name    text,
  share_percent numeric,                              -- null = use referral_config.affiliate_share_percent
  active        boolean not null default true,
  notes         text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Idempotent: add the broken-out bank columns when re-applying over an already-created table.
alter table public.cs_referrer add column if not exists bank_name      text;
alter table public.cs_referrer add column if not exists account_number text;
alter table public.cs_referrer add column if not exists account_name   text;
drop trigger if exists set_updated_at on public.cs_referrer;
create trigger set_updated_at before update on public.cs_referrer
  for each row execute function public.cs_set_updated_at();

alter table public.cs_referrer enable row level security;
revoke all on public.cs_referrer from anon;
grant select, insert, update, delete on public.cs_referrer to authenticated;
drop policy if exists "referrer staff read" on public.cs_referrer;
create policy "referrer staff read" on public.cs_referrer for select to authenticated using (true);
drop policy if exists "referrer admin write" on public.cs_referrer;
create policy "referrer admin write" on public.cs_referrer for all to authenticated
  using (public.cs_my_role() = 'admin') with check (public.cs_my_role() = 'admin');

-- ---------------------------------------------------------------- affiliate applications (from the website)
create table if not exists public.cs_referrer_application (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  phone        text not null,
  email        text,
  how_promote  text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
drop trigger if exists set_updated_at on public.cs_referrer_application;
create trigger set_updated_at before update on public.cs_referrer_application
  for each row execute function public.cs_set_updated_at();

alter table public.cs_referrer_application enable row level security;
-- The public website form (anon key) may ONLY insert; it can never read or change applications.
grant insert on public.cs_referrer_application to anon;
grant select, insert, update on public.cs_referrer_application to authenticated;
drop policy if exists "application anon insert" on public.cs_referrer_application;
create policy "application anon insert" on public.cs_referrer_application for insert to anon with check (true);
drop policy if exists "application staff read" on public.cs_referrer_application;
create policy "application staff read" on public.cs_referrer_application for select to authenticated using (true);
drop policy if exists "application admin update" on public.cs_referrer_application;
create policy "application admin update" on public.cs_referrer_application for update to authenticated
  using (public.cs_my_role() = 'admin') with check (public.cs_my_role() = 'admin');

-- ---------------------------------------------------------------- referred-businesses view
-- One row per business that signed up with a referral code: the matched referrer (from the registry
-- OR another business's own code, i.e. business→business), first payment, 12-month payments, and the
-- effective affiliate share. Reward figures are computed client-side (src/lib/referralMath.ts) from
-- these fields so the math lives in one tested place.
create or replace function public.cs_referrals(p_search text default null)
returns table (
  business_id             uuid,
  business_name           text,
  signed_up_at            timestamptz,
  code                    text,
  referrer_name           text,
  referrer_kind           text,
  effective_share_percent numeric,
  plan_key                text,
  first_paid_at           date,
  total_paid_12m          numeric,
  converted               boolean,
  matched                 boolean
)
language plpgsql stable security definer set search_path = public as $$
declare v_default_share numeric;
begin
  select affiliate_share_percent into v_default_share from public.referral_config limit 1;
  return query
  with firsts as (
    select rp.business_id, min(rp.paid_at) as first_paid
    from public.cs_renewal_payment rp group by rp.business_id
  ),
  sums as (
    select f.business_id, f.first_paid,
           coalesce(sum(rp.amount), 0) as total_12m
    from firsts f
    join public.cs_renewal_payment rp
      on rp.business_id = f.business_id
     and rp.paid_at < (f.first_paid + interval '12 months')
    group by f.business_id, f.first_paid
  )
  select
    b.id,
    b.name,
    b.created_at,
    b.referred_by_code,
    coalesce(cr.name, rb.name),
    coalesce(cr.kind, case when rb.id is not null then 'business' end),
    coalesce(cr.share_percent, v_default_share),
    (to_jsonb(b) ->> 'subscription_tier'),
    s.first_paid,
    coalesce(s.total_12m, 0),
    (s.first_paid is not null),
    (cr.code is not null or rb.id is not null)
  from public.businesses b
  left join public.cs_referrer cr on upper(cr.code) = upper(b.referred_by_code)
  left join public.businesses rb on rb.id <> b.id and upper(rb.referral_code) = upper(b.referred_by_code)
  left join sums s on s.business_id = b.id
  where b.referred_by_code is not null
    and public.cs_can_see_business(b.id)
    and (
      p_search is null or p_search = ''
      or b.name              ilike '%' || p_search || '%'
      or b.referred_by_code  ilike '%' || p_search || '%'
      or coalesce(cr.name, rb.name) ilike '%' || p_search || '%'
    )
  order by b.created_at desc;
end $$;
revoke all on function public.cs_referrals(text) from public, anon;
grant execute on function public.cs_referrals(text) to authenticated;

-- ---------------------------------------------------------------- extend the profile RPC
-- Add the two referral codes. DROP first — adding return columns changes the return type (42P13).
drop function if exists public.admin_business_profile(uuid);
create or replace function public.admin_business_profile(p_business_id uuid)
returns table (industry text, owner_email text, referred_by_code text, referral_code text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select
    coalesce(
      to_jsonb(b) ->> 'industry',
      to_jsonb(b) ->> 'business_type',
      to_jsonb(b) ->> 'category',
      to_jsonb(b) ->> 'sector'
    ) as industry,
    (select au.email::text from auth.users au where au.id = b.owner_id) as owner_email,
    (to_jsonb(b) ->> 'referred_by_code') as referred_by_code,
    (to_jsonb(b) ->> 'referral_code') as referral_code
  from public.businesses b
  where b.id = p_business_id and public.cs_can_see_business(p_business_id);
end $$;
revoke all on function public.admin_business_profile(uuid) from public, anon;
grant execute on function public.admin_business_profile(uuid) to authenticated;

notify pgrst, 'reload schema';
