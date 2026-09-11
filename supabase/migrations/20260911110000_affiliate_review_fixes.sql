-- Review follow-ups on the affiliate dashboard data (CRM #85). 20260911100000 is already applied on
-- production, so these land as a separate, re-runnable migration.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).

-- ---------------------------------------------------------------- 1. the identity helper is internal
-- _my_affiliate() returns referral_config.staff_bonus alongside the caller's share. Only the
-- SECURITY DEFINER dashboard functions need it, and they run with the owner's privileges, so no
-- client grant is required and none should exist: an affiliate must not be able to read staff bonus
-- configuration by calling the helper directly.
revoke all on function public._my_affiliate() from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. lock and payout serialise on the referrer row
-- Two statements decided the bank lock: "does a payout exist?" then "update the details". A payout
-- recorded between them would let the details change after the lock should have applied. Both
-- sides now take the affiliate's cs_referrer row FOR UPDATE first, so one waits for the other.
create or replace function public.my_affiliate_update_bank(p_bank_name text, p_account_number text, p_account_name text)
returns table (bank_name text, account_number text, account_name text, bank_locked boolean)
language plpgsql security definer set search_path = public as $$
declare v_code text; v_locked boolean; v_old text;
begin
  -- Locks the row for the rest of the transaction; cs_record_payout takes the same lock.
  select cr.code, cr.account_number into v_code, v_old from public.cs_referrer cr
    where cr.user_id = auth.uid() and cr.active and cr.kind = 'affiliate'
    for update;
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
          and (cr.bank_unlocked_until is null or cr.bank_unlocked_until < now()))
    into v_locked
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

-- Same body as 20260731100000, plus the row lock before the payout is written. Business credits
-- have no referrer row (they key on business_id), so the lock only applies to code payouts.
create or replace function public.cs_record_payout(p_code text, p_business_id uuid, p_amount numeric, p_kind text, p_note text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare v_monthly numeric; v_months int := 0; v_tier text;
begin
  if public.cs_my_role() <> 'admin' then raise exception 'not authorized' using errcode = '42501'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'amount must be positive'; end if;
  if p_kind not in ('cash', 'subscription') then raise exception 'invalid kind'; end if;

  if nullif(upper(coalesce(p_code, '')), '') is not null then
    perform 1 from public.cs_referrer where code = upper(p_code) for update;
  end if;

  if p_kind = 'subscription' then
    if p_business_id is null then raise exception 'a business is required for a subscription credit'; end if;
    select subscription_tier into v_tier from public.businesses where id = p_business_id;
    select price_amount into v_monthly from public.plans where key = coalesce(v_tier, 'free');
    if coalesce(v_monthly, 0) > 0 then
      v_months := floor(p_amount / v_monthly);
      if v_months > 0 then
        update public.businesses
          set subscription_renews_at = greatest(coalesce(subscription_renews_at, now()), now()) + (v_months || ' months')::interval
        where id = p_business_id;
      end if;
    end if;
  end if;

  insert into public.cs_referral_payout (code, business_id, amount, kind, note, created_by)
  values (nullif(upper(coalesce(p_code, '')), ''), p_business_id, p_amount, p_kind, p_note, auth.uid());
  return v_months;
end $$;

notify pgrst, 'reload schema';
