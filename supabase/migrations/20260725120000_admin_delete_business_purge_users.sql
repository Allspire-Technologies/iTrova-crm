-- Deleting a business now also removes the auth accounts of ALL its users (owner + staff).
-- APPLIED TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- Before: admin_delete_business hard-deleted the business (cascading its data + user_roles) but left
-- every user's auth.users row intact and merely nulled profiles.business_id. That stranded the owner
-- and staff as authenticated-but-businessless accounts: they could still sign in (landing in an empty
-- shell), and — because the email was still registered — they could NOT sign up a fresh business.
--
-- After: we collect every user tied to the business (owner_id + user_roles members + profiles pointing
-- at it) BEFORE the delete (user_roles cascades away with the business), then remove those auth.users
-- rows once the business is gone. Effect:
--   • their login fails with the normal "invalid credentials" error (account no longer exists), and
--   • their email is freed, so the owner can sign up again for a brand-new business.
-- profiles rows cascade off auth.users (profiles.id → auth.users ON DELETE CASCADE), so no manual
-- profile cleanup is needed. Note: iTrova is single-business-per-user (profiles.business_id is 1:1),
-- so removing a member's account only affects this business.
--
-- Ordering matters: we must delete the business (with the sale_items/journal_lines pre-clears from
-- 20260714120000) BEFORE deleting auth.users — otherwise the owner's account delete would cascade the
-- business and trip the two non-cascade grandchild FKs again.

create or replace function public.admin_delete_business(p_business_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user_ids uuid[];
begin
  if not public.cs_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_business_id is null then
    raise exception 'business id required';
  end if;
  if not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'business not found' using errcode = 'no_data_found';
  end if;

  -- Everyone attached to this business — owner + staff — captured up front (user_roles and the
  -- profiles link both disappear once the business is deleted below).
  select array(
    select distinct uid from (
      select owner_id as uid from public.businesses where id = p_business_id
      union
      select user_id  as uid from public.user_roles where business_id = p_business_id
      union
      select id       as uid from public.profiles  where business_id = p_business_id
    ) s
    where uid is not null
  ) into v_user_ids;

  -- Clear the two grandchild tables whose FK into a cascaded parent isn't ON DELETE CASCADE,
  -- so the business cascade below doesn't trip on them.
  delete from public.sale_items
  where sale_id in (select id from public.sales where business_id = p_business_id);

  delete from public.journal_lines
  where entry_id in (select id from public.journal_entries where business_id = p_business_id);

  -- FK-linked tables cascade. This removes the business and its products, sales, invoices,
  -- accounts, journal entries, user_roles, etc.
  delete from public.businesses where id = p_business_id;

  -- Remove the users' auth accounts (their profiles cascade off auth.users). The business is already
  -- gone, so deleting the owner's account here has nothing left to cascade into the grandchild FKs.
  if array_length(v_user_ids, 1) is not null then
    delete from auth.users where id = any(v_user_ids);
  end if;
end; $$;

revoke all on function public.admin_delete_business(uuid) from public, anon;
grant execute on function public.admin_delete_business(uuid) to authenticated;
