-- Paginate the Messages log. Extend cs_message_log with an offset and a windowed total_count so the
-- page can show "Showing X–Y of N" with prev/next, instead of loading only the most-recent slice.
-- Drop the old 3-arg version first so the new 4-arg one fully replaces it (no ambiguous overload).
--
-- APPLY TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).

drop function if exists public.cs_message_log(text, text, int);

create or replace function public.cs_message_log(
  p_search text default null,
  p_status text default null,
  p_limit  int  default 50,
  p_offset int  default 0
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
  created_by_name text,
  total_count     bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select
    m.id, m.business_id, b.name, m.to_email, m.subject, m.template_key, m.status, m.error, m.created_at,
    m.created_by,
    coalesce(pr.owner_name, au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name', au.email)::text,
    count(*) over()                                                    -- full filtered count (pre-limit)
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
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
end $$;

revoke all on function public.cs_message_log(text, text, int, int) from public, anon;
grant execute on function public.cs_message_log(text, text, int, int) to authenticated;
