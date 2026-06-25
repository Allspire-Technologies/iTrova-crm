-- Align pipeline auto-derivation with the PRD §7.6 stage rules. APPLIED TO THE SHARED iTrova
-- PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- The first pipeline migration encoded the stage logic inline inside cs_auto_stage() with a
-- looser approximation (it leaned on the health band and a 14-day tenure rule the PRD doesn't
-- mention, and churned only never-subscribed businesses). This migration:
--   1. extracts a PURE, testable rule function cs_pipeline_stage(...) — same shape as the
--      alert engine's cs_alert_rules() — encoding the §7.6 rules verbatim, and
--   2. rewrites cs_auto_stage() to gather the inputs and delegate to it.
-- cs_derive_pipeline() / cs_nightly() / admin_pipeline_board() are unchanged; they call
-- cs_auto_stage(). A re-derivation runs at the end (auto rows only — manual moves preserved).
--
-- §7.6 rules (auto-derivable; 'lead' is manual-only, so the auto result is never 'lead'):
--   Churned   — subscription lapsed/cancelled, OR (not paying AND no login 30d+).
--   Renewed   — active subscription past at least one renewal boundary.
--   PowerUser — sustained usage: >=2 active users, POs created, sales, login within 7d.
--   Active    — products added AND sales recorded AND logging in (30d).
--   Onboarding— subscribed but setup incomplete (no products and/or no sales yet).
--   Subscribed— has a subscription but none of the engagement above.
--   Registered— account exists, no active/trial subscription.

-- ---------------------------------------------------------------------------
-- 1. Pure rule (no table reads) — crafted-input testable. now() is a parameter.
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
    -- Renewed: active subscription past at least one renewal boundary.
    when p_sub_status = 'active'
         and p_sub_started is not null
         and p_now >= p_sub_started + (case when p_sub_cycle = 'year' then interval '365 days' else interval '30 days' end)
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
revoke all on function public.cs_pipeline_stage(timestamptz, bigint, bigint, timestamptz, bigint, bigint, text, timestamptz, text, timestamptz) from public;
grant execute on function public.cs_pipeline_stage(timestamptz, bigint, bigint, timestamptz, bigint, bigint, text, timestamptz, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Accessor: gather one business's inputs and delegate to the pure rule.
-- ---------------------------------------------------------------------------
create or replace function public.cs_auto_stage(p_business_id uuid)
returns text
language sql stable set search_path = public as $$
  with b as (
    select * from public.businesses where id = p_business_id
  ),
  s as (
    select * from public.subscriptions
    where business_id = p_business_id
    order by current_period_end desc nulls last
    limit 1
  ),
  m as (
    select * from public.mv_business_aggregates where business_id = p_business_id
  )
  select public.cs_pipeline_stage(
    (select created_at from b),
    coalesce((select products_total from m), 0),
    coalesce((select sales_count from m), 0),
    (select last_login from m),
    coalesce((select active_users from m), 0),
    coalesce((select purchase_orders from m), 0),
    (select status::text from s),
    (select started_at from s),
    (select cycle from s),
    now()
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Re-derive with the aligned rules (auto rows only; manual moves preserved).
-- ---------------------------------------------------------------------------
select public.cs_derive_pipeline();
