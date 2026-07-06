-- Fix the "last login" signal: count ANY team member's activity, not just explicit re-auth.
-- APPLIED TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- last_login was derived from auth.users.last_sign_in_at, which only updates on an EXPLICIT
-- sign-in (entering a password). iTrova keeps users signed in with persistent sessions and
-- auto-refreshed tokens, so a team that uses the app every day — without ever re-entering a
-- password — showed a weeks-old "last login". That depressed health scores, fired false churn
-- alerts, and pushed active businesses toward 'churned' in the pipeline.
--
-- Fix: per team member, take GREATEST(auth.users.last_sign_in_at, profiles.last_seen) — a real
-- sign-in OR app activity (iTrova's last_seen heartbeat, already trusted for active_users) —
-- then MAX over the whole team: one person logging in counts as a login for the business.
-- (GREATEST ignores nulls in Postgres, so members missing either signal still count via the
-- other.) The same stale query lived in THREE engines; all are updated to the shared definition:
--   1. mv_business_aggregates.last_login   (dashboard/customers/detail aggregates)
--   2. cs_compute_health                   (health engine input)
--   3. cs_eval_alerts                      (alert engine input)
-- Then everything derived from it is recomputed (snapshots, alerts, pipeline).

-- ---------------------------------------------------------------------------
-- 1. Materialized view: recreate with the corrected last_login expression.
--    (Full definition copied from 20260625120000; only last_login changes.)
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_business_aggregates;
create materialized view public.mv_business_aggregates as
select
  b.id as business_id,
  -- users
  (select count(*) from public.profiles p where p.business_id = b.id)                                    as total_users,
  (select count(*) from public.profiles p
     where p.business_id = b.id and p.last_seen >= now() - interval '30 days')                            as active_users,
  -- Any team member's sign-in OR app activity, whichever is newest (see header).
  (select max(greatest(u.last_sign_in_at, p.last_seen)) from public.profiles p
     join auth.users u on u.id = p.id where p.business_id = b.id)                                         as last_login,
  -- products / inventory (products has no updated_at, so "updated" is not trackable here)
  (select count(*) from public.products pr where pr.business_id = b.id)                                   as products_total,
  (select count(*) from public.products pr
     where pr.business_id = b.id and pr.created_at >= now() - interval '30 days')                          as products_added_30d,
  (select count(*) from public.products pr
     where pr.business_id = b.id and pr.stock_quantity <= pr.reorder_level)                                as products_low_stock,
  -- stock movements (explicit adjustment log)
  (select count(*) from public.stock_adjustments sa where sa.business_id = b.id)                           as stock_movements,
  -- purchase orders
  (select count(*) from public.purchase_orders po where po.business_id = b.id)                             as purchase_orders,
  -- sales (POS) — exclude voided
  (select count(*) from public.sales s where s.business_id = b.id and s.voided = false)                    as sales_count,
  (select coalesce(sum(s.total_amount), 0) from public.sales s
     where s.business_id = b.id and s.voided = false)                                                      as revenue_recorded,
  -- online / whatsapp orders (separate channel)
  (select count(*) from public.orders o where o.business_id = b.id)                                        as orders_count,
  now() as computed_at
from public.businesses b;

-- Unique index is required for REFRESH ... CONCURRENTLY (the 5-min cron).
create unique index mv_business_aggregates_pk on public.mv_business_aggregates (business_id);

-- Not directly readable by API roles; only the SECURITY DEFINER functions read it.
revoke all on public.mv_business_aggregates from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Health engine input: same corrected signal.
--    (Full recreate of cs_compute_health from 20260625150000; only v_last_login changes.)
-- ---------------------------------------------------------------------------
create or replace function public.cs_compute_health(p_business_id uuid)
returns table(score int, band text, reasons jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  s public.cs_settings := public.cs_get_settings();
  v_last_login timestamptz; v_products_total int; v_products_recent int;
  v_last_sale timestamptz; v_active_users int; v_sub_status text; v_period_end timestamptz;
begin
  -- Any team member's sign-in OR app activity, whichever is newest.
  select max(greatest(u.last_sign_in_at, p.last_seen)) into v_last_login
    from public.profiles p join auth.users u on u.id = p.id where p.business_id = p_business_id;

  select count(*),
         count(*) filter (where pr.created_at >= now() - make_interval(days => s.products_stale_days))
    into v_products_total, v_products_recent
    from public.products pr where pr.business_id = p_business_id;

  select max(created_at) into v_last_sale
    from public.sales where business_id = p_business_id and voided = false;

  select count(*) into v_active_users
    from public.profiles
    where business_id = p_business_id and last_seen >= now() - make_interval(days => s.adoption_active_days);

  select status::text, current_period_end into v_sub_status, v_period_end
    from public.subscriptions where business_id = p_business_id order by started_at desc limit 1;

  return query select * from public.cs_score(
    v_last_login, v_products_total, v_products_recent, v_last_sale, v_active_users, v_sub_status, v_period_end, now());
end $$;

-- ---------------------------------------------------------------------------
-- 3. Alert engine input: same corrected signal.
--    (Full recreate of cs_eval_alerts from 20260625160000; only v_last_login changes.)
-- ---------------------------------------------------------------------------
create or replace function public.cs_eval_alerts(p_business_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_created timestamptz; v_products int; v_first_product timestamptz;
  v_last_sale timestamptz; v_last_login timestamptz; v_sub_status text; v_period_end timestamptz;
  r record;
begin
  select created_at into v_created from public.businesses where id = p_business_id;
  if v_created is null then return; end if;

  select count(*), min(created_at) into v_products, v_first_product
    from public.products where business_id = p_business_id;
  select max(created_at) into v_last_sale
    from public.sales where business_id = p_business_id and voided = false;
  -- Any team member's sign-in OR app activity, whichever is newest.
  select max(greatest(u.last_sign_in_at, p.last_seen)) into v_last_login
    from public.profiles p join auth.users u on u.id = p.id where p.business_id = p_business_id;
  select status::text, current_period_end into v_sub_status, v_period_end
    from public.subscriptions where business_id = p_business_id order by started_at desc limit 1;

  for r in select * from public.cs_alert_rules(
    v_created, v_products, v_first_product, v_last_sale, v_last_login, v_sub_status, v_period_end, now())
  loop
    perform public.cs_apply_alert(p_business_id, r.kind, r.active, r.severity, r.detail);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Recompute everything the stale signal fed: health snapshots, alerts (stale churn alerts
--    auto-resolve on re-eval), and pipeline stages (manual moves preserved). The MV itself was
--    freshly populated by the CREATE above.
-- ---------------------------------------------------------------------------
select public.cs_nightly();
