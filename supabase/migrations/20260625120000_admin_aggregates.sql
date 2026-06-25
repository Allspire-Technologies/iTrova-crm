-- Secure aggregate data layer for Admin OS. APPLIED TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- PRD §11 / docs/itrova-context.md. Staff-gated, cross-tenant operational aggregates for the
-- dashboard KPIs, the customers table and the customer detail page. Cross-tenant data is
-- exposed ONLY through SECURITY DEFINER functions that first verify is_platform_admin(); the
-- heavy per-business rollups are precomputed in a materialized view refreshed by pg_cron, so
-- the browser never reads raw operational rows and never sees a service-role key.
--
-- Real iTrova table.columns used: businesses, profiles, auth.users.last_sign_in_at, products,
-- sales, orders, purchase_orders, stock_adjustments, plus our subscriptions table.

-- ---------------------------------------------------------------------------
-- 1. Materialized view: one row per business with operational aggregates.
-- ---------------------------------------------------------------------------
drop materialized view if exists public.mv_business_aggregates;
create materialized view public.mv_business_aggregates as
select
  b.id as business_id,
  -- users
  (select count(*) from public.profiles p where p.business_id = b.id)                                    as total_users,
  (select count(*) from public.profiles p
     where p.business_id = b.id and p.last_seen >= now() - interval '30 days')                            as active_users,
  (select max(u.last_sign_in_at) from public.profiles p
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

-- Unique index is required for REFRESH ... CONCURRENTLY.
create unique index mv_business_aggregates_pk on public.mv_business_aggregates (business_id);

-- Not directly readable by API roles; only the SECURITY DEFINER functions below read it.
revoke all on public.mv_business_aggregates from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Row shape shared by the overview and detail accessors.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.admin_business_row as (
    business_id uuid,
    name text,
    currency text,
    timezone text,
    whatsapp_number text,
    owner_id uuid,
    owner_name text,
    plan_key text,
    subscription_status text,
    subscription_amount numeric,
    subscription_cycle text,
    subscription_started timestamptz,
    renewal_date timestamptz,
    joined_at timestamptz,
    total_users bigint,
    active_users bigint,
    last_login timestamptz,
    products_total bigint,
    products_added_30d bigint,
    products_low_stock bigint,
    stock_movements bigint,
    purchase_orders bigint,
    sales_count bigint,
    revenue_recorded numeric,
    orders_count bigint
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Staff-gated accessors. SECURITY DEFINER so they can read the matview and
--    cross-tenant tables, but every one first checks is_platform_admin().
--    p_business_id null -> all businesses (table); set -> one (detail page).
-- ---------------------------------------------------------------------------
create or replace function public.admin_business_aggregates(p_business_id uuid default null)
returns setof public.admin_business_row
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select
    b.id,
    b.name,
    b.currency,
    b.timezone,
    b.whatsapp_number,
    b.owner_id,
    (select owner_name from public.profiles where id = b.owner_id),
    b.subscription_tier,
    s.status::text,
    s.amount,
    s.cycle,
    s.started_at,
    s.current_period_end,
    b.created_at,
    coalesce(m.total_users, 0),
    coalesce(m.active_users, 0),
    m.last_login,
    coalesce(m.products_total, 0),
    coalesce(m.products_added_30d, 0),
    coalesce(m.products_low_stock, 0),
    coalesce(m.stock_movements, 0),
    coalesce(m.purchase_orders, 0),
    coalesce(m.sales_count, 0),
    coalesce(m.revenue_recorded, 0),
    coalesce(m.orders_count, 0)
  from public.businesses b
  left join public.mv_business_aggregates m on m.business_id = b.id
  left join public.subscriptions s on s.business_id = b.id
  where p_business_id is null or b.id = p_business_id
  order by b.created_at desc;
end $$;

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
    (select count(*) from public.businesses),
    (select count(*) from public.subscriptions where status = 'active'),
    (select count(*) from public.businesses where created_at >= date_trunc('month', now())),
    (select coalesce(sum(case when cycle = 'year' then amount / 12.0 else amount end), 0)
       from public.subscriptions where status = 'active'),
    'NGN'::text,
    (select coalesce(sum(revenue_recorded), 0) from public.mv_business_aggregates),
    (select coalesce(sum(sales_count), 0) from public.mv_business_aggregates),
    (select coalesce(sum(products_total), 0) from public.mv_business_aggregates);
end $$;

-- On-demand refresh from the Admin UI (still staff-gated).
create or replace function public.admin_refresh_aggregates()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  refresh materialized view concurrently public.mv_business_aggregates;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Lock down execute to authenticated (each fn still re-checks is_platform_admin()).
-- ---------------------------------------------------------------------------
revoke all on function public.admin_business_aggregates(uuid) from public;
revoke all on function public.admin_dashboard_kpis() from public;
revoke all on function public.admin_refresh_aggregates() from public;
grant execute on function public.admin_business_aggregates(uuid) to authenticated;
grant execute on function public.admin_dashboard_kpis() to authenticated;
grant execute on function public.admin_refresh_aggregates() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Refresh mechanism: pg_cron every 5 minutes (CONCURRENTLY, so reads never block).
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;
do $$ begin
  perform cron.unschedule('refresh_business_aggregates');
exception when others then null; end $$;
select cron.schedule(
  'refresh_business_aggregates',
  '*/5 * * * *',
  $cron$refresh materialized view concurrently public.mv_business_aggregates$cron$
);
