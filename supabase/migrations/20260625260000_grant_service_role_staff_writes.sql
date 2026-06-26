-- Let the invite-staff Edge Function add staff. APPLIED TO THE SHARED iTrova PROJECT
-- (wnuyzsjhijhnhkpcnnqu).
--
-- The function runs as the service role AFTER verifying the caller is an admin (cs_is_admin), then
-- upserts the new user into platform_admins + cs_staff_role. The service role bypasses RLS but
-- still needs table-level GRANTs — platform_admins was created with none (membership was
-- "service-role managed"), so PostgREST returns "permission denied for table platform_admins".
-- Granting the service role here makes that explicit. (No grant to anon/authenticated — they
-- still can't touch platform_admins; cs_staff_role writes remain admin-only via its RLS.)

grant select, insert, update on public.platform_admins to service_role;
grant select, insert, update on public.cs_staff_role  to service_role;
