-- Active subscription for EVERY business (incl. Free). APPLIED TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- Why: the subscriptions table was seeded once (20260625110000) and nothing creates a row for
-- businesses added afterwards. iTrova stamps every new business with subscription_tier = 'free'
-- (handle_new_user never sets a paid tier, and the column defaults to 'free'), so free businesses
-- had NO row in subscriptions -> admin_business_aggregates' LEFT JOIN yielded a null status -> the
-- Admin OS customer view showed "No subscription". We want every business to carry a real, active
-- subscription that mirrors its current tier from the plan catalogue.
--
-- 1. Backfill: insert a current, active subscription for any business that has a tier but no row.
-- 2. Trigger: auto-create that subscription whenever a new business is inserted.
--
-- Paid upgrades (service-role Edge Functions) still own status/period changes after creation; this
-- only guarantees the row EXISTS and starts 'active'. Amount/cycle come from the plan catalogue;
-- free's billing_period is null, so cycle falls back to 'month' and the renewal date stays null.

-- 1. Backfill existing gaps ---------------------------------------------------
insert into public.subscriptions
  (business_id, plan_key, cycle, status, amount, currency, current_period_start, started_at)
select b.id, b.subscription_tier,
       coalesce(p.billing_period, 'month'),
       'active'::public.subscription_status,
       p.price_amount, p.price_currency, b.created_at, b.created_at
from public.businesses b
join public.plans p on p.key = b.subscription_tier
where b.subscription_tier is not null
on conflict (business_id) do nothing;

-- 2. Auto-create a subscription for each new business -------------------------
-- SECURITY DEFINER so it can write subscriptions (RLS has no INSERT policy; writes are owner/
-- service-role only). Never blocks the business insert: unknown tiers just skip.
create or replace function public.tg_business_seed_subscription()
returns trigger
language plpgsql security definer set search_path = public as $$
declare pl public.plans%rowtype;
begin
  -- Treat a business with no explicit tier as 'free'.
  select * into pl from public.plans where key = coalesce(new.subscription_tier, 'free');
  if not found then
    return new;
  end if;
  insert into public.subscriptions
    (business_id, plan_key, cycle, status, amount, currency, current_period_start, started_at)
  values
    (new.id, pl.key, coalesce(pl.billing_period, 'month'),
     'active'::public.subscription_status, pl.price_amount, pl.price_currency,
     new.created_at, new.created_at)
  on conflict (business_id) do nothing;
  return new;
end $$;

drop trigger if exists businesses_seed_subscription on public.businesses;
create trigger businesses_seed_subscription
  after insert on public.businesses
  for each row execute function public.tg_business_seed_subscription();
