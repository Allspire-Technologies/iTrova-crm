-- Sync renewal date (and the rest of the subscription) from iTrova's businesses row.
-- APPLIED TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- Why: the Admin OS reads renewal from subscriptions.current_period_end (every customer RPC, plus
-- the health/alert/pipeline engines key off it). But iTrova stores the real renewal in
-- businesses.subscription_renews_at (derived by its own trigger from subscription_started_at +
-- subscription_cycle). Our subscriptions rows left current_period_end NULL, so paid plans showed
-- an empty Renewal date. iTrova also upgrades a plan by writing businesses.subscription_tier /
-- _started_at / _cycle directly (no Edge Function), and nothing was propagating that to
-- subscriptions, so plan_key/amount/period drifted too.
--
-- Fix: make the subscriptions row track the businesses row.
-- 1. Replace the insert-only seed trigger (20260627110000) with a sync trigger that fires on INSERT
--    and on UPDATE of the subscription columns, refreshing plan_key / cycle / amount / currency /
--    current_period_start / current_period_end from the business + plan catalogue. status is set on
--    first insert ('active') and preserved thereafter (don't clobber a later canceled/past_due).
-- 2. Backfill every existing subscription from its business so current_period_end (renewal) is
--    populated right away.

-- 1. Sync function + trigger --------------------------------------------------
create or replace function public.tg_business_sync_subscription()
returns trigger
language plpgsql security definer set search_path = public as $$
declare pl public.plans%rowtype;
begin
  select * into pl from public.plans where key = coalesce(new.subscription_tier, 'free');
  if not found then
    return new;  -- unknown tier (shouldn't happen via FK); never block the business write
  end if;
  insert into public.subscriptions
    (business_id, plan_key, cycle, status, amount, currency,
     current_period_start, current_period_end, started_at)
  values
    (new.id, pl.key, coalesce(pl.billing_period, 'month'),
     'active'::public.subscription_status, pl.price_amount, pl.price_currency,
     coalesce(new.subscription_started_at, new.created_at),
     new.subscription_renews_at,
     coalesce(new.subscription_started_at, new.created_at))
  on conflict (business_id) do update set
    plan_key             = excluded.plan_key,
    cycle                = excluded.cycle,
    amount               = excluded.amount,
    currency             = excluded.currency,
    current_period_start = excluded.current_period_start,
    current_period_end   = excluded.current_period_end,
    updated_at           = now();
    -- NOTE: status and started_at are intentionally left untouched on update.
  return new;
end $$;

-- Replace the old insert-only seed trigger/function with the sync version.
drop trigger if exists businesses_seed_subscription on public.businesses;
drop function if exists public.tg_business_seed_subscription();

drop trigger if exists businesses_sync_subscription on public.businesses;
create trigger businesses_sync_subscription
  after insert or update of
    subscription_tier, subscription_started_at, subscription_cycle, subscription_renews_at
  on public.businesses
  for each row execute function public.tg_business_sync_subscription();

-- 2. Backfill existing subscriptions from their business ----------------------
update public.subscriptions s set
  plan_key             = coalesce(b.subscription_tier, 'free'),
  cycle                = coalesce(p.billing_period, s.cycle),
  amount               = p.price_amount,
  currency             = p.price_currency,
  current_period_start = coalesce(b.subscription_started_at, b.created_at),
  current_period_end   = b.subscription_renews_at,
  updated_at           = now()
from public.businesses b
left join public.plans p on p.key = coalesce(b.subscription_tier, 'free')
where s.business_id = b.id;
