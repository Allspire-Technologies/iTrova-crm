-- Fix the empty Messages log. The log row is written by the send-customer-email Edge Function using
-- the SERVICE ROLE. The table's grants were set for `authenticated` (SELECT only) and never gave
-- `service_role` INSERT, so every write failed with "permission denied for table cs_customer_message"
-- — and because the function swallowed that error the send still looked successful while nothing was
-- logged. Service role bypasses RLS *policies*, but table-level GRANTs still apply.
--
-- Grant service_role exactly what the function needs (insert, and select for the RETURNING). Users
-- still can't write — only `authenticated` SELECT and `service_role` insert/select are granted, so
-- the "writes go only through the Edge Function" invariant holds.
--
-- APPLY TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu).

grant select, insert on public.cs_customer_message to service_role;
