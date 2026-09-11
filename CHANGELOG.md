# Changelog

Notable changes to the iTrova CRM (Admin OS). The format follows
[Keep a Changelog](https://keepachangelog.com/); entries are grouped by ship date, newest first.

## 2026-09-11: Affiliate dashboard data (Phase 2, CRM side)

### Added

- **The functions behind the affiliate dashboard.** `my_affiliate_summary`, `my_affiliate_referrals`
  and `my_affiliate_payouts` give a signed-in affiliate their own earned, paid and outstanding
  figures, each referred business with its owner email and a Signed up / Paying / Lapsed status, and
  their payout history. They read the same `cs_referral_revenue` view and reward function the
  Referrers tab uses, so an affiliate can never see a figure that differs from the CRM's.
- **Affiliates can set their own bank details** with `my_affiliate_update_bank`, editable until the
  first payout and locked after it. Every save writes a masked row to `cs_referrer_bank_change`.
- **Unlock bank details** on the Referrers row menu (affiliates with a payout): opens a 72-hour window
  in which the affiliate can edit their details from the dashboard. The window closes on its own.

### Changed

- The three email functions pick up an entity-decoding fix in the shared shell's plain-text part
  (arrows, quotes and symbols in the text version). Re-paste all three.

## 2026-09-10: Affiliate dashboard logins (Phase 1)

### Added

- **Affiliates can be given a login to the iTrova affiliate dashboard.** Approving an application
  now creates the login and the welcome email carries a Set your password button. Adding an affiliate
  manually does the same. On the Referrers tab an **Access** column shows No login, Invited or
  Active, and the row menu offers **Create login** for existing affiliates and **Resend sign-in
  link** for invited ones, which sends a short "your dashboard is ready" email.
- **Sign-in is by email and password.** The referral code is for sharing, not for signing in, and
  the email says so. No password is ever emailed: the link lets the affiliate choose their own.
- **Deactivating an affiliate signs them out immediately** and blocks them at the next sign-in.
  Migration `20260910100000_affiliate_access.sql` links `cs_referrer` to an auth account, adds the
  affiliate's own `my_affiliate_profile()`, the staff-only `cs_affiliate_access()` behind the badge,
  and a trigger that clears the affiliate's sessions when `active` turns off.

### Changed

- **An affiliate's email is locked once a login exists,** because it is now their sign-in address.
  Correct it before creating the login; a deliberate change-address action follows in Phase 3.

## 2026-09-10: Branded transactional email

### Changed

- **Every email iTrova sends now looks like iTrova.** Affiliate welcomes and declines, the customer
  activation link and admin-composed customer emails share one branded template: the logo and
  wordmark, brand green, a real call-to-action button that survives Outlook, and the referral code
  set in a highlighted panel. Brand fonts load where the email client allows it and fall back to a
  clean system stack everywhere else, so nothing looks broken in Gmail.
- **Each email now carries a plain-text part as well as HTML.** Sending HTML alone is a well known
  spam signal, so this should help messages reach the inbox, and it gives screen readers something
  sensible to read.
- **Emailed links follow `ITROVA_APP_URL`** instead of a hardcoded address, defaulting to the
  production app. The function refuses a non-https value, because these links carry sign-in tokens.

### Fixed

- **An affiliate can no longer be emailed programme terms that were not read from the database.**
  The welcome email used to fall back to 25% and 20% if the referral settings could not be read,
  which risked promising an affiliate a share that did not match the programme. It now refuses to
  send instead.
- **The affiliate welcome email now sends on production.** Adding a referrer failed with
  "permission denied for table cs_referrer": the referral tables predate the migration that restored
  `service_role` default privileges, so on the older production project the email function had
  never been granted access to them. Staging cannot reproduce this. Migration
  `20260910095000_referral_service_role_grants.sql` names the grants explicitly, matching how every
  other table the email functions touch is already handled.

### Added

- `scripts/sync-email-shell.mjs` copies the shared email template into each function from one
  canonical source, with a `--check` mode. Functions are deployed by pasting single files, so three
  hand-maintained copies would drift; this makes them identical by construction.

## 2026-09-10: Referral tables restricted to staff

### Fixed

- **Affiliate bank details, payouts and applications are no longer readable by customers.** The
  SELECT policies on `cs_referrer`, `cs_referral_payout` and `cs_referrer_application` were named for
  staff but their condition was an unconditional true, so any signed-in user of the shared Supabase
  project could read them. They now require a platform staff role. No behaviour changes in the CRM,
  which reads these tables as staff, and the website's affiliate application form is unaffected
  because it inserts under a separate anonymous policy.

## 2026-09-08: Resend activation email from Customer detail

### Added

- **Resend activation email.** Customer detail has a header action that emails the business owner a
  fresh activation link while their account is still unactivated. It greys out once the owner has
  activated (hover shows the date), sits behind the same gate as customer emails (Management/Admin,
  or Support assigned to the business), waits a minute between sends, and every send lands in the
  customer's message history without the link itself. The Email field now shows an Activated or
  Not activated badge.

## 2026-09-04: CMS images optimised on upload

### Changed

- **Website and Allspire consoles.** Every raster image uploaded (blog covers, client logos, case-study covers,
  team and testimonial photos, facilitator photo) is downscaled to 1600px and re-encoded as WebP in the
  browser before it reaches storage. A 313 kB PNG cover becomes about 46 kB. SVGs pass through; an image
  that would not get smaller is kept as uploaded.

## 2026-09-03 — Allspire website console

### Added

- New **Allspire** page (staff nav) for the content allspire.tech renders: client logos, stats, case
  studies (markdown story, cover image), testimonials, team members, keyed page copy and the single
  webinar record. Every collection has a draft/published toggle; the site reads published rows only
  and hides each section until something is published. Admin-only writes; other staff can view.
- One schema-driven editor (`CollectionTab`) powers all seven tabs, with image upload to
  `cms-media/allspire/`, an em-dash guard on text fields and a typed confirmation before delete.

### Notes

- Migration `20260903110000_allspire_cms.sql` adds the `as_*` tables (separate from iTrova's
  `cms_*`), RLS (public read of published rows, admin write) and seeds the webinar record from the
  programme that is live today. Apply to staging, then production.

## 2026-09-02 — Affiliate applications: outcome emails, delivery status, delete

### Added

- **Reject emails the applicant** a polite decline (approve already emailed the welcome). Both
  actions now ask for confirmation first, since they email and can't be undone.
- **Email column on Applications** shows whether the outcome email was delivered ("Welcome sent",
  "Decline sent", "Failed: reason", or "No email on file"), with a **Send email** retry that reuses
  the same idempotency key so a provider that already delivered replays instead of double-sending.
- **Delete affiliate** (Referrers → edit): allowed only when the affiliate has no referred businesses
  and no payouts, behind a type-the-code confirmation. With history, the button explains and points
  to Deactivate so attribution and payout records stay intact.

### Notes

- One migration (`20260902120000`) adds `notified_at` / `notified_kind` / `notify_error` to
  `cs_referrer_application` (plus the service_role grant); re-deploy `send-referrer-welcome`, which
  gains the decline path and stamps the outcome. The website's affiliate form now requires an email.

## 2026-09-02 — Website content console

### Added
- New **Website** page (staff nav) for the itrova marketing site's content: What's new entries,
  blog posts (markdown, cover-image upload), testimonials and page-copy overrides, each with a
  draft/published toggle. Only published rows are visible to the public site; publishing needs
  the admin role. Blog covers upload to the new `cms-media` storage bucket (5 MB, images only).
- **Guide tab** — edit the site's user guide section by section: numbered steps with optional
  notes (reorder or remove), screenshots with upload and required alt text, role visibility, and
  a slug picker of the 18 built-in sections. Matching a built-in slug overrides that section on
  the site; a new slug adds one; deleting an override restores the built-in copy.

### Fixed
- Typing in the blog editor no longer snaps the caret back to the Title field.

## 2026-07-25 — Deleting a business removes its users

### Changed
- **Admin → Delete business** now also deletes the auth accounts of the business's **owner and staff**
  (previously they were left as orphaned logins). Their profiles are removed too, so no one is left
  able to sign in to a deleted business, and the freed emails can register a new business.

### Notes
- One migration on the shared iTrova project re-declares `admin_delete_business` to collect the
  business's users (owner + `user_roles` members) before the delete and remove their `auth.users`
  rows after it. The business/data deletion is unchanged.

## 2026-07-31 — Marketing: AI social calendar + one-tap sharing

Draft a month of social posts with free AI models, approve them, and share to your
already-logged-in accounts — no platform APIs, no paid subscriptions.

### Added
- **Marketing page** — a monthly content calendar (3–4 posts/week: Mon/Wed/Fri + alternating
  Saturdays, future dates only) with draft → approved → posted tracking.
- **Generate month** — drafts every open slot using a **free-tier cloud model** of your choice
  (Google Gemini, Groq/Llama, or OpenRouter free models). Keys are free to create and stored once
  for the whole team in AI settings (admin-only). Posts rotate pillars: SMB tips, features,
  referral, offers, stories — Nigerian-market tone, ending with the product link.
- **Share menu per post** — opens the platform's compose window on the account you're already
  logged into: X and WhatsApp arrive with the caption prefilled; Facebook/LinkedIn carry the link
  (caption auto-copied to paste); on mobile, **Share with image** hands the branded card + caption
  to any app, including Instagram. Every share is recorded on the post.
- **Branded card images** — each post renders a 1080×1080 iTrova card from its hook line
  (downloadable, editable in the post dialog).

### Notes
- One migration: `cs_social_post` + `cs_settings.marketing_ai`. Nothing auto-posts — you always
  press the platform's own Post button.

## 2026-07-22 — Referrals module

Track who refers new businesses, what each referral is worth, and pay it out.

### Added
- **Referrals page** with a **Referrers** tab covering everyone who refers: affiliates and staff from
  the registry **plus** businesses that generated their own code — each with referrals made, earned,
  and **accrued** balance.
- **Applications queue** — affiliate signups from the website. **Approve** now auto-creates the
  affiliate (with a suggested `name + last-4-phone` code) and emails them their details.
- **Payouts** — **Mark paid** records a cash payout to an affiliate or staff member; **Apply credit**
  puts a referring business's accrued balance toward their iTrova subscription, auto-extending their
  renewal by whole plan-months (any remainder stays as credit). Both open a confirm dialog with an
  editable amount defaulting to the full accrued balance.
- **Program settings** — separate share rates for **affiliates** (paid as cash) and **business
  referrers** (subscription credit), the referee first-payment discount, and the staff per-conversion
  bonus (SPIFF). Nothing is hardcoded.

### Notes
- One migration on the shared iTrova project adds the referrer registry, applications, payout ledger,
  and the summary/payout/earnings functions. Apply the iTrova migration first, then this one.
- Adds `my_referee_discount()` so iTrova can auto-apply a referred business's first-payment discount —
  it validates the referral code against the registry (or another business's own code) server-side.

## 2026-07-14 — Fix: deleting a business with sales or ledger data

### Fixed
- **Admin → Delete business** failed with a foreign-key error (`sale_items_product_id_fkey`) for any
  business that had recorded sales — and would have failed on ledger data next. The delete now clears
  the two non-cascading references (sale items and journal lines) before removing the business, so a
  business with full trading and accounting history deletes cleanly.

### Notes
- One migration on the shared iTrova project re-declares `admin_delete_business` (already applied).
- Deliberately fixed in the delete-business path only — product and ledger references stay protected,
  so a normal product or account deletion still can't wipe sale history or journal lines.

## 2026-07-12 — Messages

A place to see and send customer emails across your whole book of business — not just one customer at
a time.

### Added
- **Messages page** — a central log of **every customer email** sent from the CRM, newest first. Each
  row shows the **customer, recipient, subject, who sent it and the status** (sent / failed), and links
  straight to that customer. **Search** by subject, customer or recipient and **filter by status**.
- **Pagination** — the log is paged (50 at a time) with **Prev / Next** and a **"Showing X–Y of N"**
  count, so it stays fast as it grows. Searching or changing the filter jumps back to the first page.
- **Send message (bulk)** — compose one message and send it to **many customers at once**. It's the
  same composer as a customer's Messages tab (pick a **template** or write freeform, subject + rich
  text), and each recipient's email is **personalised with their own details** (`{{owner_name}}`,
  `{{business_name}}`, `{{plan}}`, `{{renewal_date}}`). Two ways in:
  - a **Send message** button on the Messages page, with a **searchable recipient picker**;
  - a **Send message** bulk action on the **Customers** page that pre-fills the customers you've ticked.
- **"Sent by" on the per-customer log** — the customer's Messages tab now shows which staff member sent
  each email.

### Fixed
- **Customer emails weren't being recorded.** Sends showed as successful but nothing appeared in the
  log, because the log table never granted the send function permission to write to it. Emails now log
  correctly, and a failed log write is surfaced in the function logs instead of being swallowed.
- **The sender is now captured** — a trigger was blanking "who sent it" on emails logged by the send
  function; it now keeps the real sender.

### Notes
- Sending is unchanged: still one-way transactional email via the `send-customer-email` function, and
  still limited to **Management / Admin** and **Support** (Support only sees and messages customers
  assigned to them). The whole module is visibility-scoped the same way as the rest of the CRM.
- **For operators (shared iTrova project `wnuyzsjhijhnhkpcnnqu`):** redeploy `send-customer-email`, and
  apply the migrations `20260712100000` → `20260712110000` → `20260712120000` → `20260712130000` →
  `20260712140000` (sender RPC, message-log RPC, sender-trigger fix, the service‑role INSERT grant, and
  pagination).
