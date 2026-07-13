# Changelog

Notable changes to the iTrova CRM (Admin OS). The format follows
[Keep a Changelog](https://keepachangelog.com/); entries are grouped by ship date, newest first.

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
