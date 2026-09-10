-- service_role grants for the referral tables the email function reads.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- Symptom on production: send-referrer-welcome fails with "permission denied for table
-- cs_referrer". Same mechanism as 20260810120000_service_role_payment_grants in the iTrova repo:
-- these tables were created before that migration restored the default privileges, so on the
-- older production project service_role never received a grant on them. Staging cannot reproduce
-- it. Grants apply to service_role even though it bypasses RLS policies.
--
-- cs_referrer_application already has its grant (20260902120000). cs_referral_payout is only read
-- through SECURITY DEFINER functions, so it needs none. update on cs_referrer is for the affiliate
-- login link (user_id) the same function is about to start writing.

grant select, update on public.cs_referrer   to service_role;
grant select         on public.referral_config to service_role;
