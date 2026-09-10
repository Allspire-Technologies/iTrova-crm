-- Referral tables: the SELECT policies were named "staff read" but their predicate was `using (true)`,
-- so any authenticated user of the shared project (i.e. any iTrova customer, using the anon key that
-- ships in the app bundle) could read every affiliate's bank details, every payout and every
-- applicant's contact details. The predicates now say what the names always claimed.
--
-- Safe to apply: all ten functions that read these tables are SECURITY DEFINER, so they bypass RLS
-- and are unaffected. The website's application form inserts under the separate "application anon
-- insert" policy, which is deliberately left open and is untouched here.

drop policy if exists "referrer staff read" on public.cs_referrer;
create policy "referrer staff read" on public.cs_referrer for select to authenticated
  using (public.cs_my_role() is not null);

drop policy if exists "payout staff read" on public.cs_referral_payout;
create policy "payout staff read" on public.cs_referral_payout for select to authenticated
  using (public.cs_my_role() is not null);

drop policy if exists "application staff read" on public.cs_referrer_application;
create policy "application staff read" on public.cs_referrer_application for select to authenticated
  using (public.cs_my_role() is not null);
