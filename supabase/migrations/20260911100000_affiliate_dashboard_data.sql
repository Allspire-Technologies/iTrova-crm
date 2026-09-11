-- Affiliate dashboard, Phase 2: the affiliate's own summary, referrals and payouts.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- All three read the same cs_referral_revenue view and _referral_reward() that cs_referrers_summary
-- and my_referral_earnings already use, so an affiliate can never see a figure that differs from
-- what the CRM shows for them. Every function is SECURITY DEFINER, resolves auth.uid() to an
-- ACTIVE affiliate in cs_referrer, and returns NO ROWS for anyone else.

-- ---------------------------------------------------------------- who am I (affiliate)
-- One place for the identity rule the three readers share: linked, active, and of kind affiliate.
create or replace function public._my_affiliate()
returns table (code text, share numeric, bonus jsonb)
language sql stable security definer set search_path = public as $$
  select cr.code, coalesce(cr.share_percent, cfg.affiliate_share_percent), cfg.staff_bonus
  from public.cs_referrer cr
  cross join (select affiliate_share_percent, staff_bonus from public.referral_config limit 1) cfg
  where cr.user_id = auth.uid() and cr.active and cr.kind = 'affiliate';
$$;
revoke all on function public._my_affiliate() from public, anon;
grant execute on function public._my_affiliate() to authenticated;

-- ---------------------------------------------------------------- headline figures
create or replace function public.my_affiliate_summary()
returns table (referred_count int, converted_count int, earned numeric, paid numeric, accrued numeric, share_percent numeric)
language sql stable security definer set search_path = public as $$
  with me as (select * from public._my_affiliate()),
  refd as (
    select rv.converted, public._referral_reward('affiliate', me.share, rv.plan_key, rv.revenue, me.bonus, rv.converted) as reward
    from me
    join public.businesses rb on upper(rb.referred_by_code) = upper(me.code)
    left join public.cs_referral_revenue rv on rv.business_id = rb.id
  ),
  tot as (
    select count(*)::int as referred, count(*) filter (where converted)::int as conv, coalesce(sum(reward), 0) as earned
    from refd
  ),
  pay as (
    select coalesce(sum(p.amount), 0) as paid
    from me left join public.cs_referral_payout p on upper(p.code) = upper(me.code)
  )
  select t.referred, t.conv, t.earned, pay.paid, (t.earned - pay.paid), me.share
  from me cross join tot t cross join pay;
$$;
revoke all on function public.my_affiliate_summary() from public, anon;
grant execute on function public.my_affiliate_summary() to authenticated;

-- ---------------------------------------------------------------- each referred business
--   status: signed_up  → not on a paid plan yet
--           paying     → on a paid plan whose effective tier is still paid
--           lapsed     → was on a paid plan but the subscription has expired (effective tier free),
--                        so its first-year value is frozen and it earns nothing further
-- owner_email is shown in full by product decision (affiliate terms + privacy policy carry the
-- disclosure). It is read from auth.users here because the browser must never query that table.
create or replace function public.my_affiliate_referrals()
returns table (
  business_id uuid, business_name text, owner_email text, signed_up_at timestamptz,
  plan_key text, cycle text, status text, started_at date, earned numeric
)
language sql stable security definer set search_path = public as $$
  with me as (select * from public._my_affiliate())
  select
    rb.id,
    rb.name,
    (select au.email::text from auth.users au where au.id = rb.owner_id),
    rb.created_at,
    rv.plan_key,
    rb.subscription_cycle,
    case
      when not coalesce(rv.converted, false) then 'signed_up'
      when public._effective_tier(rb.id) = 'free' then 'lapsed'
      else 'paying'
    end,
    rv.started_at::date,
    public._referral_reward('affiliate', me.share, rv.plan_key, rv.revenue, me.bonus, rv.converted)
  from me
  join public.businesses rb on upper(rb.referred_by_code) = upper(me.code)
  left join public.cs_referral_revenue rv on rv.business_id = rb.id
  order by rb.created_at desc;
$$;
revoke all on function public.my_affiliate_referrals() from public, anon;
grant execute on function public.my_affiliate_referrals() to authenticated;

