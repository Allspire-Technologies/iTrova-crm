-- Customer Success Pipeline auto-derivation + board (PRD §7.6). APPLIED TO THE SHARED iTrova
-- PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- The 8 lifecycle stages (lead → registered → subscribed → onboarding → active → power_user →
-- renewed → churned) are auto-derived nightly into cs_pipeline with stage_source='auto'. A
-- manual move (set by the board UI with stage_source='manual') is NEVER overwritten by the auto
-- job. The board reads everything it needs through one staff-gated SECURITY DEFINER RPC.
--
-- The thresholds below are a pragmatic encoding of the PRD funnel and are intentionally easy to
-- tune in one place (cs_auto_stage). Precedence is by funnel position — the furthest-along /
-- terminal stage that matches wins (churned first, then renewed, …).

-- ---------------------------------------------------------------------------
-- 1. Stage rule. Plain (non-definer) function: it only reads, and its callers
--    (the nightly derive + the board RPC) already run with the needed privileges.
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
  ),
  h as (
    select * from public.cs_health_current where business_id = p_business_id
  )
  select case
    -- Terminal: cancelled/expired, or long-dormant with no subscription.
    when (select status from s) in ('canceled', 'expired') then 'churned'
    when (select status from s) is null
         and (select created_at from b) < now() - interval '60 days'
         and coalesce((select last_login from m), 'epoch'::timestamptz) < now() - interval '60 days'
      then 'churned'
    -- Active subscriber who has passed at least one renewal boundary.
    when (select status from s) = 'active'
         and (select started_at from s) is not null
         and now() >= (select started_at from s)
                      + (case when (select cycle from s) = 'year' then interval '365 days' else interval '30 days' end)
      then 'renewed'
    -- Highly engaged: green health, multiple active users, logged in this week.
    when (select status from s) in ('active', 'trialing')
         and (select band from h) = 'green'
         and coalesce((select active_users from m), 0) >= 2
         and coalesce((select last_login from m), 'epoch'::timestamptz) >= now() - interval '7 days'
      then 'power_user'
    -- Using the product: logged in recently and has recorded sales.
    when (select status from s) in ('active', 'trialing')
         and coalesce((select last_login from m), 'epoch'::timestamptz) >= now() - interval '30 days'
         and coalesce((select sales_count from m), 0) > 0
      then 'active'
    -- Recently subscribed or not yet productive.
    when (select status from s) in ('active', 'trialing')
         and ((select created_at from b) >= now() - interval '14 days'
              or coalesce((select sales_count from m), 0) = 0)
      then 'onboarding'
    -- Has a (non-terminal) subscription but none of the engagement above.
    when (select status from s) is not null then 'subscribed'
    -- Registered account, no subscription yet.
    when (select owner_id from b) is not null then 'registered'
    else 'lead'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Nightly auto-derivation. Upsert every business's stage, but the
--    `where stage_source = 'auto'` guard means a manual stage is left intact.
-- ---------------------------------------------------------------------------
create or replace function public.cs_derive_pipeline()
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.cs_pipeline (business_id, stage, stage_source)
  select b.id, public.cs_auto_stage(b.id), 'auto'
  from public.businesses b
  on conflict (business_id) do update
    set stage = excluded.stage,
        stage_source = 'auto',
        updated_at = now()
    where public.cs_pipeline.stage_source = 'auto';
end $$;
revoke all on function public.cs_derive_pipeline() from public;

-- ---------------------------------------------------------------------------
-- 3. Fold pipeline derivation into the single nightly job (health + alerts + pipeline).
-- ---------------------------------------------------------------------------
create or replace function public.cs_nightly()
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.cs_snapshot_all();    -- health snapshots
  perform public.cs_eval_alerts_all(); -- workflow alerts
  perform public.cs_derive_pipeline(); -- pipeline stages (manual moves preserved)
end $$;
revoke all on function public.cs_nightly() from public;

-- ---------------------------------------------------------------------------
-- 4. Board data: one staff-gated row per business with everything a card needs.
--    Falls back to the live auto stage for any business without a row yet.
-- ---------------------------------------------------------------------------
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
      pm.owner_name,
      au.raw_user_meta_data ->> 'full_name',
      au.raw_user_meta_data ->> 'name',
      au.email
    )::text
  from public.businesses b
  left join public.cs_pipeline p on p.business_id = b.id
  left join public.cs_health_current h on h.business_id = b.id
  left join public.subscriptions s on s.business_id = b.id
  left join public.cs_account_assignment aa on aa.business_id = b.id
  left join auth.users au on au.id = aa.account_manager_id
  left join public.profiles pm on pm.id = aa.account_manager_id
  order by b.name;
end $$;
revoke all on function public.admin_pipeline_board() from public;
grant execute on function public.admin_pipeline_board() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Backfill once so the board is populated before the first nightly run.
-- ---------------------------------------------------------------------------
select public.cs_derive_pipeline();
