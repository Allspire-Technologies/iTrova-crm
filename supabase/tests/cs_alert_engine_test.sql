-- Alert-engine rule tests (PRD §7.5). Run in the Supabase SQL editor or via psql AFTER
-- applying 20260625160000_cs_alert_engine.sql. Exercises the pure cs_alert_rules() with
-- crafted inputs (no fixtures); raises on mismatch, NOTICE per pass. Default thresholds.
--
-- cs_alert_rules(created, products, first_product, last_sale, last_login,
--                sub_status, period_end, now) -> (kind, active, severity, detail)

do $$
declare a boolean; sv text;
begin
  -- Onboarding fires: signed up 5d ago, still no products
  select active, severity into a, sv from public.cs_alert_rules(
    now()-interval '5 days', 0, null, null, now()-interval '1 day', 'trialing', now()+interval '60 days') where kind='onboarding';
  assert a, 'onboarding should fire (5d, no products)';
  raise notice 'onboarding fires      -> active=% severity=%', a, sv;

  -- Onboarding clears once products exist
  select active into a from public.cs_alert_rules(
    now()-interval '5 days', 4, now()-interval '4 days', null, now()-interval '1 day', 'trialing', now()+interval '60 days') where kind='onboarding';
  assert not a, 'onboarding should clear when products exist';

  -- Adoption fires (warning): products added 10d ago, no sales
  select active, severity into a, sv from public.cs_alert_rules(
    now()-interval '30 days', 4, now()-interval '10 days', null, now()-interval '1 day', 'active', now()+interval '60 days') where kind='adoption';
  assert a and sv='warning', 'adoption should fire warning';
  raise notice 'adoption fires        -> active=% severity=%', a, sv;

  -- Churn fires (critical): no login for 40d
  select active, severity into a, sv from public.cs_alert_rules(
    now()-interval '90 days', 5, now()-interval '60 days', now()-interval '2 days', now()-interval '40 days', 'active', now()+interval '60 days') where kind='churn';
  assert a and sv='critical', 'churn should fire critical';
  raise notice 'churn fires           -> active=% severity=%', a, sv;

  -- Renewal warning: expires in 10 days
  select active, severity into a, sv from public.cs_alert_rules(
    now()-interval '300 days', 5, now()-interval '250 days', now()-interval '1 day', now()-interval '1 day', 'active', now()+interval '10 days') where kind='renewal';
  assert a and sv='warning', 'renewal should fire warning at 10d';
  raise notice 'renewal warning (10d) -> active=% severity=%', a, sv;

  -- Renewal critical: expires in 2 days
  select active, severity into a, sv from public.cs_alert_rules(
    now()-interval '300 days', 5, now()-interval '250 days', now()-interval '1 day', now()-interval '1 day', 'active', now()+interval '2 days') where kind='renewal';
  assert a and sv='critical', 'renewal should escalate to critical at 2d';
  raise notice 'renewal critical (2d) -> active=% severity=%', a, sv;

  -- Healthy business: nothing fires
  perform 1;
  assert not (select active from public.cs_alert_rules(now()-interval '120 days', 8, now()-interval '90 days', now()-interval '2 days', now()-interval '1 day', 'active', now()+interval '90 days') where kind='onboarding'), 'healthy: onboarding must not fire';
  assert not (select active from public.cs_alert_rules(now()-interval '120 days', 8, now()-interval '90 days', now()-interval '2 days', now()-interval '1 day', 'active', now()+interval '90 days') where kind='adoption'),   'healthy: adoption must not fire';
  assert not (select active from public.cs_alert_rules(now()-interval '120 days', 8, now()-interval '90 days', now()-interval '2 days', now()-interval '1 day', 'active', now()+interval '90 days') where kind='churn'),      'healthy: churn must not fire';
  assert not (select active from public.cs_alert_rules(now()-interval '120 days', 8, now()-interval '90 days', now()-interval '2 days', now()-interval '1 day', 'active', now()+interval '90 days') where kind='renewal'),    'healthy: renewal must not fire';
  raise notice 'healthy business      -> no alerts fire';

  raise notice 'All alert-engine rule test cases passed.';
end $$;
