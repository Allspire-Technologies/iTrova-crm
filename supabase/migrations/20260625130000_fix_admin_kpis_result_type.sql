-- Fix for admin_dashboard_kpis(): total_sales/total_products were declared bigint, but
-- sum(<bigint column>) returns NUMERIC in Postgres, so RETURN QUERY raised
-- "structure of query does not match function result type" and the dashboard errored.
-- These are counts, so cast the sums back to bigint. create or replace keeps the same
-- signature and return type (the migration that introduced this is left immutable).

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
    (select coalesce(sum(case when cycle = 'year' then amount / 12.0 else amount end), 0)
       from public.subscriptions where status = 'active')::numeric,
    'NGN'::text,
    (select coalesce(sum(revenue_recorded), 0) from public.mv_business_aggregates)::numeric,
    (select coalesce(sum(sales_count), 0) from public.mv_business_aggregates)::bigint,
    (select coalesce(sum(products_total), 0) from public.mv_business_aggregates)::bigint;
end $$;
