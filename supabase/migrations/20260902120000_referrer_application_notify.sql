-- Affiliate applications: record whether the applicant was emailed the outcome (welcome on
-- approve, decline on reject) so staff can see delivery state in the CRM instead of relying on
-- a transient toast. Written by the send-referrer-welcome Edge Function (service role).
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).

alter table public.cs_referrer_application
  add column if not exists notified_at timestamptz,
  add column if not exists notified_kind text check (notified_kind in ('welcome', 'decline')),
  add column if not exists notify_error text;

-- Grants apply to service_role even though it bypasses RLS policies (lesson from CRM #60).
grant select, update on public.cs_referrer_application to service_role;

notify pgrst, 'reload schema';
