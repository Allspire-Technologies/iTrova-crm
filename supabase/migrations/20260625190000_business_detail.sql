-- Customer Detail page data (PRD §7.4). APPLIED TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- Two small staff-gated SECURITY DEFINER accessors for the detail page. They are additive —
-- the load-bearing admin_business_aggregates() is intentionally left untouched:
--   * admin_business_profile() — the couple of profile fields the aggregate doesn't carry
--     (industry + the owner's email), read eagerly for the Profile header.
--   * admin_business_usage()  — 30/90-day usage trend counts, fetched lazily by the Product
--     Usage section.
-- Both re-check is_platform_admin() and read only the same staff-visible sources the rest of
-- Admin OS uses. Industry is read defensively (to_jsonb(b)->>'…') so this is resilient to the
-- column's name across environments (NULL rather than an error if absent).

-- ---------------------------------------------------------------------------
-- 1. Profile extras: industry + owner email.
-- ---------------------------------------------------------------------------
create or replace function public.admin_business_profile(p_business_id uuid)
returns table (industry text, owner_email text)
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
    (select au.email::text from auth.users au where au.id = b.owner_id) as owner_email
  from public.businesses b
  where b.id = p_business_id;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Usage trends: total + last-30d + last-90d counts per metric.
--    (Products has no updated_at in iTrova, so "products updated" is not trackable here
--     and is surfaced as unavailable in the UI rather than guessed at.)
-- ---------------------------------------------------------------------------
create or replace function public.admin_business_usage(p_business_id uuid)
returns table (
  products_total bigint, products_30d bigint, products_90d bigint,
  sales_total bigint, sales_30d bigint, sales_90d bigint,
  revenue_total numeric, revenue_30d numeric, revenue_90d numeric,
  stock_total bigint, stock_30d bigint, stock_90d bigint,
  po_total bigint, po_30d bigint, po_90d bigint,
  orders_total bigint, orders_30d bigint, orders_90d bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select
    (select count(*) from public.products pr where pr.business_id = p_business_id),
    (select count(*) from public.products pr where pr.business_id = p_business_id and pr.created_at >= now() - interval '30 days'),
    (select count(*) from public.products pr where pr.business_id = p_business_id and pr.created_at >= now() - interval '90 days'),
    (select count(*) from public.sales s where s.business_id = p_business_id and s.voided = false),
    (select count(*) from public.sales s where s.business_id = p_business_id and s.voided = false and s.created_at >= now() - interval '30 days'),
    (select count(*) from public.sales s where s.business_id = p_business_id and s.voided = false and s.created_at >= now() - interval '90 days'),
    (select coalesce(sum(s.total_amount), 0) from public.sales s where s.business_id = p_business_id and s.voided = false),
    (select coalesce(sum(s.total_amount), 0) from public.sales s where s.business_id = p_business_id and s.voided = false and s.created_at >= now() - interval '30 days'),
    (select coalesce(sum(s.total_amount), 0) from public.sales s where s.business_id = p_business_id and s.voided = false and s.created_at >= now() - interval '90 days'),
    (select count(*) from public.stock_adjustments sa where sa.business_id = p_business_id),
    (select count(*) from public.stock_adjustments sa where sa.business_id = p_business_id and sa.created_at >= now() - interval '30 days'),
    (select count(*) from public.stock_adjustments sa where sa.business_id = p_business_id and sa.created_at >= now() - interval '90 days'),
    (select count(*) from public.purchase_orders po where po.business_id = p_business_id),
    (select count(*) from public.purchase_orders po where po.business_id = p_business_id and po.created_at >= now() - interval '30 days'),
    (select count(*) from public.purchase_orders po where po.business_id = p_business_id and po.created_at >= now() - interval '90 days'),
    (select count(*) from public.orders o where o.business_id = p_business_id),
    (select count(*) from public.orders o where o.business_id = p_business_id and o.created_at >= now() - interval '30 days'),
    (select count(*) from public.orders o where o.business_id = p_business_id and o.created_at >= now() - interval '90 days');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Lock down execute to authenticated (each fn re-checks is_platform_admin()).
-- ---------------------------------------------------------------------------
revoke all on function public.admin_business_profile(uuid) from public;
revoke all on function public.admin_business_usage(uuid) from public;
grant execute on function public.admin_business_profile(uuid) to authenticated;
grant execute on function public.admin_business_usage(uuid) to authenticated;
