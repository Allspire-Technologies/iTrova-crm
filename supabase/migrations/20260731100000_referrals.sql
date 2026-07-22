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

-- ---------------------------------------------------------------- payout ledger
-- Money paid out to a referrer, or credited to a business referrer's subscription. Accrued balance
-- for a referrer = (rewards earned across their converted referrals) − (payouts recorded here).
-- Keyed by code (affiliate/staff) OR business_id (a business that referred others).
create table if not exists public.cs_referral_payout (
  id          uuid primary key default gen_random_uuid(),
  code        text,                                   -- affiliate/staff referrer code
  business_id uuid references public.businesses(id) on delete cascade, -- business referrer
  amount      numeric not null check (amount > 0),
  kind        text not null check (kind in ('cash', 'subscription')),
  note        text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists cs_referral_payout_code_idx on public.cs_referral_payout(upper(code));
create index if not exists cs_referral_payout_business_idx on public.cs_referral_payout(business_id);

alter table public.cs_referral_payout enable row level security;
revoke all on public.cs_referral_payout from anon;
grant select, insert on public.cs_referral_payout to authenticated;
drop policy if exists "payout staff read" on public.cs_referral_payout;
create policy "payout staff read" on public.cs_referral_payout for select to authenticated using (true);
drop policy if exists "payout admin insert" on public.cs_referral_payout;
create policy "payout admin insert" on public.cs_referral_payout for insert to authenticated
  with check (public.cs_my_role() = 'admin');

-- Reward earned for ONE referred business, by referrer kind:
--   affiliate / business → share% × 12-month payments
--   staff                → the flat per-plan bonus
create or replace function public._referral_reward(_kind text, _share numeric, _plan text, _paid12 numeric, _bonus jsonb)
returns numeric language sql immutable as $$
  select case
    when _kind = 'staff' then coalesce((_bonus ->> lower(coalesce(_plan, '')))::numeric, 0)
    else round(coalesce(_paid12, 0) * coalesce(_share, 0) / 100.0)
  end;
$$;

-- ---------------------------------------------------------------- referrers summary (registry ∪ businesses)
-- Every referrer — affiliates/staff from cs_referrer PLUS businesses that generated a code — with
-- their earned / paid / accrued totals. Powers the Referrers tab and the payout actions.
create or replace function public.cs_referrers_summary(p_search text default null)
returns table (
  code text, name text, kind text, phone text, email text, active boolean,
  business_id uuid, effective_share_percent numeric,
  referred_count int, converted_count int,
  earned numeric, paid numeric, accrued numeric,
  bank_name text, account_number text, account_name text
)
language plpgsql stable security definer set search_path = public as $$
declare v_share numeric; v_biz_share numeric; v_bonus jsonb;
begin
  select affiliate_share_percent, business_share_percent, staff_bonus
    into v_share, v_biz_share, v_bonus from public.referral_config limit 1;
  return query
  with firsts as (
    select rp.business_id, min(rp.paid_at) as first_paid
    from public.cs_renewal_payment rp group by rp.business_id
  ),
  sums as (
    select f.business_id, coalesce(sum(rp.amount), 0) as total_12m
    from firsts f join public.cs_renewal_payment rp
      on rp.business_id = f.business_id and rp.paid_at < (f.first_paid + interval '12 months')
    group by f.business_id
  ),
  -- The universe of referrers: registered affiliates/staff + businesses with their own code.
  referrers as (
    select cr.code, cr.name, cr.kind, cr.phone, cr.email, cr.active,
           null::uuid as business_id, coalesce(cr.share_percent, v_share) as share,
           cr.bank_name, cr.account_number, cr.account_name
    from public.cs_referrer cr
    union all
    select b.referral_code, b.name, 'business', to_jsonb(b) ->> 'whatsapp_number', null, true,
           b.id, v_biz_share, null, null, null
    from public.businesses b where b.referral_code is not null
  ),
  -- Each referrer's referred businesses + the reward earned per referred.
  earned_by as (
    select r.code,
           count(rb.id)::int as referred_count,
           count(rb.id) filter (where s.total_12m is not null)::int as converted_count,
           coalesce(sum(public._referral_reward(r.kind, r.share, to_jsonb(rb) ->> 'subscription_tier', s.total_12m, v_bonus)), 0) as earned
    from referrers r
    left join public.businesses rb on upper(rb.referred_by_code) = upper(r.code)
    left join sums s on s.business_id = rb.id
    group by r.code
  ),
  paid_by as (
    select r.code, coalesce(sum(p.amount), 0) as paid
    from referrers r
    left join public.cs_referral_payout p
      on (r.business_id is not null and p.business_id = r.business_id)
      or (r.business_id is null and upper(p.code) = upper(r.code))
    group by r.code
  )
  select r.code, r.name, r.kind, r.phone, r.email, r.active, r.business_id, r.share,
         e.referred_count, e.converted_count, e.earned, pb.paid, (e.earned - pb.paid) as accrued,
         r.bank_name, r.account_number, r.account_name
  from referrers r
  join earned_by e on e.code = r.code
  join paid_by pb on pb.code = r.code
  where public.cs_my_role() is not null
    and (p_search is null or p_search = '' or r.name ilike '%' || p_search || '%' or r.code ilike '%' || p_search || '%')
  order by (e.earned - pb.paid) desc, e.referred_count desc;
end $$;
revoke all on function public.cs_referrers_summary(text) from public, anon;
grant execute on function public.cs_referrers_summary(text) to authenticated;

-- ---------------------------------------------------------------- record a payout
-- Admin-only. Records a cash payout (affiliate/staff) or a subscription credit (business). For a
-- subscription credit, auto-extends the business's renewal by floor(amount ÷ monthly price) whole
-- months (any remainder stays as accrued credit). Returns the months added.
create or replace function public.cs_record_payout(p_code text, p_business_id uuid, p_amount numeric, p_kind text, p_note text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare v_monthly numeric; v_months int := 0; v_tier text;
begin
  if public.cs_my_role() <> 'admin' then raise exception 'not authorized' using errcode = '42501'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'amount must be positive'; end if;
  if p_kind not in ('cash', 'subscription') then raise exception 'invalid kind'; end if;

  if p_kind = 'subscription' then
    if p_business_id is null then raise exception 'a business is required for a subscription credit'; end if;
    select subscription_tier into v_tier from public.businesses where id = p_business_id;
    select price_amount into v_monthly from public.plans where key = coalesce(v_tier, 'free');
    if coalesce(v_monthly, 0) > 0 then
      v_months := floor(p_amount / v_monthly);
      if v_months > 0 then
        update public.businesses
          set subscription_renews_at = greatest(coalesce(subscription_renews_at, now()), now()) + (v_months || ' months')::interval
        where id = p_business_id;
      end if;
    end if;
  end if;

  insert into public.cs_referral_payout (code, business_id, amount, kind, note, created_by)
  values (nullif(upper(coalesce(p_code, '')), ''), p_business_id, p_amount, p_kind, p_note, auth.uid());
  return v_months;
end $$;
revoke all on function public.cs_record_payout(text, uuid, numeric, text, text) from public, anon;
grant execute on function public.cs_record_payout(text, uuid, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------- a business's own referral earnings (for iTrova)
-- Called by the iTrova app so a referring business sees what they've accrued. Business-scoped.
create or replace function public.my_referral_earnings()
returns table (referred_count int, converted_count int, earned numeric, credited numeric, accrued numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id(); v_code text; v_share numeric;
begin
  if v_biz is null then return; end if;
  select referral_code into v_code from public.businesses where id = v_biz;
  select business_share_percent into v_share from public.referral_config limit 1;
  if v_code is null then return query select 0, 0, 0::numeric, 0::numeric, 0::numeric; return; end if;
  return query
  with firsts as (
    select rp.business_id, min(rp.paid_at) as first_paid
    from public.cs_renewal_payment rp group by rp.business_id
  ),
  sums as (
    select f.business_id, coalesce(sum(rp.amount), 0) as total_12m
    from firsts f join public.cs_renewal_payment rp
      on rp.business_id = f.business_id and rp.paid_at < (f.first_paid + interval '12 months')
    group by f.business_id
  ),
  refd as (
    select rb.id, s.total_12m
    from public.businesses rb
    left join sums s on s.business_id = rb.id
    where upper(rb.referred_by_code) = upper(v_code)
  )
  select count(*)::int,
         count(*) filter (where total_12m is not null)::int,
         coalesce(sum(round(coalesce(total_12m, 0) * v_share / 100.0)), 0),
         coalesce((select sum(amount) from public.cs_referral_payout where business_id = v_biz), 0),
         coalesce(sum(round(coalesce(total_12m, 0) * v_share / 100.0)), 0) - coalesce((select sum(amount) from public.cs_referral_payout where business_id = v_biz), 0)
  from refd;
end $$;
revoke all on function public.my_referral_earnings() from public, anon;
grant execute on function public.my_referral_earnings() to authenticated;

notify pgrst, 'reload schema';
