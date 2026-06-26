-- Staff admin fixes (invite UX). APPLIED TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- 1. admin_list_staff_roles: prefer the user's own full_name (what they enter on /set-password)
--    over the profiles.owner_name that iTrova's signup trigger defaults to, and expose a `pending`
--    flag (never signed in = invite not accepted yet) so the UI can offer "copy invite link".
-- 2. admin_remove_staff: let an admin revoke a staff member (delete their cs_staff_role +
--    platform_admins row). Can't remove yourself (avoids lock-out).
--
-- (No change to iTrova's handle_new_user: the invite Edge Function tags staff users with an
--  `invite_token` metadata flag, which its existing guard already uses to skip business creation.)

-- Return type changes (added `pending`), so the old function must be dropped first.
drop function if exists public.admin_list_staff_roles();
create or replace function public.admin_list_staff_roles()
returns table (user_id uuid, name text, email text, role text, pending boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select
    pa.user_id,
    coalesce(
      au.raw_user_meta_data ->> 'full_name',
      au.raw_user_meta_data ->> 'name',
      pr.owner_name,
      au.email
    )::text,
    au.email::text,
    coalesce(sr.role, 'admin'),
    (au.last_sign_in_at is null)
  from public.platform_admins pa
  join auth.users au on au.id = pa.user_id
  left join public.profiles pr on pr.id = pa.user_id
  left join public.cs_staff_role sr on sr.user_id = pa.user_id
  order by 2 nulls last;
end $$;

create or replace function public.admin_remove_staff(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.cs_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot remove yourself.' using errcode = '42501';
  end if;
  delete from public.cs_staff_role  where user_id = p_user_id;
  delete from public.platform_admins where user_id = p_user_id;
end $$;
revoke all on function public.admin_remove_staff(uuid) from public;
grant execute on function public.admin_remove_staff(uuid) to authenticated;
