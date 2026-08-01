-- Record what a business ACTUALLY paid, so referral value stops being an estimate.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- 20260801100000 derived a referred business's first-year value from standing list prices, because
-- the real amount was never captured anywhere: a business on a promo, or given a manual discount,
-- was valued at list and its referrer over-credited.
--
-- cs_renewal_payment already exists for exactly this and the Renewals module writes it by hand —
-- the gap was that ACTIVATION never did. So: capture the amount on the plan-change request, write a
-- payment row when the change is applied, and let referral value prefer real payments over the
-- estimate. Businesses with no recorded payment keep working on the estimate, so nothing regresses.

-- ---------------------------------------------------------------- 1. carry the amount on the request
alter table public.cs_plan_change_request add column if not exists amount numeric;
comment on column public.cs_plan_change_request.amount is
  'What the customer actually pays for this cycle. Defaults to the catalogue price; an admin can '
  'override it for a promo or negotiated rate. Written to cs_renewal_payment when the change applies.';

-- ---------------------------------------------------------------- 2. request captures the amount
-- Signature gains p_amount, so drop the old one rather than leave an ambiguous overload.
drop function if exists public.admin_request_plan_change(uuid, text, text);
create or replace function public.admin_request_plan_change(
  p_business_id uuid, p_to_tier text, p_to_cycle text, p_amount numeric default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_tier text; v_cycle text; v_id uuid; v_amount numeric;
begin
  if not public.cs_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_business_id is null or p_to_tier is null or p_to_cycle is null then
    raise exception 'business, target plan and cycle are required';
  end if;
  select subscription_tier, subscription_cycle into v_tier, v_cycle
    from public.businesses where id = p_business_id;
  if not found then
    raise exception 'business not found' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.plan_prices_view where plan_key = p_to_tier and cycle = p_to_cycle) then
    raise exception 'no % plan on a % cycle', p_to_tier, p_to_cycle;
  end if;
  if exists (select 1 from public.cs_plan_change_request
             where business_id = p_business_id and status in ('pending', 'approved')) then
    raise exception 'a plan change is already in progress for this business';
  end if;

  -- Default to the catalogue price for that cycle (list less its standing discount) when the
  -- caller doesn't pass one, so an amount is always recorded.
  if p_amount is not null then
    v_amount := p_amount;
  else
    select round(pp.price_amount * (1 - coalesce(pp.discount_percent, 0) / 100.0))
      into v_amount
      from public.plan_prices pp
      join public.plans pl on pl.id = pp.plan_id
     where pl.key = p_to_tier and pp.cycle = p_to_cycle
     limit 1;
  end if;
  if v_amount is not null and v_amount < 0 then
    raise exception 'amount cannot be negative';
  end if;

  insert into public.cs_plan_change_request
    (business_id, from_tier, to_tier, from_cycle, to_cycle, requested_by, amount)
  values (p_business_id, v_tier, p_to_tier, v_cycle, p_to_cycle, auth.uid(), v_amount)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.admin_request_plan_change(uuid, text, text, numeric) from public, anon;
grant execute on function public.admin_request_plan_change(uuid, text, text, numeric) to authenticated;

-- ---------------------------------------------------------------- 3. applying records the payment
create or replace function public.admin_apply_plan_change(p_request_id uuid, p_code text, p_actor uuid)
returns jsonb
-- search_path includes `extensions` because pgcrypto's crypt() lives there on Supabase.
language plpgsql security definer set search_path = public, extensions as $$
declare r public.cs_plan_change_request%rowtype;
begin
  select * into r from public.cs_plan_change_request where id = p_request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Request not found.');
  end if;
  if r.status <> 'approved' then
    return jsonb_build_object('ok', false, 'error', 'This request is not awaiting execution.');
  end if;
  if r.code_expires_at is null or r.code_expires_at <= now() then
    update public.cs_plan_change_request set status = 'expired' where id = r.id;
    return jsonb_build_object('ok', false, 'error', 'The approval code has expired — request a new one.');
  end if;
  if r.requested_by is distinct from p_actor then
    return jsonb_build_object('ok', false, 'error', 'Only the requesting admin can apply this change.');
  end if;
  if r.approved_by is null or r.approved_by = p_actor then
    return jsonb_build_object('ok', false, 'error', 'This change must be approved by a different admin.');
  end if;
  if r.code_hash is null or crypt(p_code, r.code_hash) <> r.code_hash then
    update public.cs_plan_change_request
       set code_attempts = code_attempts + 1,
           status = case when code_attempts + 1 >= 3 then 'expired' else status end
     where id = r.id;
    return jsonb_build_object('ok', false, 'error', 'Incorrect approval code.');
  end if;

  -- Apply: write the source of truth (mirrors how iTrova itself changes a plan). Setting
  -- subscription_started_at = now() restarts the period (a renewal), and iTrova recomputes
  -- subscription_renews_at from the (possibly switched) cycle; its own triggers propagate price.
  update public.businesses
     set subscription_tier       = r.to_tier,
         subscription_cycle      = coalesce(r.to_cycle, subscription_cycle),
         subscription_started_at = now()
   where id = r.business_id;

  -- Record the money. This is what makes referral value a receipt instead of an estimate, and it
  -- also lands the activation in Renewals/revenue reporting. A downgrade to a free plan pays
  -- nothing, so only record a positive amount.
  if coalesce(r.amount, 0) > 0 then
    insert into public.cs_renewal_payment
      (business_id, paid_at, amount, plan_key, cycle, notes, created_by)
    values (r.business_id, current_date, r.amount, r.to_tier, r.to_cycle,
            'Recorded automatically when the plan change was applied', p_actor);
  end if;

  update public.cs_plan_change_request
     set status = 'executed', executed_at = now()
   where id = r.id;
  return jsonb_build_object('ok', true, 'to_tier', r.to_tier, 'amount_recorded', coalesce(r.amount, 0));
