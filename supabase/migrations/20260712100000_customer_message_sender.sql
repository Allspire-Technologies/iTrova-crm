-- Show who sent each customer message. The Messages tab (Customer Detail) lists sends from
-- cs_customer_message, but the sender (created_by → auth.users) can't be resolved client-side
-- (staff can't read auth.users). This adds a SECURITY DEFINER reader that returns the log for a
-- business WITH the sender's display name, enforcing the SAME visibility as the table's RLS
-- (cs_can_see_business — support sees only assigned customers). Names resolve with the same
-- coalesce chain as admin_list_staff_roles.
--
-- APPLY TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu), where cs_customer_message lives.

create or replace function public.cs_customer_messages(p_business_id uuid)
returns table (
  id             uuid,
  business_id    uuid,
  to_email       text,
  subject        text,
  template_key   text,
  status         text,
  error          text,
  created_at     timestamptz,
  created_by     uuid,
  created_by_name text
)
language plpgsql stable security definer set search_path = public as $$
begin
  -- Same guard as the "staff read messages" RLS policy on cs_customer_message.
  if not public.cs_can_see_business(p_business_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select
    m.id, m.business_id, m.to_email, m.subject, m.template_key, m.status, m.error, m.created_at,
    m.created_by,
    coalesce(pr.owner_name, au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name', au.email)::text
  from public.cs_customer_message m
  left join auth.users au on au.id = m.created_by
  left join public.profiles pr on pr.id = m.created_by
  where m.business_id = p_business_id
  order by m.created_at desc;
end $$;

revoke all on function public.cs_customer_messages(uuid) from public, anon;
grant execute on function public.cs_customer_messages(uuid) to authenticated;
