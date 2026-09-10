-- Affiliate dashboard access, Phase 1. Links an affiliate in cs_referrer to an auth account so they
-- can sign in to the iTrova app at /affiliates, and exposes that session only its own record.

-- ---------------------------------------------------------------- 1. the link
alter table public.cs_referrer add column if not exists user_id uuid references auth.users(id) on delete set null;
-- Set by an admin to reopen bank details after the first payout has locked them (Phase 3).
alter table public.cs_referrer add column if not exists bank_unlocked_until timestamptz;
-- One affiliate, one login.
create unique index if not exists cs_referrer_user_id_key on public.cs_referrer (user_id) where user_id is not null;

-- ---------------------------------------------------------------- 2. bank detail audit
-- Written from Phase 3; created now so the shape is settled and the CRM can already read it.
-- Account numbers are stored masked: this is a change log, not a second copy of the details.
create table if not exists public.cs_referrer_bank_change (
  id         uuid primary key default gen_random_uuid(),
  code       text not null references public.cs_referrer(code) on delete cascade,
  changed_by uuid references auth.users(id) on delete set null,
  old_masked text,
  new_masked text,
  created_at timestamptz not null default now()
);
create index if not exists cs_referrer_bank_change_code_idx
  on public.cs_referrer_bank_change (code, created_at desc);

alter table public.cs_referrer_bank_change enable row level security;
revoke all on public.cs_referrer_bank_change from anon, authenticated;
drop policy if exists "bank change staff read" on public.cs_referrer_bank_change;
create policy "bank change staff read" on public.cs_referrer_bank_change for select to authenticated
  using (public.cs_my_role() is not null);
grant select on public.cs_referrer_bank_change to authenticated;

-- ---------------------------------------------------------------- 3. the affiliate's own record
-- Returns NO ROWS for anyone who is not a linked, active affiliate. That single fact is what blocks
-- a deactivated affiliate, an unlinked one, an internal staff referrer and an ordinary business
-- owner from the dashboard, so the app needs no separate permission check.
create or replace function public.my_affiliate_profile()
returns table (
  code text, name text, email text, phone text,
  share_percent numeric, bank_name text, account_number text, account_name text,
  bank_locked boolean, joined_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare v_default_share numeric;
begin
  select affiliate_share_percent into v_default_share from public.referral_config limit 1;
  return query
  select cr.code, cr.name, cr.email, cr.phone,
         coalesce(cr.share_percent, v_default_share),
         cr.bank_name, cr.account_number, cr.account_name,
         (exists (select 1 from public.cs_referral_payout p where upper(p.code) = upper(cr.code))
            and (cr.bank_unlocked_until is null or cr.bank_unlocked_until < now())),
         cr.created_at
  from public.cs_referrer cr
  where cr.user_id = auth.uid() and cr.active and cr.kind = 'affiliate';
end $$;
revoke all on function public.my_affiliate_profile() from public, anon;
grant execute on function public.my_affiliate_profile() to authenticated;

-- ---------------------------------------------------------------- 4. access status for the CRM
-- Drives the None / Invited / Active badge on the Referrers tab. last_sign_in_at lives on
-- auth.users, so this has to be definer.
create or replace function public.cs_affiliate_access()
returns table (code text, user_id uuid, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.cs_my_role() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select cr.code, cr.user_id, u.last_sign_in_at
  from public.cs_referrer cr
  left join auth.users u on u.id = cr.user_id
  where cr.kind = 'affiliate';
end $$;
revoke all on function public.cs_affiliate_access() from public, anon;
grant execute on function public.cs_affiliate_access() to authenticated;

-- ---------------------------------------------------------------- 5. deactivation ends the session
-- Revocation follows the data, so it applies whether the change came from the CRM, a script or the
-- SQL editor. auth.sessions is Supabase-internal and not a published interface, so a failure here
-- must never block the deactivation itself.
create or replace function public.cs_referrer_revoke_sessions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and coalesce(old.active, false) and not new.active then
    begin
      delete from auth.sessions where user_id = new.user_id;
    exception when others then
      raise warning 'affiliate session revoke failed for %: %', new.code, sqlerrm;
    end;
  end if;
  return new;
end $$;

drop trigger if exists revoke_sessions_on_deactivate on public.cs_referrer;
create trigger revoke_sessions_on_deactivate after update of active on public.cs_referrer
  for each row execute function public.cs_referrer_revoke_sessions();

notify pgrst, 'reload schema';