-- ---------------------------------------------------------------- what we have paid them
create or replace function public.my_affiliate_payouts()
returns table (id uuid, paid_at timestamptz, amount numeric, kind text, note text)
language sql stable security definer set search_path = public as $$
  with me as (select * from public._my_affiliate())
  select p.id, p.created_at, p.amount, p.kind, p.note
  from me
  join public.cs_referral_payout p on upper(p.code) = upper(me.code)
  order by p.created_at desc;
$$;
revoke all on function public.my_affiliate_payouts() from public, anon;
grant execute on function public.my_affiliate_payouts() to authenticated;

-- ---------------------------------------------------------------- bank details, by the affiliate
-- Editable until the first payout to this affiliate; locked after that unless an admin has opened a
-- window (bank_unlocked_until in the future). Every save writes a masked audit row. The audit table
-- never holds a full account number: it is a change log, not a second copy of the details.
create or replace function public._mask_account(_n text)
returns text language sql immutable as $$
  select case when _n is null or length(_n) < 4 then null else repeat('*', length(_n) - 4) || right(_n, 4) end;
$$;

create or replace function public.my_affiliate_update_bank(p_bank_name text, p_account_number text, p_account_name text)
returns table (bank_name text, account_number text, account_name text, bank_locked boolean)
language plpgsql security definer set search_path = public as $$
declare v_code text; v_locked boolean; v_old text;
begin
  select cr.code into v_code from public.cs_referrer cr
    where cr.user_id = auth.uid() and cr.active and cr.kind = 'affiliate';
  if v_code is null then
    raise exception 'not an affiliate' using errcode = '42501';
  end if;
  if nullif(trim(p_bank_name), '') is null or nullif(trim(p_account_number), '') is null or nullif(trim(p_account_name), '') is null then
    raise exception 'Bank, account number and account name are all required' using errcode = '22023';
  end if;
  -- Nigerian NUBAN account numbers are exactly 10 digits.
  if trim(p_account_number) !~ '^[0-9]{10}$' then
    raise exception 'Account number must be 10 digits' using errcode = '22023';
  end if;
  select (exists (select 1 from public.cs_referral_payout p where upper(p.code) = upper(cr.code))
          and (cr.bank_unlocked_until is null or cr.bank_unlocked_until < now())),
         cr.account_number
    into v_locked, v_old
  from public.cs_referrer cr where cr.code = v_code;
  if v_locked then
    raise exception 'Bank details are locked after your first payout. Contact support to change them.' using errcode = '42501';
  end if;
  update public.cs_referrer
     set bank_name = trim(p_bank_name), account_number = trim(p_account_number), account_name = trim(p_account_name)
   where code = v_code;
  insert into public.cs_referrer_bank_change (code, changed_by, old_masked, new_masked)
  values (v_code, auth.uid(), public._mask_account(v_old), public._mask_account(trim(p_account_number)));
  return query
  select cr.bank_name, cr.account_number, cr.account_name,
         (exists (select 1 from public.cs_referral_payout p where upper(p.code) = upper(cr.code))
          and (cr.bank_unlocked_until is null or cr.bank_unlocked_until < now()))
  from public.cs_referrer cr where cr.code = v_code;
end $$;
revoke all on function public.my_affiliate_update_bank(text, text, text) from public, anon;
grant execute on function public.my_affiliate_update_bank(text, text, text) to authenticated;

-- ---------------------------------------------------------------- admin unlock
-- Opens a self-expiring window rather than flipping a flag, so nobody has to remember to re-lock.
create or replace function public.cs_unlock_affiliate_bank(p_code text, p_hours int default 72)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_until timestamptz;
begin
  if public.cs_my_role() is distinct from 'admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 720 then
    raise exception 'Unlock window must be between 1 and 720 hours' using errcode = '22023';
  end if;
  update public.cs_referrer
     set bank_unlocked_until = now() + make_interval(hours => p_hours)
   where code = upper(p_code) and kind = 'affiliate'
  returning bank_unlocked_until into v_until;
  if v_until is null then
    raise exception 'Affiliate not found' using errcode = 'P0002';
  end if;
  return v_until;
end $$;
revoke all on function public.cs_unlock_affiliate_bank(text, int) from public, anon;
grant execute on function public.cs_unlock_affiliate_bank(text, int) to authenticated;

notify pgrst, 'reload schema';
