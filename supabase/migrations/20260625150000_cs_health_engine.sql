-- Customer Health Engine. APPLIED TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
-- PRD §7.3. Computes a 0–100 score per business (login 25 / inventory 20 / sales 30 /
-- adoption 15 / renewal 10), bands it Green/Yellow/Red with hard trip-wires, records a
-- reasons[] of which rules fired, snapshots into cs_health_snapshot (nightly + on demand),
-- and exposes the current band via a view. Thresholds live in cs_settings (tunable, no deploy).
-- Depends on cs_health_snapshot + cs_set_updated_at from 20260625140000_cs_tables.sql.

-- ---------------------------------------------------------------------------
-- Tunable thresholds (single row). Edit in place to retune without a deploy.
-- ---------------------------------------------------------------------------
create table if not exists public.cs_settings (
  singleton             boolean primary key default true check (singleton),
  login_green_days      int not null default 7,
  login_yellow_days     int not null default 14,
  login_red_days        int not null default 30,
  sales_green_days      int not null default 7,
  sales_mid_days        int not null default 14,
  sales_window_days     int not null default 30,
  products_stale_days   int not null default 30,
  adoption_active_days  int not null default 14,
  renewal_healthy_days  int not null default 30,
  renewal_window_days   int not null default 14,
  band_green_min        int not null default 70,
  band_yellow_min       int not null default 40,
  warning_no_sales_days int not null default 14,
  updated_at            timestamptz not null default now()
);
insert into public.cs_settings (singleton) values (true) on conflict (singleton) do nothing;

alter table public.cs_settings enable row level security;
drop policy if exists "staff full access" on public.cs_settings;
create policy "staff full access" on public.cs_settings for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
revoke all on public.cs_settings from anon;
grant select, insert, update on public.cs_settings to authenticated;

drop trigger if exists set_updated_at on public.cs_settings;
create trigger set_updated_at before update on public.cs_settings
  for each row execute function public.cs_set_updated_at();

create or replace function public.cs_get_settings()
returns public.cs_settings
language sql stable security definer set search_path = public as $$
  select * from public.cs_settings order by singleton limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Pure scorer: inputs in, (score, band, reasons) out. Reads thresholds from
