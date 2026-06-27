-- Assignable-staff dropdown shows the wrong name. APPLIED TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- admin_list_staff() (the candidate account-manager directory behind the "Assign" / Account-manager
-- dropdowns) coalesced names with profiles.owner_name FIRST. For staff added via the invite flow,
-- iTrova's handle_new_user seeds owner_name = 'Staff' (a placeholder); the real name the invitee
-- enters on /set-password lands in auth.users.raw_user_meta_data->>'full_name' and never overwrites
-- owner_name. So the dropdown showed "Staff" for everyone instead of their names.
--
-- Fix: prefer the auth full_name (what the invitee actually typed) over the profile placeholder —
-- same coalesce order already applied to admin_list_staff_roles in 20260627100000.

create or replace function public.admin_list_staff()
returns table (user_id uuid, name text, email text)
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
    )::text as name,
    au.email::text
  from public.platform_admins pa
  join auth.users au on au.id = pa.user_id
  left join public.profiles pr on pr.id = pa.user_id
  order by name nulls last;
end $$;
