-- Messages module: a central log of every customer email sent, across all customers. Reads
-- cs_customer_message and returns each row with the customer's business name + the sender's display
-- name (created_by → auth.users, not client-readable). SECURITY DEFINER, but visibility-scoped PER
-- ROW via cs_can_see_business — Support still sees only messages for customers assigned to them,
-- exactly like the table's RLS. Supports a search term (subject / business / recipient) and a status
-- filter.
--
-- APPLY TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu), where cs_customer_message lives.

create or replace function public.cs_message_log(
  p_search text default null,
  p_status text default null,
  p_limit  int  default 200
)
returns table (
  id              uuid,
  business_id     uuid,
  business_name   text,
  to_email        text,
  subject         text,
  template_key    text,
  status          text,
  error           text,
  created_at      timestamptz,
  created_by      uuid,
  created_by_name text
)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select
    m.id, m.business_id, b.name, m.to_email, m.subject, m.template_key, m.status, m.error, m.created_at,
    m.created_by,
    coalesce(pr.owner_name, au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name', au.email)::text
  from public.cs_customer_message m
  join public.businesses b on b.id = m.business_id
  left join auth.users au on au.id = m.created_by
  left join public.profiles pr on pr.id = m.created_by
  where public.cs_can_see_business(m.business_id)                     -- same visibility as the table RLS
    and (p_status is null or p_status = '' or m.status = p_status)
    and (
      p_search is null or p_search = ''
      or m.subject ilike '%' || p_search || '%'
      or b.name    ilike '%' || p_search || '%'
      or m.to_email ilike '%' || p_search || '%'
    )
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end $$;

revoke all on function public.cs_message_log(text, text, int) from public, anon;
grant execute on function public.cs_message_log(text, text, int) to authenticated;