-- cs_settings, so it's directly unit-testable with crafted inputs (see tests/).
-- ---------------------------------------------------------------------------
create or replace function public.cs_score(
  p_last_login     timestamptz,
  p_products_total int,
  p_products_recent int,
  p_last_sale      timestamptz,
  p_active_users   int,
  p_sub_status     text,
  p_period_end     timestamptz,
  p_now            timestamptz default now()
)
returns table(score int, band text, reasons jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  s public.cs_settings;
  v_login_days numeric;
  v_sale_days  numeric;
  pts_login int := 0; pts_inv int := 0; pts_sales int := 0; pts_adopt int := 0; pts_renew int := 0;
  v_score int; v_band text;
  reasons jsonb; trips jsonb := '[]'::jsonb;
  warn boolean := false; redtrip boolean := false;
begin
  s := public.cs_get_settings();

  if p_last_login is not null then v_login_days := extract(epoch from (p_now - p_last_login)) / 86400; end if;
  if p_last_sale  is not null then v_sale_days  := extract(epoch from (p_now - p_last_sale))  / 86400; end if;

  -- Login recency (max 25)
  if v_login_days is null then pts_login := 0;
  elsif v_login_days <= s.login_green_days  then pts_login := 25;
  elsif v_login_days <= s.login_yellow_days then pts_login := 18;
  elsif v_login_days <= s.login_red_days    then pts_login := 10;
  else pts_login := 0; end if;

  -- Inventory setup (max 20): added recently / stale / none
  if coalesce(p_products_total, 0) = 0       then pts_inv := 0;
  elsif coalesce(p_products_recent, 0) > 0   then pts_inv := 20;
  else pts_inv := 10; end if;

  -- Sales activity (max 30)
  if v_sale_days is null then pts_sales := 0;
  elsif v_sale_days <= s.sales_green_days  then pts_sales := 30;
  elsif v_sale_days <= s.sales_mid_days    then pts_sales := 22;
  elsif v_sale_days <= s.sales_window_days then pts_sales := 12;
  else pts_sales := 0; end if;

  -- User adoption (max 15)
  if coalesce(p_active_users, 0) >= 2 then pts_adopt := 15;
  elsif coalesce(p_active_users, 0) = 1 then pts_adopt := 8;
  else pts_adopt := 0; end if;

  -- Renewal posture (max 10)
  if p_sub_status in ('past_due','expired','canceled')
     or (p_period_end is not null and p_period_end < p_now) then pts_renew := 0;
  elsif p_sub_status = 'trialing' then pts_renew := 6;
  elsif p_sub_status = 'active' then
    if p_period_end is null or p_period_end > p_now + make_interval(days => s.renewal_healthy_days) then pts_renew := 10;
    elsif p_period_end <= p_now + make_interval(days => s.renewal_window_days) then pts_renew := 3;
    else pts_renew := 6; end if;
  else pts_renew := 0; end if;

  v_score := pts_login + pts_inv + pts_sales + pts_adopt + pts_renew;

  reasons := jsonb_build_array(
    jsonb_build_object('rule','login_recency',  'points',pts_login, 'days', round(v_login_days, 1)),
    jsonb_build_object('rule','inventory_setup','points',pts_inv,   'products', coalesce(p_products_total,0)),
    jsonb_build_object('rule','sales_activity', 'points',pts_sales, 'days', round(v_sale_days, 1)),
    jsonb_build_object('rule','user_adoption',  'points',pts_adopt, 'active_users', coalesce(p_active_users,0)),
    jsonb_build_object('rule','renewal_posture','points',pts_renew, 'status', p_sub_status)
  );

  -- Hard red trip-wires
  if v_login_days is null or v_login_days > s.login_red_days then
    redtrip := true; trips := trips || jsonb_build_object('rule','trip_wire','detail','no login in ' || s.login_red_days::text || ' days'); end if;
  if coalesce(p_products_total,0) = 0 then
    redtrip := true; trips := trips || jsonb_build_object('rule','trip_wire','detail','no inventory ever added'); end if;
  if p_last_sale is null then
    redtrip := true; trips := trips || jsonb_build_object('rule','trip_wire','detail','no sales ever recorded'); end if;

  -- Warning conditions (downgrade an otherwise-green to yellow)
  if v_sale_days is null or v_sale_days > s.warning_no_sales_days then
    warn := true; trips := trips || jsonb_build_object('rule','warning','detail','no sales in ' || s.warning_no_sales_days::text || ' days'); end if;
  if coalesce(p_active_users,0) = 0 then
    warn := true; trips := trips || jsonb_build_object('rule','warning','detail','no active users'); end if;

  reasons := reasons || trips;

  if redtrip or v_score < s.band_yellow_min then v_band := 'red';
  elsif v_score >= s.band_green_min and not warn then v_band := 'green';
  else v_band := 'yellow'; end if;

  return query select v_score, v_band, reasons;
end $$;

-- ---------------------------------------------------------------------------
-- Gather one business's inputs from the real iTrova tables, then score.
-- ---------------------------------------------------------------------------
create or replace function public.cs_compute_health(p_business_id uuid)
returns table(score int, band text, reasons jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  s public.cs_settings := public.cs_get_settings();
  v_last_login timestamptz; v_products_total int; v_products_recent int;
  v_last_sale timestamptz; v_active_users int; v_sub_status text; v_period_end timestamptz;
begin
  select max(u.last_sign_in_at) into v_last_login
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
-- Snapshot writers: one business (staff-gated RPC) and all (nightly cron).
-- ---------------------------------------------------------------------------
create or replace function public.cs_recompute_business(p_business_id uuid)
returns public.cs_health_snapshot
language plpgsql security definer set search_path = public as $$
declare r record; snap public.cs_health_snapshot;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into r from public.cs_compute_health(p_business_id);
  insert into public.cs_health_snapshot (business_id, score, band, reasons, captured_at)
    values (p_business_id, r.score, r.band, r.reasons, now())
    returning * into snap;
  return snap;
end $$;

create or replace function public.cs_snapshot_all()
returns int
language plpgsql security definer set search_path = public as $$
declare b record; r record; n int := 0;
begin
  for b in select id from public.businesses loop
    select * into r from public.cs_compute_health(b.id);
    insert into public.cs_health_snapshot (business_id, score, band, reasons, captured_at)
      values (b.id, r.score, r.band, r.reasons, now());
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Current band per business (latest snapshot) for the overview table.
-- security_invoker so the staff-only RLS on cs_health_snapshot applies to the caller.
-- ---------------------------------------------------------------------------
create or replace view public.cs_health_current with (security_invoker = true) as
select distinct on (business_id)
  business_id, score, band, reasons, captured_at
from public.cs_health_snapshot
order by business_id, captured_at desc;
grant select on public.cs_health_current to authenticated;

-- ---------------------------------------------------------------------------
-- Lock down execute. Only the on-demand RPC is callable by the app; the rest
-- are internal (cron runs as the table owner).
-- ---------------------------------------------------------------------------
revoke all on function public.cs_get_settings() from public;
revoke all on function public.cs_score(timestamptz,int,int,timestamptz,int,text,timestamptz,timestamptz) from public;
revoke all on function public.cs_compute_health(uuid) from public;
revoke all on function public.cs_snapshot_all() from public;
revoke all on function public.cs_recompute_business(uuid) from public;
grant execute on function public.cs_recompute_business(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Nightly snapshot at 02:00 UTC + an immediate seed so the view has data now.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;
do $$ begin
  perform cron.unschedule('cs_health_nightly');
exception when others then null; end $$;
select cron.schedule('cs_health_nightly', '0 2 * * *', $cron$select public.cs_snapshot_all()$cron$);

select public.cs_snapshot_all();
