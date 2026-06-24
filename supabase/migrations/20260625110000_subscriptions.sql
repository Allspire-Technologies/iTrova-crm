-- Subscription lifecycle for Admin OS. APPLIED TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- iTrova tracks only the CURRENT tier (businesses.subscription_tier -> plans.key) with no
-- status, billing period or renewal date. This table adds that lifecycle. One current
-- subscription per business in v1 (unique business_id); history can relax this later.
-- Reads: the owning business + platform admins. Writes: service-role only (Admin OS Edge
-- Functions), so there is no insert/update/delete policy.

do $$ begin
  create type public.subscription_status as enum
    ('trialing','active','past_due','canceled','expired');
exception when duplicate_object then null; end $$;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  plan_key text not null references public.plans(key) on update cascade,
  cycle text not null default 'month',                 -- 'month' | 'year'
  status public.subscription_status not null default 'active',
  amount numeric not null default 0,
  currency text not null default 'NGN',
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  started_at timestamptz not null default now(),
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One current subscription per business (v1).
create unique index if not exists subscriptions_business_id_uidx
  on public.subscriptions (business_id);

alter table public.subscriptions enable row level security;

-- The owning business may read its own subscription.
drop policy if exists "business reads own subscription" on public.subscriptions;
create policy "business reads own subscription"
  on public.subscriptions for select
  to authenticated
  using (business_id = public.current_business_id());

-- Platform admins read every subscription.
drop policy if exists "platform admins read all subscriptions" on public.subscriptions;
create policy "platform admins read all subscriptions"
  on public.subscriptions for select
  to authenticated
  using (public.is_platform_admin());

grant select on public.subscriptions to authenticated;

-- Keep updated_at fresh. Dedicated function name to avoid clobbering any existing helper.
create or replace function public.tg_subscriptions_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.tg_subscriptions_updated_at();

-- Backfill a current subscription for every business that already has a tier, so the
-- lifecycle table reflects today's state immediately. Amount/cycle come from the plan
-- catalogue; renewal date is left null (unknown) rather than fabricated.
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
