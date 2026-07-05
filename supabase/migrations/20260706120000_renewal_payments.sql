-- Renewal payment records (the Renewals module). APPLIED TO THE SHARED iTrova PROJECT
-- (wnuyzsjhijhnhkpcnnqu).
--
-- Staff have nowhere to record the EVIDENCE of a renewal payment — the bank/transfer reference
-- number and any notes about how it was settled. public.subscriptions holds only the CURRENT
-- state (the sync trigger overwrites it in place), so there is no payment history at all.
--
-- cs_renewal_payment is a manually-logged, per-business payment trail: payment date, optional
-- amount, the Ref No, notes, and an optional snapshot of what was paid for (plan/cycle). Reads
-- are visibility-scoped like every cs_* table (support sees only assigned customers); WRITES are
-- Management/Admin-only — payment evidence is money-adjacent.

create table if not exists public.cs_renewal_payment (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  paid_at     date not null default current_date,   -- when the payment was made
  amount      numeric,                              -- optional; some records are ref-only
  currency    text not null default 'NGN',
  ref_no      text,                                 -- payment reference number
  notes       text,
  plan_key    text,                                 -- optional snapshot of what was paid for
  cycle       text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cs_renewal_payment_business_idx
  on public.cs_renewal_payment (business_id, paid_at desc);

-- Reuse the shared cs_* trigger helpers (20260625140000): stamp updated_at + created_by.
drop trigger if exists set_updated_at on public.cs_renewal_payment;
create trigger set_updated_at before update on public.cs_renewal_payment
  for each row execute function public.cs_set_updated_at();
drop trigger if exists set_created_by on public.cs_renewal_payment;
create trigger set_created_by before insert on public.cs_renewal_payment
  for each row execute function public.cs_set_created_by();

-- RLS: visibility-scoped reads (support → assigned only), admin-only writes.
alter table public.cs_renewal_payment enable row level security;
drop policy if exists "role read" on public.cs_renewal_payment;
create policy "role read" on public.cs_renewal_payment for select to authenticated
  using (public.cs_can_see_business(business_id));
drop policy if exists "admin write" on public.cs_renewal_payment;
create policy "admin write" on public.cs_renewal_payment
  for all to authenticated
  using (public.cs_is_admin()) with check (public.cs_is_admin());
revoke all on public.cs_renewal_payment from anon;
grant select, insert, update, delete on public.cs_renewal_payment to authenticated;
