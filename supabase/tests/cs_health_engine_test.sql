-- Health-engine banding tests (PRD §7.3). Run in the Supabase SQL editor or via psql AFTER
-- applying 20260625150000_cs_health_engine.sql. Exercises the pure scorer cs_score() with
-- crafted inputs (no fixtures needed); raises an exception on any mismatch and a NOTICE per
-- pass. Assumes default thresholds in cs_settings.
--
-- cs_score(last_login, products_total, products_recent, last_sale, active_users,
--          sub_status, period_end, now)

do $$
declare b text; sc int;
begin
  -- Healthy: login 2d, products (recent), sale 3d, 3 users, active sub renewing in 60d -> green (score 100)
  select band, score into b, sc from public.cs_score(
    now()-interval '2 days', 10, 3, now()-interval '3 days', 3, 'active', now()+interval '60 days', now());
  assert b = 'green', format('healthy: expected green, got %s (score %s)', b, sc);
  raise notice 'healthy                -> % (score %)', b, sc;

  -- Warning: otherwise healthy but last sale 20d ago (>14d warning) -> yellow despite score >=70
  select band, score into b, sc from public.cs_score(
    now()-interval '2 days', 10, 3, now()-interval '20 days', 3, 'active', now()+interval '60 days', now());
  assert b = 'yellow', format('warning: expected yellow, got %s (score %s)', b, sc);
  raise notice 'warning (no sales 14d)  -> % (score %)', b, sc;

  -- Red trip-wire #1: no login in 30 days (40d) -> red despite a high score
  select band, score into b, sc from public.cs_score(
    now()-interval '40 days', 10, 3, now()-interval '3 days', 3, 'active', now()+interval '60 days', now());
  assert b = 'red', format('trip-wire no-login: expected red, got %s (score %s)', b, sc);
  raise notice 'trip-wire no-login 30d  -> % (score %)', b, sc;

  -- Red trip-wire #2: no inventory ever -> red
  select band, score into b, sc from public.cs_score(
    now()-interval '2 days', 0, 0, now()-interval '3 days', 3, 'active', now()+interval '60 days', now());
  assert b = 'red', format('trip-wire no-inventory: expected red, got %s (score %s)', b, sc);
  raise notice 'trip-wire no-inventory  -> % (score %)', b, sc;

  -- Red trip-wire #3: no sales ever -> red
  select band, score into b, sc from public.cs_score(
    now()-interval '2 days', 10, 3, null, 3, 'active', now()+interval '60 days', now());
  assert b = 'red', format('trip-wire no-sales: expected red, got %s (score %s)', b, sc);
  raise notice 'trip-wire no-sales ever -> % (score %)', b, sc;

  raise notice 'All health banding test cases passed.';
end $$;
