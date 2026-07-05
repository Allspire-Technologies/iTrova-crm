-- Normalize billing-cycle math for the REAL iTrova cycles. APPLIED TO THE SHARED iTrova PROJECT
-- (wnuyzsjhijhnhkpcnnqu).
--
-- iTrova bills per cycle: monthly / quarterly / biannual / annual (plan_prices_view prices each
-- plan_key per cycle, with a per-cycle discount). But the CRM's money/renewal math still assumed
-- the old 'month' | 'year' vocabulary and only special-cased 'year':
--   * admin_dashboard_kpis MRR counted an ANNUAL plan's full price as monthly revenue (and
--     quarterly/biannual were never divided at all);
--   * cs_pipeline_stage's "renewed" boundary was 365d for 'year', else 30d — so quarterly/biannual
--     businesses hit "renewed" after one month, and 'annual' (not 'year') after 30 days too;
--   * tg_business_sync_subscription mirrored subscriptions.cycle/amount from the plan's BASE
--     billing_period/price_amount, ignoring the business's actual subscription_cycle and the
--     per-cycle discounted price — so a plan change to e.g. Pro/annual left the subscriptions row
--     (and therefore MRR) wrong.
--
-- Fix: one pure helper (cs_cycle_months) used everywhere, cycle+discounted amount taken from the
-- business row + plan_prices_view, a backfill to correct existing subscriptions rows, and a
-- pipeline re-derivation. The frontend Home MRR gets the same normalization in src/lib/home.ts.

-- ---------------------------------------------------------------------------
-- 1. Pure helper: months per billing cycle. Accepts both the real iTrova vocabulary
--    (monthly/quarterly/biannual/annual) and the legacy one ('month'/'year'); unknown/null → 1
--    (treat as monthly — never inflate).
-- ---------------------------------------------------------------------------
create or replace function public.cs_cycle_months(p_cycle text)
returns int
language sql immutable as $$
  select case lower(coalesce(p_cycle, 'monthly'))
    when 'monthly'    then 1
    when 'month'      then 1
    when 'quarterly'  then 3
    when 'quarter'    then 3
    when 'biannual'   then 6
    when 'semiannual' then 6
    when 'annual'     then 12
    when 'annually'   then 12
    when 'yearly'     then 12
    when 'year'       then 12
    else 1
  end;
