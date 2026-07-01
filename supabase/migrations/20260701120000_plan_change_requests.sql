-- Dual-control plan change (upgrade/downgrade) for a business. APPLIED TO THE SHARED iTrova
-- PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- A Management/Admin REQUESTS a plan change for a business; a DIFFERENT admin reviews that exact
-- request and mints a one-time 6-digit code; the requester then APPLIES it with their password +
-- the code. The password + code are verified server-side in the execute-plan-change Edge Function,
-- which is the ONLY path that writes businesses.subscription_tier (via admin_apply_plan_change,
-- granted to service_role only) — so the password can never be bypassed from the browser.
--
-- Applying just writes businesses.subscription_tier/_cycle/_started_at; iTrova's own trigger
-- recomputes subscription_renews_at and our businesses_sync_subscription trigger (20260627130000)
-- refreshes the public.subscriptions mirror (plan_key/amount/period). The request row is the audit
-- trail (who requested, who approved, from/to tier, timestamps).
--
-- Security: the table grants NO direct DML to anon/authenticated. Every mutation goes through the
-- SECURITY DEFINER functions below, so the two-person rule and the hashed (bcrypt) code can't be
-- circumvented. cs_is_admin() gates the browser-callable RPCs; the apply function is service_role
-- only (called by the Edge Function after it has verified the caller is an admin AND the password).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Request lifecycle + audit table.
-- ---------------------------------------------------------------------------
create table if not exists public.cs_plan_change_request (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  from_tier       text,
  to_tier         text not null,
  from_cycle      text,
  to_cycle        text,          -- target billing cycle (monthly/quarterly/biannual/annual)
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'executed', 'canceled', 'expired')),
  requested_by    uuid references auth.users(id) on delete set null,
  approved_by     uuid references auth.users(id) on delete set null,
  code_hash       text,          -- bcrypt hash of the 6-digit approval code (never the plaintext)
  code_expires_at timestamptz,
  code_attempts   int not null default 0,
  executed_at     timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- At most one in-flight (pending/approved) request per business.
create unique index if not exists cs_plan_change_active_idx
  on public.cs_plan_change_request (business_id)
  where status in ('pending', 'approved');

drop trigger if exists set_updated_at on public.cs_plan_change_request;
create trigger set_updated_at before update on public.cs_plan_change_request
  for each row execute function public.cs_set_updated_at();
drop trigger if exists set_created_by on public.cs_plan_change_request;
create trigger set_created_by before insert on public.cs_plan_change_request
  for each row execute function public.cs_set_created_by();

-- RLS on, and NO grants to anon/authenticated: the table is reachable only through the SECURITY
-- DEFINER functions below (which run as owner and bypass RLS). This keeps code_hash off the wire
-- and prevents any direct tampering with status / approver.
alter table public.cs_plan_change_request enable row level security;
revoke all on public.cs_plan_change_request from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1b. Idempotency when re-applying over an earlier version of this migration: add the cycle columns
--     if the table pre-existed, drop any stale to_cycle CHECK, and drop functions whose signature or
--     return type changed (create-or-replace can't alter a function's OUT columns).
-- ---------------------------------------------------------------------------
alter table public.cs_plan_change_request add column if not exists from_cycle text;
alter table public.cs_plan_change_request add column if not exists to_cycle text;
alter table public.cs_plan_change_request drop constraint if exists cs_plan_change_request_to_cycle_check;

drop function if exists public.admin_list_plans();
drop function if exists public.admin_get_plan_change(uuid);
drop function if exists public.admin_request_plan_change(uuid, text);
drop function if exists public.admin_request_plan_change(uuid, text, text);

