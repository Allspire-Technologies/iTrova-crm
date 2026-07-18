-- WhatsApp customer messaging. Staff can message a customer on WhatsApp using the number on their
-- account (whatsapp_number, falling back to the owner phone). Delivery is a wa.me deep link opened
-- client-side (no provider integration), so we log the send as 'opened' — we can't confirm delivery.
-- Templates are the SAME cs_email_template prompts, rendered to plain text in the browser.
--
-- The cs_customer_message table already has a `channel` column; this makes the email-only columns
-- optional for WhatsApp, adds a phone recipient + an 'opened' status, a staff-gated logging RPC,
-- and teaches both read RPCs (per-customer + central log) to return channel + phone.

alter table public.cs_customer_message add column if not exists to_phone text;
alter table public.cs_customer_message alter column to_email drop not null;  -- WhatsApp has no email
alter table public.cs_customer_message alter column subject  drop not null;  -- WhatsApp has no subject

-- 'opened' = a wa.me link was opened for this message (delivery unconfirmed).
alter table public.cs_customer_message drop constraint if exists cs_customer_message_status_check;
alter table public.cs_customer_message
  add constraint cs_customer_message_status_check check (status in ('queued', 'sent', 'failed', 'opened'));

-- Log a WhatsApp send. Same authorisation as the email path: the caller must see the business AND
-- be an admin or support staff member. Client-written (no Edge Function in the wa.me flow), so it's
-- a SECURITY DEFINER RPC rather than a direct insert.
create or replace function public.cs_log_whatsapp(
  p_business_id  uuid,
  p_to_phone     text,
  p_to_name      text,
  p_body         text,
  p_template_key text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.cs_can_see_business(p_business_id) or public.cs_my_role() not in ('admin', 'support') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.cs_customer_message (business_id, channel, to_phone, to_name, body, template_key, status, created_by)
  values (p_business_id, 'whatsapp', p_to_phone, p_to_name, coalesce(p_body, ''), p_template_key, 'opened', auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.cs_log_whatsapp(uuid, text, text, text, text) from public, anon;
grant execute on function public.cs_log_whatsapp(uuid, text, text, text, text) to authenticated;

-- Re-declare cs_customer_messages (last set in 20260712100000): same, + channel + to_phone.
-- DROP first — adding columns changes the return type, which create-or-replace can't do.
drop function if exists public.cs_customer_messages(uuid);
create or replace function public.cs_customer_messages(p_business_id uuid)
returns table (
  id             uuid,
  business_id    uuid,
  channel        text,
  to_email       text,
  to_phone       text,
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
  if not public.cs_can_see_business(p_business_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select
    m.id, m.business_id, m.channel, m.to_email, m.to_phone, m.subject, m.template_key, m.status, m.error, m.created_at,
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

-- Re-declare cs_message_log (last set in 20260712140000): same, + channel + to_phone (search also
-- matches the phone). WhatsApp rows have null subject/to_email; the client renders per channel.
-- DROP first — adding columns changes the return type.
drop function if exists public.cs_message_log(text, text, int, int);
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
  channel         text,
  to_email        text,
  to_phone        text,
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
    m.id, m.business_id, b.name, m.channel, m.to_email, m.to_phone, m.subject, m.template_key, m.status, m.error, m.created_at,
    m.created_by,
    coalesce(pr.owner_name, au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name', au.email)::text,
    count(*) over()
  from public.cs_customer_message m
  join public.businesses b on b.id = m.business_id
  left join auth.users au on au.id = m.created_by
  left join public.profiles pr on pr.id = m.created_by
  where public.cs_can_see_business(m.business_id)
    and (p_status is null or p_status = '' or m.status = p_status)
    and (
      p_search is null or p_search = ''
      or m.subject  ilike '%' || p_search || '%'
      or b.name     ilike '%' || p_search || '%'
      or m.to_email ilike '%' || p_search || '%'
      or m.to_phone ilike '%' || p_search || '%'
    )
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
end $$;
revoke all on function public.cs_message_log(text, text, int, int) from public, anon;
grant execute on function public.cs_message_log(text, text, int, int) to authenticated;

notify pgrst, 'reload schema';
