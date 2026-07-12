-- Fix: the message log never captured who sent it. Every cs_* table has a BEFORE INSERT trigger
-- (cs_set_created_by) that stamps created_by = auth.uid(). But customer emails are logged from the
-- send-customer-email Edge Function using the SERVICE ROLE, where auth.uid() is NULL — so the trigger
-- overwrote the sender the function passed in with NULL. Result: "Sent by" was always blank.
--
-- Make the stamp non-destructive: use auth.uid() when there is one (normal authenticated inserts,
-- unchanged), otherwise keep an explicitly-provided created_by (the service-role log write). This
-- still can't be spoofed by a normal client — when authenticated, auth.uid() always wins.
--
-- APPLY TO THE SHARED iTrova PROJECT (wnuyzsjhijhnhkpcnnqu). Shared by all cs_* tables.

create or replace function public.cs_set_created_by()
returns trigger language plpgsql as $$
begin
  new.created_by = coalesce(auth.uid(), new.created_by);
  return new;
end $$;
