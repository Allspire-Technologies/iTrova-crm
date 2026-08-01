-- Referrals: earn from SUBSCRIPTION VALUE, not the manual payment log.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- The bug: conversion and earnings were derived solely from cs_renewal_payment (the Renewals
-- module's hand-logged payments), but a subscription is activated through admin_apply_plan_change,
-- which only writes businesses.subscription_tier/_cycle/_started_at. Activating a referred business
-- therefore left it invisible to referrals: "0/1 converted", blank paid column, earned/accrued 0,
-- and iTrova's own Refer & earn card stuck at zero credit.
--
-- The fix: one shared definition of a referred business's first-year value, derived from the
-- subscription itself, reused by every referral RPC so they can never disagree again.

-- ---------------------------------------------------------------- shared revenue definition
--   converted   → on a paid plan (tier set and not 'free')
--   cycle_price → what ONE billing cycle actually costs: the cycle's list price less its standing
--                 cycle discount (an annual plan is billed once, already discounted — charging the
--                 monthly price × 12 would credit a referrer for money never collected). Falls back
--                 to monthly price × cycle length when a plan has no row for that cycle.
--   cycles      → billing cycles STARTED so far, at least 1 (so a business activated today counts
--                 immediately), capped at one year's worth, and frozen at subscription_renews_at
--                 once it lapses so a churned customer stops accruing commission
--   revenue     → cycles × cycle_price
--
-- Deliberately ignores plans.promo_percent: it is time-limited (promo_until), so applying it would
-- silently rewrite past earnings the day a promo expires. What a business actually paid isn't
-- recorded anywhere, so this is a faithful estimate from standing prices, not a receipt.
drop view if exists public.cs_referral_revenue;
create view public.cs_referral_revenue as
select
  b.id                                             as business_id,
  b.subscription_tier                              as plan_key,
  x.is_paid                                        as converted,
  case when x.is_paid then coalesce(b.subscription_started_at, b.created_at) end as started_at,
  c.cycle_months,
  case when x.is_paid then cy.cycles else 0 end    as cycles,
  case when x.is_paid then round(cy.cycles * pr.cycle_price) else 0 end as revenue
from public.businesses b
left join public.plans p on p.key = b.subscription_tier
cross join lateral (
  select coalesce(b.subscription_tier, 'free') <> 'free'   as is_paid,
         lower(coalesce(b.subscription_cycle, 'monthly'))  as cyc
) x
cross join lateral (
  select case x.cyc when 'annual' then 12 when 'biannual' then 6 when 'quarterly' then 3 else 1 end as cycle_months
) c
left join public.plan_prices pp on pp.plan_id = p.id and pp.cycle = x.cyc
cross join lateral (
  select coalesce(
    round(pp.price_amount * (1 - coalesce(pp.discount_percent, 0) / 100.0)),  -- what one cycle costs
    round(coalesce(p.price_amount, 0) * c.cycle_months)                      -- no cycle row: monthly × length
  ) as cycle_price
) pr
cross join lateral (
  select coalesce(b.subscription_started_at, b.created_at)  as start_at,
         least(now(), coalesce(b.subscription_renews_at, now())) as end_at
) w
cross join lateral (
  select ( extract(year  from age(w.end_at, w.start_at)) * 12
         + extract(month from age(w.end_at, w.start_at)) )::int as elapsed_months
) e
cross join lateral (
  select least(
    ceil(12.0 / c.cycle_months)::int,                          -- one year's worth of cycles
    greatest(1, (e.elapsed_months / c.cycle_months)::int + 1)   -- cycles started so far
  ) as cycles
) cy;

-- Only the SECURITY DEFINER functions below read this; it is not business-scoped on its own.
revoke all on public.cs_referral_revenue from anon, authenticated;

-- ---------------------------------------------------------------- reward per referred business
-- Signature changes (revenue replaces paid-12m, plus an explicit converted gate), so drop first.
-- The gate also fixes a real inconsistency: a staff SPIFF used to pay out on a business that
-- still showed as not converted, because the bonus never looked at payments at all.
drop function if exists public._referral_reward(text, numeric, text, numeric, jsonb);
create or replace function public._referral_reward(
  _kind text, _share numeric, _plan text, _revenue numeric, _bonus jsonb, _converted boolean
) returns numeric language sql immutable as $$
  select case
    when not coalesce(_converted, false) then 0
    when _kind = 'staff' then coalesce((_bonus ->> lower(coalesce(_plan, '')))::numeric, 0)
    else round(coalesce(_revenue, 0) * coalesce(_share, 0) / 100.0)
  end;
$$;

-- ---------------------------------------------------------------- referred signups
-- Same return columns, so no drop needed. first_paid_at now means "subscription start" and
-- total_paid_12m "first-year subscription value" — both still describe when/how much they pay.
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
declare v_share numeric; v_biz_share numeric;
begin
  select affiliate_share_percent, business_share_percent
    into v_share, v_biz_share from public.referral_config limit 1;
  return query
  select
    b.id,
    b.name,
    b.created_at,
    b.referred_by_code,
    coalesce(cr.name, rb.name),
    coalesce(cr.kind, case when rb.id is not null then 'business' end),
    -- A per-referrer override wins; otherwise the rate follows the referrer's KIND. This used to
    -- coalesce everything to the affiliate rate, so business referrers showed the wrong share.
    coalesce(cr.share_percent,
             case when cr.kind = 'business' or (cr.code is null and rb.id is not null)
                  then v_biz_share else v_share end),
    rv.plan_key,
    rv.started_at::date,
    coalesce(rv.revenue, 0),
    coalesce(rv.converted, false),
    (cr.code is not null or rb.id is not null)
  from public.businesses b
  left join public.cs_referrer cr on upper(cr.code) = upper(b.referred_by_code)
  left join public.businesses rb on rb.id <> b.id and upper(rb.referral_code) = upper(b.referred_by_code)
  left join public.cs_referral_revenue rv on rv.business_id = b.id
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

-- ---------------------------------------------------------------- referrers summary
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
  with referrers as (
    select cr.code, cr.name, cr.kind, cr.phone, cr.email, cr.active,
           null::uuid as business_id, coalesce(cr.share_percent, v_share) as share,
           cr.bank_name, cr.account_number, cr.account_name
    from public.cs_referrer cr
    union all
    select b.referral_code, b.name, 'business', to_jsonb(b) ->> 'whatsapp_number', null, true,
           b.id, v_biz_share, null, null, null
    from public.businesses b where b.referral_code is not null
  ),
  earned_by as (
    select r.code,
           count(rb.id)::int as referred_count,
           count(rb.id) filter (where rv.converted)::int as converted_count,
           coalesce(sum(public._referral_reward(
             r.kind, r.share, rv.plan_key, rv.revenue, v_bonus, rv.converted)), 0) as earned
    from referrers r
    left join public.businesses rb on upper(rb.referred_by_code) = upper(r.code)
    left join public.cs_referral_revenue rv on rv.business_id = rb.id
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

-- ---------------------------------------------------------------- a business's own earnings (iTrova card)
-- Same source as the CRM, so "credit available" in the app matches what an admin sees.
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
  with refd as (
    select rv.converted, rv.revenue
    from public.businesses rb
    left join public.cs_referral_revenue rv on rv.business_id = rb.id
    where upper(rb.referred_by_code) = upper(v_code)
  ),
  tot as (
    select count(*)::int as referred,
           count(*) filter (where converted)::int as conv,
           coalesce(sum(case when converted then round(coalesce(revenue,0) * v_share / 100.0) else 0 end), 0) as earned
    from refd
  ),
  pay as (
    select coalesce(sum(amount), 0) as credited
    from public.cs_referral_payout where business_id = v_biz
  )
  select t.referred, t.conv, t.earned, p.credited, (t.earned - p.credited) from tot t cross join pay p;
end $$;
revoke all on function public.my_referral_earnings() from public, anon;
grant execute on function public.my_referral_earnings() to authenticated;

notify pgrst, 'reload schema';