$$;
revoke all on function public.cs_cycle_months(text) from public;
grant execute on function public.cs_cycle_months(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. admin_dashboard_kpis: MRR = amount normalized to a month by the row's cycle.
--    (Full recreate of the 20260625130000 definition; only the MRR expression changes.)
-- ---------------------------------------------------------------------------
create or replace function public.admin_dashboard_kpis()
returns table (
  total_businesses bigint,
  active_subscriptions bigint,
  new_this_month bigint,
  mrr numeric,
  currency text,
  total_revenue numeric,
  total_sales bigint,
  total_products bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select
    (select count(*) from public.businesses)::bigint,
    (select count(*) from public.subscriptions where status = 'active')::bigint,
    (select count(*) from public.businesses where created_at >= date_trunc('month', now()))::bigint,
    (select coalesce(sum(amount / public.cs_cycle_months(cycle)), 0)
       from public.subscriptions where status = 'active')::numeric,
    'NGN'::text,
    (select coalesce(sum(revenue_recorded), 0) from public.mv_business_aggregates)::numeric,
    (select coalesce(sum(sales_count), 0) from public.mv_business_aggregates)::bigint,
    (select coalesce(sum(products_total), 0) from public.mv_business_aggregates)::bigint;
end $$;

-- ---------------------------------------------------------------------------
-- 3. cs_pipeline_stage: the "renewed" boundary is one full billing period (in months), not
--    year?365d:30d. Same signature/return, so create-or-replace keeps all callers
--    (cs_auto_stage → cs_derive_pipeline → cs_nightly) intact.
-- ---------------------------------------------------------------------------
create or replace function public.cs_pipeline_stage(
  p_created         timestamptz,
  p_products        bigint,
  p_sales           bigint,
  p_last_login      timestamptz,
  p_active_users    bigint,
  p_purchase_orders bigint,
  p_sub_status      text,
  p_sub_started     timestamptz,
  p_sub_cycle       text,
  p_now             timestamptz default now()
)
returns text
language sql immutable as $$
  select case
    -- Churned: lapsed/cancelled, OR not paying AND no login for 30d+ (account 30d+ old).
    when p_sub_status in ('canceled', 'expired') then 'churned'
    when coalesce(p_sub_status, 'none') <> 'active'
         and p_created < p_now - interval '30 days'
         and coalesce(p_last_login, 'epoch'::timestamptz) < p_now - interval '30 days'
      then 'churned'
    -- Renewed: active subscription past at least one full billing period (monthly/quarterly/
    -- biannual/annual — normalized via cs_cycle_months).
    when p_sub_status = 'active'
         and p_sub_started is not null
         and p_now >= p_sub_started + make_interval(months => public.cs_cycle_months(p_sub_cycle))
      then 'renewed'
    -- Power User: sustained usage.
    when p_sub_status in ('active', 'trialing')
         and coalesce(p_active_users, 0) >= 2
         and coalesce(p_purchase_orders, 0) > 0
         and coalesce(p_sales, 0) > 0
         and coalesce(p_last_login, 'epoch'::timestamptz) >= p_now - interval '7 days'
      then 'power_user'
    -- Active: products added AND sales recorded AND logging in (30d).
    when p_sub_status in ('active', 'trialing')
         and coalesce(p_products, 0) > 0
         and coalesce(p_sales, 0) > 0
         and coalesce(p_last_login, 'epoch'::timestamptz) >= p_now - interval '30 days'
      then 'active'
    -- Onboarding: subscribed but setup incomplete.
    when p_sub_status in ('active', 'trialing')
         and (coalesce(p_products, 0) = 0 or coalesce(p_sales, 0) = 0)
      then 'onboarding'
    -- Subscribed: has a subscription (incl. past_due) but none of the engagement above.
    when p_sub_status is not null then 'subscribed'
    -- Registered: account exists, no active/trial subscription. ('lead' is manual-only.)
    else 'registered'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 4. tg_business_sync_subscription: mirror the business's ACTUAL cycle, and price it from
--    plan_prices_view for that (plan, cycle) pair with the per-cycle discount applied (what the
--    business actually pays). Falls back to the plan's base price/billing_period when the view has
--    no row (e.g. free).
-- ---------------------------------------------------------------------------
create or replace function public.tg_business_sync_subscription()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pl public.plans%rowtype;
  v_cycle text;
  v_amount numeric;
begin
  select * into pl from public.plans where key = coalesce(new.subscription_tier, 'free');
  if not found then
    return new;  -- unknown tier (shouldn't happen via FK); never block the business write
  end if;
  v_cycle := coalesce(new.subscription_cycle, pl.billing_period, 'monthly');
  -- Per-cycle discounted price; base plan price when the (plan, cycle) pair isn't in the matrix.
  select round(v.price_amount * (1 - coalesce(v.discount_percent, 0) / 100.0), 2) into v_amount
    from public.plan_prices_view v
   where v.plan_key = pl.key and v.cycle = v_cycle;
  if v_amount is null then v_amount := pl.price_amount; end if;

  insert into public.subscriptions
    (business_id, plan_key, cycle, status, amount, currency,
     current_period_start, current_period_end, started_at)
  values
    (new.id, pl.key, v_cycle,
     'active'::public.subscription_status, v_amount, pl.price_currency,
     coalesce(new.subscription_started_at, new.created_at),
     new.subscription_renews_at,
     coalesce(new.subscription_started_at, new.created_at))
  on conflict (business_id) do update set
    plan_key             = excluded.plan_key,
    cycle                = excluded.cycle,
    amount               = excluded.amount,
    currency             = excluded.currency,
    current_period_start = excluded.current_period_start,
    current_period_end   = excluded.current_period_end,
    updated_at           = now();
    -- NOTE: status and started_at are intentionally left untouched on update.
  return new;
end $$;
-- (The trigger itself — businesses_sync_subscription, 20260627130000 — is unchanged and keeps
-- pointing at this function.)

-- ---------------------------------------------------------------------------
-- 5. Backfill: correct every existing subscriptions row (actual cycle + discounted per-cycle
--    amount), then re-derive auto pipeline stages under the fixed renewal boundary.
-- ---------------------------------------------------------------------------
update public.subscriptions s set
  cycle      = coalesce(b.subscription_cycle, p.billing_period, s.cycle),
  amount     = coalesce(
                 (select round(v.price_amount * (1 - coalesce(v.discount_percent, 0) / 100.0), 2)
                    from public.plan_prices_view v
                   where v.plan_key = coalesce(b.subscription_tier, 'free')
                     and v.cycle = coalesce(b.subscription_cycle, p.billing_period, s.cycle)),
                 p.price_amount,
                 s.amount),
  updated_at = now()
from public.businesses b
left join public.plans p on p.key = coalesce(b.subscription_tier, 'free')
where s.business_id = b.id;

select public.cs_derive_pipeline();
