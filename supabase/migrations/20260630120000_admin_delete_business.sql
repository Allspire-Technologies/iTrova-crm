-- Let a Management/Admin staff member delete a business (and all its data) from Admin OS.
-- APPLIED TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- The CRM (anon key) has read-only access to iTrova tables, so the delete runs through this
-- SECURITY DEFINER RPC, gated on cs_is_admin() (role = 'admin'). Most child rows (user_roles,
-- products, sales, invoices, suppliers, …) cascade via FK ON DELETE CASCADE; profiles.business_id
-- has no FK, so detach those members first to avoid dangling references.

create or replace function public.admin_delete_business(p_business_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
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

  -- profiles.business_id is a plain uuid (no FK) — detach members so no rows point at a dead business.
  update public.profiles set business_id = null where business_id = p_business_id;

  -- FK-linked tables cascade. This removes the business and its products, sales, invoices, etc.
  delete from public.businesses where id = p_business_id;
end; $$;

revoke all on function public.admin_delete_business(uuid) from public, anon;
grant execute on function public.admin_delete_business(uuid) to authenticated;