-- ---------------------------------------------------------------------------
-- 2. Plan catalogue for the picker. iTrova prices per billing cycle in public.plan_prices_view
--    (plan_key × cycle → price_amount, discount_percent; cycles: monthly/quarterly/biannual/annual).
--    Expose the full matrix via an admin-gated RPC (the view has no staff RLS).
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_plans()
returns table (plan_key text, plan_name text, cycle text, price_amount numeric, discount_percent numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.cs_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select v.plan_key, v.plan_name, v.cycle, v.price_amount, v.discount_percent
  from public.plan_prices_view v
  order by v.price_amount nulls first, v.plan_key, v.cycle;
end $$;
revoke all on function public.admin_list_plans() from public, anon;
grant execute on function public.admin_list_plans() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Read the active request for a business (safe columns only — never code_hash).
-- ---------------------------------------------------------------------------
create or replace function public.admin_get_plan_change(p_business_id uuid)
returns table (
  id uuid, business_id uuid, from_tier text, to_tier text, from_cycle text, to_cycle text, status text,
  requested_by uuid, requested_by_name text,
  approved_by uuid, approved_by_name text,
  code_expires_at timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.cs_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select r.id, r.business_id, r.from_tier, r.to_tier, r.from_cycle, r.to_cycle, r.status,
         r.requested_by, coalesce(rp.owner_name, ru.email)::text,
         r.approved_by,  coalesce(ap.owner_name, au.email)::text,
         r.code_expires_at, r.created_at
  from public.cs_plan_change_request r
  left join auth.users ru on ru.id = r.requested_by
  left join public.profiles rp on rp.id = r.requested_by
  left join auth.users au on au.id = r.approved_by
  left join public.profiles ap on ap.id = r.approved_by
  where r.business_id = p_business_id
    and r.status in ('pending', 'approved')
  order by r.created_at desc
  limit 1;
end $$;
revoke all on function public.admin_get_plan_change(uuid) from public, anon;
grant execute on function public.admin_get_plan_change(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Request a change OR renewal (any admin). Tier and cycle are independent (iTrova prices each
--    plan_key per cycle in plan_prices_view), so the caller picks both. One path covers a tier
--    change, a cycle switch (monthly↔quarterly↔biannual↔annual) and a renewal (same tier + cycle,
--    period restarts on apply). Same tier+cycle is allowed (that's a renewal). Validates that the
--    (plan_key, cycle) pair exists + no in-flight request.
-- ---------------------------------------------------------------------------
create or replace function public.admin_request_plan_change(p_business_id uuid, p_to_tier text, p_to_cycle text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_tier text; v_cycle text; v_id uuid;
begin
  if not public.cs_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_business_id is null or p_to_tier is null or p_to_cycle is null then
    raise exception 'business, target plan and cycle are required';
  end if;
  select subscription_tier, subscription_cycle into v_tier, v_cycle
    from public.businesses where id = p_business_id;
  if not found then
    raise exception 'business not found' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.plan_prices_view where plan_key = p_to_tier and cycle = p_to_cycle) then
    raise exception 'no % plan on a % cycle', p_to_tier, p_to_cycle;
  end if;
  if exists (select 1 from public.cs_plan_change_request
             where business_id = p_business_id and status in ('pending', 'approved')) then
    raise exception 'a plan change is already in progress for this business';
  end if;
  insert into public.cs_plan_change_request
    (business_id, from_tier, to_tier, from_cycle, to_cycle, requested_by)
  values (p_business_id, v_tier, p_to_tier, v_cycle, p_to_cycle, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.admin_request_plan_change(uuid, text, text) from public, anon;
grant execute on function public.admin_request_plan_change(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Approve a request (a DIFFERENT admin). Mints a one-time 6-digit code (15-min TTL) and returns
--    it once; only the bcrypt hash is stored.
-- ---------------------------------------------------------------------------
create or replace function public.admin_approve_plan_change(p_request_id uuid)
returns text
-- search_path includes `extensions` because pgcrypto's crypt()/gen_salt() live there on Supabase.
language plpgsql security definer set search_path = public, extensions as $$
declare r public.cs_plan_change_request%rowtype; v_code text;
begin
  if not public.cs_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into r from public.cs_plan_change_request where id = p_request_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'no_data_found';
  end if;
  if r.status <> 'pending' then
    raise exception 'this request is % — only a pending request can be approved', r.status;
  end if;
  if r.requested_by = auth.uid() then
    raise exception 'a plan change must be approved by a different admin';
  end if;
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  update public.cs_plan_change_request set
    status          = 'approved',
    approved_by     = auth.uid(),
    code_hash       = crypt(v_code, gen_salt('bf')),
    code_expires_at = now() + interval '15 minutes',
    code_attempts   = 0
  where id = p_request_id;
  return v_code;
end $$;
revoke all on function public.admin_approve_plan_change(uuid) from public, anon;
grant execute on function public.admin_approve_plan_change(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Cancel a request (requester or any admin) — clears a stuck/abandoned request.
-- ---------------------------------------------------------------------------
create or replace function public.admin_cancel_plan_change(p_request_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.cs_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.cs_plan_change_request
     set status = 'canceled'
   where id = p_request_id and status in ('pending', 'approved');
end $$;
revoke all on function public.admin_cancel_plan_change(uuid) from public, anon;
grant execute on function public.admin_cancel_plan_change(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Apply the change — SERVICE ROLE ONLY. Called by the execute-plan-change Edge Function after it
--    has verified the caller is an admin AND re-checked their password. Enforces the full
--    dual-control invariant server-side, then writes the source of truth. Returns a soft jsonb
--    result (never raises for expected failures, so the wrong-code attempt counter persists).
-- ---------------------------------------------------------------------------
create or replace function public.admin_apply_plan_change(p_request_id uuid, p_code text, p_actor uuid)
returns jsonb
-- search_path includes `extensions` because pgcrypto's crypt() lives there on Supabase.
language plpgsql security definer set search_path = public, extensions as $$
declare r public.cs_plan_change_request%rowtype;
begin
  select * into r from public.cs_plan_change_request where id = p_request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Request not found.');
  end if;
  if r.status <> 'approved' then
    return jsonb_build_object('ok', false, 'error', 'This request is not awaiting execution.');
  end if;
  if r.code_expires_at is null or r.code_expires_at <= now() then
    update public.cs_plan_change_request set status = 'expired' where id = r.id;
    return jsonb_build_object('ok', false, 'error', 'The approval code has expired — request a new one.');
  end if;
  if r.requested_by is distinct from p_actor then
    return jsonb_build_object('ok', false, 'error', 'Only the requesting admin can apply this change.');
  end if;
  if r.approved_by is null or r.approved_by = p_actor then
    return jsonb_build_object('ok', false, 'error', 'This change must be approved by a different admin.');
  end if;
  if r.code_hash is null or crypt(p_code, r.code_hash) <> r.code_hash then
    update public.cs_plan_change_request
       set code_attempts = code_attempts + 1,
           status = case when code_attempts + 1 >= 3 then 'expired' else status end
     where id = r.id;
    return jsonb_build_object('ok', false, 'error', 'Incorrect approval code.');
  end if;

  -- Apply: write the source of truth (mirrors how iTrova itself changes a plan). Setting
  -- subscription_started_at = now() restarts the period (a renewal), and iTrova recomputes
  -- subscription_renews_at from the (possibly switched) cycle; its own triggers propagate price.
  update public.businesses
     set subscription_tier       = r.to_tier,
         subscription_cycle      = coalesce(r.to_cycle, subscription_cycle),
         subscription_started_at = now()
   where id = r.business_id;
  update public.cs_plan_change_request
     set status = 'executed', executed_at = now()
   where id = r.id;
  return jsonb_build_object('ok', true, 'to_tier', r.to_tier);
end $$;
revoke all on function public.admin_apply_plan_change(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_apply_plan_change(uuid, text, uuid) to service_role;
