-- Health-band trend for the Dashboard Home chart (PRD §7.4/§9 "trends"). APPLIED TO THE SHARED
-- iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- Staff-gated daily series from cs_health_snapshot history: the at-risk (red) / yellow / green
-- counts per day, using the LAST snapshot per business per day (on-demand recomputes can write
-- several rows in a day; we want the day's final band). One round-trip, precomputed from the
-- existing snapshot table — no new storage.

create or replace function public.admin_health_trend(p_days int default 30)
returns table (day date, at_risk bigint, yellow bigint, green bigint, total bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  with daily as (
    select distinct on (s.business_id, s.captured_at::date)
      s.business_id, s.captured_at::date as d, s.band
    from public.cs_health_snapshot s
    where s.captured_at >= now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
    order by s.business_id, s.captured_at::date, s.captured_at desc
  )
  select
    d as day,
    count(*) filter (where band = 'red')    as at_risk,
    count(*) filter (where band = 'yellow') as yellow,
    count(*) filter (where band = 'green')  as green,
    count(*)                                 as total
  from daily
  group by d
  order by d;
end $$;

revoke all on function public.admin_health_trend(int) from public;
grant execute on function public.admin_health_trend(int) to authenticated;
