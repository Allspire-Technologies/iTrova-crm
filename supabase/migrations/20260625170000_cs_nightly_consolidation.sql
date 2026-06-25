-- Run the health snapshot and the alert evaluation in a SINGLE nightly job. APPLIED TO THE
-- SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu). PRD §7.5 asks alerts to evaluate on the same
-- nightly job as health; the earlier migrations scheduled two separate crons — replace them
-- with one. Also adds a Home-friendly view of open alerts with the business name.

create or replace function public.cs_nightly()
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.cs_snapshot_all();    -- health snapshots
  perform public.cs_eval_alerts_all(); -- workflow alerts
end $$;
revoke all on function public.cs_nightly() from public;

-- Replace the two separate jobs with one combined nightly job at 02:00 UTC.
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('cs_health_nightly'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('cs_alerts_nightly'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('cs_nightly');        exception when others then null; end $$;
select cron.schedule('cs_nightly', '0 2 * * *', $cron$select public.cs_nightly()$cron$);

-- Open alerts (active or acknowledged) with the business name, criticals first — for the
-- Home at-risk list. security_invoker so the staff-only RLS on cs_alert / businesses applies.
create or replace view public.cs_alert_active with (security_invoker = true) as
select a.id, a.business_id, b.name as business_name, a.kind, a.severity, a.detail,
       a.status, a.acknowledged_by, a.created_at, a.updated_at, a.resolved_at
from public.cs_alert a
join public.businesses b on b.id = a.business_id
where a.status <> 'resolved'
order by (a.severity = 'critical') desc, a.created_at desc;
grant select on public.cs_alert_active to authenticated;
