-- Owner activation state for Customer detail: expose auth.users.email_confirmed_at through the
-- existing profile RPC so the CRM can grey out "Resend activation email" once the owner has
-- activated. DROP first — adding a return column changes the return type (42P13).
drop function if exists public.admin_business_profile(uuid);
create or replace function public.admin_business_profile(p_business_id uuid)
returns table (industry text, owner_email text, referred_by_code text, referral_code text, owner_email_confirmed_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select
    coalesce(
      to_jsonb(b) ->> 'industry',
      to_jsonb(b) ->> 'business_type',
      to_jsonb(b) ->> 'category',
      to_jsonb(b) ->> 'sector'
    ) as industry,
    (select au.email::text from auth.users au where au.id = b.owner_id) as owner_email,
    (to_jsonb(b) ->> 'referred_by_code') as referred_by_code,
    (to_jsonb(b) ->> 'referral_code') as referral_code,
    (select au.email_confirmed_at from auth.users au where au.id = b.owner_id) as owner_email_confirmed_at
  from public.businesses b
  where b.id = p_business_id and public.cs_can_see_business(p_business_id);
end $$;
revoke all on function public.admin_business_profile(uuid) from public, anon;
grant execute on function public.admin_business_profile(uuid) to authenticated;
