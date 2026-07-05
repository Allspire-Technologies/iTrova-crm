-- Direct customer email (Management/Admin + Customer Support). APPLIED TO THE SHARED iTrova PROJECT
-- (wnuyzsjhijhnhkpcnnqu).
--
-- Staff send a one-way transactional email to a business's owner from Customer Detail. The send
-- itself runs in the send-customer-email Edge Function (holds the Sender.net API token, verifies the
-- caller is admin/support + — for support — assigned to the business, then logs the result here).
--
-- Two tables:
--   cs_customer_message  — the send log / history + audit trail (read-only to the app; the Edge
--                          Function writes it via service role).
--   cs_email_template    — seeded starter templates with {{merge}} tokens (admin-editable later).

-- ---------------------------------------------------------------------------
-- 1. Message log / history.
-- ---------------------------------------------------------------------------
create table if not exists public.cs_customer_message (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  to_email            text not null,
  to_name             text,
  subject             text not null,
  body                text not null,                 -- rendered HTML that was sent
  template_key        text,                          -- null for a freeform message
  channel             text not null default 'email',
  status              text not null default 'sent' check (status in ('queued', 'sent', 'failed')),
  provider_message_id text,
  error               text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists cs_customer_message_business_idx
  on public.cs_customer_message (business_id, created_at desc);

drop trigger if exists set_updated_at on public.cs_customer_message;
create trigger set_updated_at before update on public.cs_customer_message
  for each row execute function public.cs_set_updated_at();
drop trigger if exists set_created_by on public.cs_customer_message;
create trigger set_created_by before insert on public.cs_customer_message
  for each row execute function public.cs_set_created_by();

-- RLS: staff READ, scoped by business visibility (support sees only assigned customers). Writes go
-- ONLY through the Edge Function (service role, bypasses RLS) — no insert/update/delete grant.
alter table public.cs_customer_message enable row level security;
revoke all on public.cs_customer_message from anon, authenticated;
drop policy if exists "staff read messages" on public.cs_customer_message;
create policy "staff read messages" on public.cs_customer_message for select to authenticated
  using (public.cs_can_see_business(business_id));
grant select on public.cs_customer_message to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Email templates (seeded now; an admin editor comes later).
-- ---------------------------------------------------------------------------
create table if not exists public.cs_email_template (
  key         text primary key,
  name        text not null,
  subject     text not null,
  body        text not null,                          -- HTML with {{merge}} tokens
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.cs_email_template;
create trigger set_updated_at before update on public.cs_email_template
  for each row execute function public.cs_set_updated_at();

-- RLS: any staff reads; only admins write (drives the future editor).
alter table public.cs_email_template enable row level security;
revoke all on public.cs_email_template from anon;
grant select, insert, update, delete on public.cs_email_template to authenticated;
drop policy if exists "staff read templates" on public.cs_email_template;
create policy "staff read templates" on public.cs_email_template for select to authenticated
  using (public.is_platform_admin());
drop policy if exists "admin manage templates" on public.cs_email_template;
create policy "admin manage templates" on public.cs_email_template for all to authenticated
  using (public.cs_is_admin()) with check (public.cs_is_admin());

-- Seed the starter set. Tokens: {{business_name}} {{owner_name}} {{plan}} {{renewal_date}}.
-- Transactional, no-reply copy. Kept as simple HTML (the composer sends whatever ends up here).
insert into public.cs_email_template (key, name, subject, body) values
  ('welcome', 'Welcome / onboarding',
   'Welcome to iTrova, {{business_name}}',
   '<p>Hi {{owner_name}},</p><p>Welcome aboard! Your {{business_name}} account is set up on the {{plan}} plan. We are here to help you get the most out of iTrova — reply to your account manager any time.</p><p>— The iTrova Team</p>'),
  ('renewal_reminder', 'Renewal reminder',
   'Your iTrova plan renews on {{renewal_date}}',
   '<p>Hi {{owner_name}},</p><p>A quick reminder that {{business_name}}''s {{plan}} plan is due to renew on {{renewal_date}}. No action is needed if your details are up to date.</p><p>— The iTrova Team</p>'),
  ('payment_issue', 'Payment issue',
   'Action needed: a payment issue on your iTrova account',
   '<p>Hi {{owner_name}},</p><p>We had trouble processing the latest payment for {{business_name}} ({{plan}} plan). Please review your payment details so your service continues uninterrupted.</p><p>— The iTrova Team</p>'),
  ('check_in', 'Check-in / nudge',
   'How is {{business_name}} getting on with iTrova?',
   '<p>Hi {{owner_name}},</p><p>Just checking in on how things are going with iTrova. If there is anything we can help with, let us know — we are always happy to help.</p><p>— The iTrova Team</p>')
on conflict (key) do nothing;
