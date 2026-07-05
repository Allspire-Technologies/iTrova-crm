-- Billing-cycle normalization tests. Run in the Supabase SQL editor or via psql AFTER applying
-- 20260705150000_cycle_normalization.sql. Exercises the pure cs_cycle_months(cycle) and the
-- cycle-aware "renewed" boundary in cs_pipeline_stage(); raises on mismatch, NOTICE per pass.

do $$
declare stage text;
begin
  -- cs_cycle_months: real iTrova vocabulary.
  assert public.cs_cycle_months('monthly')   = 1,  'monthly = 1 month';
  assert public.cs_cycle_months('quarterly') = 3,  'quarterly = 3 months';
  assert public.cs_cycle_months('biannual')  = 6,  'biannual = 6 months';
  assert public.cs_cycle_months('annual')    = 12, 'annual = 12 months';
  -- Legacy vocabulary + robustness.
  assert public.cs_cycle_months('month')     = 1,  'legacy month = 1';
  assert public.cs_cycle_months('year')      = 12, 'legacy year = 12';
  assert public.cs_cycle_months('ANNUAL')    = 12, 'case-insensitive';
  assert public.cs_cycle_months(null)        = 1,  'null → monthly (never inflate)';
  assert public.cs_cycle_months('weird')     = 1,  'unknown → monthly (never inflate)';

  -- cs_pipeline_stage "renewed" boundary = one full billing period.
  -- Quarterly, 2 months in → NOT renewed (was: renewed after 30 days under the old 30d default).
  stage := public.cs_pipeline_stage(
    now() - interval '4 months',  -- created
    5, 10,                        -- products, sales
    now() - interval '1 day',     -- last_login
    1, 0,                         -- active_users, purchase_orders
    'active', now() - interval '2 months', 'quarterly',
    now());
  assert stage <> 'renewed', format('quarterly at 2 months is not renewed (got %s)', stage);

  -- Quarterly, 4 months in → renewed.
  stage := public.cs_pipeline_stage(
    now() - interval '6 months', 5, 10, now() - interval '1 day', 1, 0,
    'active', now() - interval '4 months', 'quarterly', now());
  assert stage = 'renewed', format('quarterly at 4 months is renewed (got %s)', stage);

  -- Annual, 6 months in → NOT renewed (was: "annual" fell into the 30-day else-branch).
  stage := public.cs_pipeline_stage(
    now() - interval '8 months', 5, 10, now() - interval '1 day', 1, 0,
    'active', now() - interval '6 months', 'annual', now());
  assert stage <> 'renewed', format('annual at 6 months is not renewed (got %s)', stage);

  -- Annual, 13 months in → renewed.
  stage := public.cs_pipeline_stage(
    now() - interval '14 months', 5, 10, now() - interval '1 day', 1, 0,
    'active', now() - interval '13 months', 'annual', now());
  assert stage = 'renewed', format('annual at 13 months is renewed (got %s)', stage);

  -- Monthly, 2 months in → renewed (unchanged behaviour).
  stage := public.cs_pipeline_stage(
    now() - interval '3 months', 5, 10, now() - interval '1 day', 1, 0,
    'active', now() - interval '2 months', 'monthly', now());
  assert stage = 'renewed', format('monthly at 2 months is renewed (got %s)', stage);

  raise notice 'All cycle-normalization test cases passed.';
end $$;
