-- Account-manager name shows the wrong value. APPLIED TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- The Customers table (admin_customers_page) and the Pipeline board (admin_pipeline_board) both
-- built account_manager_name as coalesce(pm.owner_name, full_name, ...). For staff added via the
-- invite flow, iTrova's handle_new_user seeds profiles.owner_name = 'Staff' (a placeholder); the
-- real name the invitee types on /set-password lands in auth.users.raw_user_meta_data->>'full_name'
-- and never overwrites owner_name. So the placeholder won and the column showed "Staff".
--
-- This is the same fix already applied to admin_list_staff (20260627120000); these two read paths
-- were missed. Each function is reproduced verbatim from 20260625250000_role_scoped_reads.sql with
-- ONLY the account_manager_name coalesce reordered to prefer full_name (then name, then the
-- owner_name placeholder, then email).

-- 1. Customers overview table ------------------------------------------------
create or replace function public.admin_customers_page(
  p_search              text    default null,
  p_band                text    default null,
  p_plan                text    default null,
  p_subscription_status text    default null,
  p_industry            text    default null,
  p_account_manager     uuid    default null,
  p_unassigned          boolean default false,
  p_renewal_due         boolean default false,
  p_at_risk             boolean default false,
  p_active              boolean default false,
  p_new_this_month      boolean default false,
  p_renewal_days        int     default 14,
  p_sort                text    default 'health',
  p_dir                 text    default 'asc',
  p_limit               int     default 25,
  p_offset              int     default 0
)
returns table (
  business_id          uuid,
  name                 text,
  industry             text,
  plan_key             text,
  subscription_status  text,
  joined_at            timestamptz,
  products_total       bigint,
  sales_count          bigint,
  total_users          bigint,
  last_login           timestamptz,
  renewal_date         timestamptz,
  health_score         int,
  health_band          text,
  account_manager_id   uuid,
  account_manager_name text,
  owner_name           text,
  total_count          bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_dir    text := case when lower(coalesce(p_dir, 'asc')) = 'desc' then 'desc' else 'asc' end;
  v_order  text;
  v_limit  int  := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_offset int  := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_order := case lower(coalesce(p_sort, 'health'))
    when 'name'       then format('f.name %s', v_dir)
    when 'industry'   then format('f.industry %s nulls last', v_dir)
    when 'plan'       then format('f.plan_key %s nulls last', v_dir)
    when 'status'     then format('f.subscription_status %s nulls last', v_dir)
    when 'joined'     then format('f.joined_at %s nulls last', v_dir)
    when 'products'   then format('f.products_total %s', v_dir)
    when 'sales'      then format('f.sales_count %s', v_dir)
    when 'users'      then format('f.total_users %s', v_dir)
    when 'last_login' then format('f.last_login %s nulls last', v_dir)
    when 'renewal'    then format('f.renewal_date %s nulls last', v_dir)
    when 'manager'    then format('f.account_manager_name %s nulls last', v_dir)
    else format(
      '(case f.health_band when ''red'' then 0 when ''yellow'' then 1 when ''green'' then 2 else 3 end) %1$s, f.health_score %1$s nulls last',
      v_dir)
  end;

  return query execute
    $q$
      with base as (
        select
          b.id as business_id,
          b.name,
          coalesce(
            to_jsonb(b) ->> 'industry',
            to_jsonb(b) ->> 'business_type',
            to_jsonb(b) ->> 'category',
            to_jsonb(b) ->> 'sector'
          ) as industry,
          b.subscription_tier as plan_key,
          s.status::text as subscription_status,
          b.created_at as joined_at,
          coalesce(m.products_total, 0)::bigint as products_total,
          coalesce(m.sales_count, 0)::bigint as sales_count,
          coalesce(m.total_users, 0)::bigint as total_users,
          m.last_login,
          s.current_period_end as renewal_date,
          hc.score as health_score,
          hc.band as health_band,
          aa.account_manager_id,
          coalesce(
            au.raw_user_meta_data ->> 'full_name',
            au.raw_user_meta_data ->> 'name',
            pm.owner_name,
            au.email
          )::text as account_manager_name,
          (select owner_name from public.profiles where id = b.owner_id) as owner_name,
          (select email from auth.users where id = b.owner_id) as owner_email
        from public.businesses b
        left join public.mv_business_aggregates m on m.business_id = b.id
        left join public.subscriptions s on s.business_id = b.id
        left join public.cs_health_current hc on hc.business_id = b.id
        left join public.cs_account_assignment aa on aa.business_id = b.id
        left join auth.users au on au.id = aa.account_manager_id
        left join public.profiles pm on pm.id = aa.account_manager_id
        where public.cs_can_see_business(b.id)
      ),
      filtered as (
        select * from base f
        where ($1 is null or $1 = ''
               or f.name ilike '%' || $1 || '%'
               or coalesce(f.owner_name, '') ilike '%' || $1 || '%'
               or coalesce(f.owner_email, '') ilike '%' || $1 || '%')
          and ($2 is null or f.health_band = $2)
          and ($3 is null or f.plan_key = $3)
          and ($4 is null or f.subscription_status = $4)
          and ($5 is null or f.industry = $5)
          and ($6 is null or f.account_manager_id = $6)
          and (not $7 or f.account_manager_id is null)
          and (not $8 or (f.renewal_date is not null
                          and f.renewal_date >= now()
                          and f.renewal_date < now() + ($9 || ' days')::interval))
          and (not $10 or f.health_band = 'red'
               or exists (select 1 from public.cs_alert a
                           where a.business_id = f.business_id
                             and a.status in ('active', 'acknowledged')
                             and a.kind in ('churn', 'renewal')))
          and (not $11 or (f.last_login is not null and f.last_login >= now() - interval '30 days'))
          and (not $12 or f.joined_at >= date_trunc('month', now()))
      )
      select
        f.business_id, f.name, f.industry, f.plan_key, f.subscription_status, f.joined_at,
        f.products_total, f.sales_count, f.total_users, f.last_login, f.renewal_date,
        f.health_score, f.health_band, f.account_manager_id, f.account_manager_name, f.owner_name,
        count(*) over()::bigint as total_count
      from filtered f
      order by
    $q$ || v_order || $q$, f.business_id
      limit $q$ || v_limit::text || $q$ offset $q$ || v_offset::text
  using
    p_search, p_band, p_plan, p_subscription_status, p_industry, p_account_manager,
    p_unassigned, p_renewal_due, p_renewal_days, p_at_risk, p_active, p_new_this_month;
end $$;

-- 2. Pipeline board ----------------------------------------------------------
create or replace function public.admin_pipeline_board()
returns table (
  business_id          uuid,
  name                 text,
  stage                text,
  stage_source         text,
  health_band          text,
  health_score         int,
  renewal_date         timestamptz,
  account_manager_id   uuid,
  account_manager_name text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select
    b.id,
    b.name,
    coalesce(p.stage, public.cs_auto_stage(b.id)),
    coalesce(p.stage_source, 'auto'),
    h.band,
    h.score,
    s.current_period_end,
    aa.account_manager_id,
    coalesce(
      au.raw_user_meta_data ->> 'full_name',
      au.raw_user_meta_data ->> 'name',
      pm.owner_name,
      au.email
    )::text
  from public.businesses b
  left join public.cs_pipeline p on p.business_id = b.id
  left join public.cs_health_current h on h.business_id = b.id
  left join public.subscriptions s on s.business_id = b.id
  left join public.cs_account_assignment aa on aa.business_id = b.id
  left join auth.users au on au.id = aa.account_manager_id
  left join public.profiles pm on pm.id = aa.account_manager_id
  where public.cs_can_see_business(b.id)
  order by b.name;
end $$;
