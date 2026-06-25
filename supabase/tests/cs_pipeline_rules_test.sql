-- Pipeline stage-rule tests (PRD §7.6). Run in the Supabase SQL editor or via psql AFTER
-- applying 20260625210000_cs_pipeline_rules_align.sql. Exercises the pure cs_pipeline_stage()
-- with crafted inputs (no fixtures); raises on mismatch, NOTICE per pass.
--
-- cs_pipeline_stage(created, products, sales, last_login, active_users, purchase_orders,
--                   sub_status, sub_started, sub_cycle, now) -> stage text

do $$
declare g text;
begin
  -- Churned: subscription cancelled.
  g := public.cs_pipeline_stage(now()-interval '200 days', 5, 10, now()-interval '2 days', 2, 3, 'canceled', now()-interval '200 days', 'month', now());
  assert g = 'churned', format('expected churned (cancelled), got %s', g);

  -- Churned: not paying (trial) AND no login for 40d, account old enough.
  g := public.cs_pipeline_stage(now()-interval '90 days', 3, 0, now()-interval '40 days', 1, 0, 'trialing', now()-interval '90 days', 'month', now());
  assert g = 'churned', format('expected churned (dormant non-paying), got %s', g);

  -- NOT churned: a brand-new trial with no login yet is onboarding, not churned.
  g := public.cs_pipeline_stage(now()-interval '2 days', 0, 0, null, 0, 0, 'trialing', now()-interval '2 days', 'month', now());
  assert g = 'onboarding', format('expected onboarding (fresh trial), got %s', g);

  -- Renewed: active subscription past one monthly cycle.
  g := public.cs_pipeline_stage(now()-interval '400 days', 8, 30, now()-interval '2 days', 3, 5, 'active', now()-interval '400 days', 'month', now());
  assert g = 'renewed', format('expected renewed, got %s', g);

  -- Power User: sustained usage, within the first cycle (so not "renewed").
  g := public.cs_pipeline_stage(now()-interval '10 days', 6, 4, now()-interval '1 day', 2, 2, 'active', now()-interval '10 days', 'month', now());
  assert g = 'power_user', format('expected power_user, got %s', g);

  -- Active: products + sales + recent login, but not sustained (1 user, no POs), first cycle.
  g := public.cs_pipeline_stage(now()-interval '10 days', 5, 3, now()-interval '3 days', 1, 0, 'active', now()-interval '10 days', 'month', now());
  assert g = 'active', format('expected active, got %s', g);

  -- Onboarding: subscribed but no sales yet.
  g := public.cs_pipeline_stage(now()-interval '5 days', 4, 0, now()-interval '1 day', 1, 0, 'trialing', now()-interval '5 days', 'month', now());
  assert g = 'onboarding', format('expected onboarding (no sales), got %s', g);

  -- Subscribed: past_due (has a sub) with no engagement match.
  g := public.cs_pipeline_stage(now()-interval '5 days', 0, 0, now()-interval '1 day', 0, 0, 'past_due', now()-interval '5 days', 'month', now());
  assert g = 'subscribed', format('expected subscribed (past_due), got %s', g);

  -- Registered: account exists, no subscription.
  g := public.cs_pipeline_stage(now()-interval '5 days', 0, 0, now()-interval '1 day', 0, 0, null, null, null, now());
  assert g = 'registered', format('expected registered, got %s', g);

  raise notice 'All pipeline stage-rule test cases passed.';
end $$;