end $$;
revoke all on function public.admin_apply_plan_change(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_apply_plan_change(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------- 4. prefer real payments
-- Recorded payments win where they exist; the subscription estimate is the fallback so a business
-- activated before this migration still shows a sensible figure. `source` says which was used, so
-- the UI can be honest about it rather than presenting a guess as a receipt.
drop view if exists public.cs_referral_revenue;
create view public.cs_referral_revenue as
with firsts as (
  select rp.business_id, min(rp.paid_at) as first_paid
  from public.cs_renewal_payment rp
  where rp.amount is not null and rp.amount > 0     -- ref-only rows aren't evidence of an amount
  group by rp.business_id
),
actuals as (
  select f.business_id, f.first_paid, sum(rp.amount) as total
  from firsts f
  join public.cs_renewal_payment rp
    on rp.business_id = f.business_id
   and rp.amount is not null and rp.amount > 0
   and rp.paid_at < (f.first_paid + interval '12 months')  -- first-year window
  group by f.business_id, f.first_paid
)
select
  b.id                                                as business_id,
  b.subscription_tier                                 as plan_key,
  (x.is_paid or a.total is not null)                  as converted,
  coalesce(a.first_paid::timestamptz,
           case when x.is_paid then coalesce(b.subscription_started_at, b.created_at) end) as started_at,
  c.cycle_months,
  case when x.is_paid then cy.cycles else 0 end       as cycles,
  case when a.total is not null then round(a.total)
       when x.is_paid              then round(cy.cycles * pr.cycle_price)
       else 0 end                                     as revenue,
  case when a.total is not null then 'recorded' else 'estimated' end as source
from public.businesses b
left join public.plans p on p.key = b.subscription_tier
left join actuals a on a.business_id = b.id
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
    ceil(12.0 / c.cycle_months)::int,
    greatest(1, (e.elapsed_months / c.cycle_months)::int + 1)
  ) as cycles
) cy;

revoke all on public.cs_referral_revenue from anon, authenticated;

-- ---------------------------------------------------------------- 4b. referee discount, admin side
-- iTrova auto-applies the referee's first-payment discount on its Billing tab, but the CRM's
-- upgrade path priced straight from the catalogue — so a referred business was shown "X% off your
-- first payment" in the app and then charged full price by an admin. my_referee_discount() is
-- business-scoped (current_business_id), so the CRM can't reuse it for someone else's business.
-- Same rules: a valid referral code, and only until their first paid cycle exists.
create or replace function public.cs_referee_discount(p_business_id uuid)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v_code text; v_cycle text; v_pct numeric; v_valid boolean;
begin
  if public.cs_my_role() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select nullif(upper(trim(referred_by_code)), ''), subscription_cycle
    into v_code, v_cycle from public.businesses where id = p_business_id;
  if v_code is null then return 0; end if;
  if v_cycle is not null then return 0; end if;   -- first payment already taken, discount spent
  select exists (select 1 from public.cs_referrer cr where upper(cr.code) = v_code and cr.active)
      or exists (select 1 from public.businesses b
                  where upper(b.referral_code) = v_code and b.id <> p_business_id)
    into v_valid;
  if not v_valid then return 0; end if;
  select referee_discount_percent into v_pct from public.referral_config limit 1;
  return coalesce(v_pct, 0);
end $$;
revoke all on function public.cs_referee_discount(uuid) from public, anon;
grant execute on function public.cs_referee_discount(uuid) to authenticated;

-- ---------------------------------------------------------------- 5. surface which figure it is
-- Adds value_source to the referred-signups list so the UI never presents an estimate as a receipt.
-- Return type changes, so the function must be dropped first (42P13).
drop function if exists public.cs_referrals(text);
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
  matched                 boolean,
  value_source            text
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
    -- A per-referrer override wins; otherwise the rate follows the referrer's KIND.
    coalesce(cr.share_percent,
             case when cr.kind = 'business' or (cr.code is null and rb.id is not null)
                  then v_biz_share else v_share end),
    rv.plan_key,
    rv.started_at::date,
    coalesce(rv.revenue, 0),
    coalesce(rv.converted, false),
    (cr.code is not null or rb.id is not null),
    rv.source
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

notify pgrst, 'reload schema';
