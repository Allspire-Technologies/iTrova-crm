# Changelog

Notable changes to the iTrova CRM (Admin OS). The format follows
[Keep a Changelog](https://keepachangelog.com/); entries are grouped by ship date, newest first.

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
