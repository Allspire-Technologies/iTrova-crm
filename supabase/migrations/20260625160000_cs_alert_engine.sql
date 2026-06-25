-- Customer Success Workflow / alert engine. APPLIED TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
-- PRD §7.5. Evaluates four rules per business and maintains rows in cs_alert:
--   Onboarding (warning)  business created & no products after N days
--   Adoption   (warning)  products added & no sales after N days
--   Churn      (critical) no login for N days
--   Renewal    (warning→critical) subscription expires within N days (critical at <= M days)
-- One open alert per (business, kind); when a condition clears, the open alert is resolved.
-- Daily cron + on-demand staff RPC. Depends on cs_alert + cs_settings + cs_get_settings.

-- ---------------------------------------------------------------------------
-- Tunable alert thresholds (extend cs_settings).
-- ---------------------------------------------------------------------------
alter table public.cs_settings
  add column if not exists alert_onboarding_days       int not null default 3,
  add column if not exists alert_adoption_days         int not null default 7,
  add column if not exists alert_churn_days            int not null default 30,
  add column if not exists alert_renewal_warn_days     int not null default 14,
  add column if not exists alert_renewal_critical_days int not null default 3;

-- One non-resolved alert per (business, kind).
create unique index if not exists cs_alert_one_open_per_kind
  on public.cs_alert (business_id, kind) where status <> 'resolved';

-- ---------------------------------------------------------------------------
-- Pure rule evaluator: inputs in, one row per kind out (active/severity/detail).
-- Directly unit-testable with crafted inputs (see tests/).
-- ---------------------------------------------------------------------------
create or replace function public.cs_alert_rules(
  p_created       timestamptz,
  p_products      int,
  p_first_product timestamptz,
  p_last_sale     timestamptz,
  p_last_login    timestamptz,
  p_sub_status    text,
  p_period_end    timestamptz,
  p_now           timestamptz default now()
)
returns table(kind text, active boolean, severity text, detail text)
language plpgsql stable security definer set search_path = public as $$
declare s public.cs_settings := public.cs_get_settings();
begin
  -- Onboarding risk
  kind := 'onboarding';
  active := (p_now - p_created >= make_interval(days => s.alert_onboarding_days)) and coalesce(p_products,0) = 0;
  severity := 'warning';
  detail := format('no products added %s days after signup', s.alert_onboarding_days);
  return next;

  -- Adoption risk
  kind := 'adoption';
  active := coalesce(p_products,0) > 0 and p_first_product is not null
            and (p_now - p_first_product >= make_interval(days => s.alert_adoption_days))
            and p_last_sale is null;
  severity := 'warning';
  detail := format('products added but no sales after %s days', s.alert_adoption_days);
  return next;

  -- Churn risk
  kind := 'churn';
  active := p_last_login is null or (p_now - p_last_login >= make_interval(days => s.alert_churn_days));
  severity := 'critical';
  detail := format('no login for %s days', s.alert_churn_days);
  return next;

  -- Renewal risk (warning, escalates to critical near the date)
  kind := 'renewal';
  if p_sub_status in ('active','trialing') and p_period_end is not null
     and p_period_end > p_now and p_period_end <= p_now + make_interval(days => s.alert_renewal_warn_days) then
    active := true;
    if p_period_end <= p_now + make_interval(days => s.alert_renewal_critical_days)
      then severity := 'critical'; else severity := 'warning'; end if;
    detail := format('subscription renews in %s days', ceil(extract(epoch from (p_period_end - p_now)) / 86400));
  else
    active := false; severity := 'warning'; detail := 'renewal not due';
  end if;
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- Apply one rule outcome to cs_alert: open if newly active, update severity/detail
-- if it changed (e.g. renewal escalation), resolve the open alert if the condition cleared.
-- ---------------------------------------------------------------------------
create or replace function public.cs_apply_alert(
  p_business_id uuid, p_kind text, p_active boolean, p_severity text, p_detail text)
returns void language plpgsql security definer set search_path = public as $$
declare existing public.cs_alert;
begin
  select * into existing from public.cs_alert
    where business_id = p_business_id and kind = p_kind and status <> 'resolved'
    order by created_at desc limit 1;

  if p_active then
    if existing.id is null then
      insert into public.cs_alert (business_id, kind, severity, detail, status)
        values (p_business_id, p_kind, p_severity, p_detail, 'active');
    elsif existing.severity is distinct from p_severity or existing.detail is distinct from p_detail then
      update public.cs_alert set severity = p_severity, detail = p_detail, updated_at = now()
        where id = existing.id;   -- keep status (active/acknowledged) as-is
    end if;
  elsif existing.id is not null then
    update public.cs_alert set status = 'resolved', resolved_at = now(), updated_at = now()
      where id = existing.id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Evaluate all rules for one business; for all businesses (cron).
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
  select max(u.last_sign_in_at) into v_last_login
    from public.profiles p join auth.users u on u.id = p.id where p.business_id = p_business_id;
  select status::text, current_period_end into v_sub_status, v_period_end
    from public.subscriptions where business_id = p_business_id order by started_at desc limit 1;

  for r in select * from public.cs_alert_rules(
    v_created, v_products, v_first_product, v_last_sale, v_last_login, v_sub_status, v_period_end, now())
  loop
    perform public.cs_apply_alert(p_business_id, r.kind, r.active, r.severity, r.detail);
  end loop;
end $$;

create or replace function public.cs_eval_alerts_all()
returns int language plpgsql security definer set search_path = public as $$
declare b record; n int := 0;
begin
  for b in select id from public.businesses loop
    perform public.cs_eval_alerts(b.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- On-demand staff RPC: re-evaluate one business, return its open alerts.
-- ---------------------------------------------------------------------------
create or replace function public.cs_recompute_alerts_business(p_business_id uuid)
returns setof public.cs_alert
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform public.cs_eval_alerts(p_business_id);
  return query
    select * from public.cs_alert
    where business_id = p_business_id and status <> 'resolved'
    order by (severity = 'critical') desc, created_at desc;
end $$;

-- ---------------------------------------------------------------------------
-- Lock down execute (internal vs app-callable).
-- ---------------------------------------------------------------------------
revoke all on function public.cs_alert_rules(timestamptz,int,timestamptz,timestamptz,timestamptz,text,timestamptz,timestamptz) from public;
revoke all on function public.cs_apply_alert(uuid,text,boolean,text,text) from public;
revoke all on function public.cs_eval_alerts(uuid) from public;
revoke all on function public.cs_eval_alerts_all() from public;
revoke all on function public.cs_recompute_alerts_business(uuid) from public;
grant execute on function public.cs_recompute_alerts_business(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Daily evaluation at 02:15 UTC (after the health snapshot) + immediate seed.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;
do $$ begin
  perform cron.unschedule('cs_alerts_nightly');
exception when others then null; end $$;
select cron.schedule('cs_alerts_nightly', '15 2 * * *', $cron$select public.cs_eval_alerts_all()$cron$);

select public.cs_eval_alerts_all();
