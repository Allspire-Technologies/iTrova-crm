-- Atomic affiliate delete: the "no history" check and the delete run in ONE transaction under a
-- per-code advisory lock, so a payout or referral write racing the delete can't slip in between
-- (the client used to check cs_referrers_summary, then delete, as two round trips).
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).

create or replace function public.cs_delete_referrer(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(p_code));
  v_referred integer;
  v_payouts integer;
begin
  if not public.cs_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_code = '' then
    raise exception 'A referrer code is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('cs_referrer:' || v_code));

  select count(*) into v_referred from public.businesses b where upper(b.referred_by_code) = v_code;
  select count(*) into v_payouts from public.cs_referral_payout p where upper(p.code) = v_code;
  if v_referred > 0 or v_payouts > 0 then
    raise exception '% has history (% referred, % payout records). Deactivate it instead so attribution and payouts stay intact.',
      v_code, v_referred, v_payouts;
  end if;

  delete from public.cs_referrer where upper(code) = v_code;
  if not found then
    raise exception 'Referrer % not found.', v_code;
  end if;
end;
$$;

revoke all on function public.cs_delete_referrer(text) from public, anon;
grant execute on function public.cs_delete_referrer(text) to authenticated;

notify pgrst, 'reload schema';
