-- Cross-tenant read access for Admin OS. APPLIED TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- iTrova's RLS scopes every business table to current_business_id(), so a platform admin
-- (who belongs to no tenant) sees nothing. These add PERMISSIVE select policies gated on
-- is_platform_admin(), which are OR-ed with the existing owner/member policies — normal
-- users are completely unaffected. Reads only: admin writes go through service-role Edge
-- Functions, never the browser.

-- Businesses: today only "owners view own business" (auth.uid() = owner_id).
drop policy if exists "platform admins read all businesses" on public.businesses;
create policy "platform admins read all businesses"
  on public.businesses for select
  to authenticated
  using (public.is_platform_admin());

-- Profiles: owner name / phone / last_seen and per-business staff counts.
drop policy if exists "platform admins read all profiles" on public.profiles;
create policy "platform admins read all profiles"
  on public.profiles for select
  to authenticated
  using (public.is_platform_admin());

-- plans / plan_prices are already readable by every authenticated user, so the admin
-- can read the plan catalogue without an extra policy.
