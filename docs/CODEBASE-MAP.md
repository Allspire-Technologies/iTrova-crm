# Codebase map: iTrova CRM (Admin OS)

Read this before you start, and again before you commit. It covers where things live and the
flows you keep needing. If it disagrees with the code, the code wins: fix the map in the same
change. If your work changes anything described here, update it in the same commit, so the next
agent inherits what you learned instead of rediscovering it.

The internal staff console: customer success, renewals, referrals, marketing, and the content
consoles for both marketing websites. React + Vite + TypeScript, Tailwind and shadcn/ui, deployed
to Cloudflare Workers. It shares one Supabase project with the app
([iTrova](../../iTrova)): the app owns the operational tables, this repo owns the `cs_*` staff
tables, and both read the same `businesses`, `plans` and `referral_config`.

No customer data reaches the browser raw. Everything cross-tenant goes through a SECURITY DEFINER
RPC that checks the caller is staff.

## Layout

```
src/
  App.tsx              Routes, all behind StaffGate except /login, /no-access, /set-password.
  contexts/            AuthContext: session plus the staff role from cs_my_role().
  pages/               One file per route (18).
  components/
    StaffGate.tsx      is_platform_admin() check; everything else sits inside it.
    cms/
      CollectionTab.tsx   Schema-driven CRUD table + editor. Both content consoles use it.
      EditorShell.tsx     The editor frame it renders into.
    customer/          Sections of the Customer detail page (usage, workflow, plan change).
    states/            Loading, empty and error states.
    ui/                shadcn.
  lib/                 One module per domain (admin, customers, referrals, cs, health, cms...).
  integrations/supabase/
    client.ts          The single Supabase client.
    types.ts           Generated DB types; casts are used where they lag a new migration.
supabase/
  migrations/          57 SQL files, timestamp-named. Applied BY HAND (see "Migrations").
  functions/
    _shared/email-shell.ts   CANONICAL branded email template. The app has a generated copy.
    send-referrer-welcome, resend-activation-email, send-customer-email,
    invite-staff, execute-plan-change
scripts/
  sync-email-shell.mjs Copies the canonical shell into the functions that embed it. Run after editing it.
e2e/                   Playwright specs (18). `e2e/support/` holds the stubs and sign-in helper.
```

## Key flows

### Staff access

`StaffGate` calls `is_platform_admin()`; `cs_my_role()` returns the staff role. Four roles
(`src/lib/roles.ts`): `admin` (Management), `cso`, `pm`, `support`. The helpers there mirror
`cs_role_can_write` in the database purely to gate UI, hiding controls a user could not use
anyway. **The database is the source of truth**; never rely on the client mirror for security.
`settings`, `assignment` and `roles` are admin-only areas.

### Data access: the RPC layer

Every cross-tenant read goes through a SECURITY DEFINER RPC, roughly:

- `admin_*`: aggregates and detail for the Customers screens (`admin_customers_page` paginates,
  filters and sorts entirely in Postgres; `admin_business_aggregates`, `admin_business_profile`,
  `admin_business_usage`, `admin_dashboard_kpis`, `admin_delete_business`, the plan-change pair).
- `cs_*`: the customer-success surface (`cs_referrals`, `cs_referrers_summary`, `cs_my_role`,
  `cs_recompute_business`, messaging and health).
- `my_affiliate_*`: what a signed-in affiliate may see of their own referrals. Called from the
  app, defined here.

Mappers coerce with `num()`/`str()` because Postgres returns bigint/numeric as strings. The
`profiles` table is read directly, allowed by an admin-read RLS policy.

Older production project note: default privileges are not set, so **a table an Edge Function reads
or writes directly as service_role needs an explicit `grant ... to service_role`** in the
migration. Forgetting it surfaces as "permission denied for table X" at runtime, not at deploy
(that is how `cs_referrer` and `referral_config` were caught, in
`20260910095000_referral_service_role_grants.sql`).

Grant only what the runtime role actually touches. A table reached **only** inside a
`SECURITY DEFINER` function needs no grant, because the function runs with its owner's privileges:
`cs_referral_payout` is the example, granted to service_role nowhere and read only through those
functions. Staging cannot reproduce any of this, since it was created after default privileges
were restored.

### Referrals and affiliates

`referral_config` holds the rates and windows (affiliate share, business share, referee discount,
reward window months, payout days, clawback months). `cs_referral_revenue` computes first-year
value per referral: recorded payments win, the plan price is the fallback, and `source` says
which. `_referral_reward()` and `src/lib/referralMath.ts` are mirrors of each other, so a figure
on screen always matches the one in the database.

An affiliate gets a login through `send-referrer-welcome` (`generateLink` with
`invite_token: "affiliate"` so no business is created). Deactivating one fires
`revoke_sessions_on_deactivate`. Bank details lock after the first payout; an admin opens a
72-hour window from the Referrers row menu. A referred business can be hidden from its referrer
(`cs_set_hide_from_referrer`), which anonymises the row on the affiliate's dashboard without
changing what it earns.

### Content consoles

Two pages drive both marketing sites, and both are schema-driven: a `CollectionConfig` (table,
title, blurb, columns, fields, orderBy, rowLabel) is handed to `CollectionTab`, which renders the
list and the editor. Field types: `text | textarea | markdown | number | boolean | image | tags |
select | json`.

- `pages/Website.tsx` → `cms_*` tables → itrova.co ([itrova-website](../../itrova-website)).
- `pages/Allspire.tsx` → `as_*` tables → allspire.tech ([allspire-website](../../allspire-website)).

Adding a collection means adding its table to `AS_TABLES` in `src/lib/allspire.ts` (the union
type both consoles share) as well as writing the config. Legal documents are versioned rows:
one per version with an `effective_at` date, and the site serves the latest one in force.

### Email

`supabase/functions/_shared/email-shell.ts` is the single source of the branded template (Syne +
DM Sans self-hosted at itrova.co/fonts, logo at itrova.co/icon-512.png, VML button for Outlook,
plain-text part via `toPlainText`). Functions embed it rather than importing across the wire, so
after editing it run `node scripts/sync-email-shell.mjs`, then **re-paste every affected
function** into the dashboard. `ITROVA_APP_URL` is a secret and must be https.

### Migrations and functions

**There is no Supabase CLI on this machine and no DB credentials.** Write the migration into
`supabase/migrations/`, hand the SQL to the user, who pastes it in the dashboard. Edge Functions
are pasted whole, so production can drift from the repo: if a function misbehaves in a way the
code does not explain, suspect drift and re-paste. `docs/knowledge/prod-rollout-runbook.md`
(gitignored) carries the order.

Cross-repo order: an iTrova migration adding columns this repo reads is applied first.

## Testing

- `npx playwright test` for `e2e/`. Specs stub network routes; **the last registered route wins**,
  so `stubAuth` registers the `**/rest/v1/**` catch-all first and specific stubs come after.
  `signIn(page, { staff: true, role: "support" })` drives role gating.
- `npx tsc --noEmit -p tsconfig.json` and `npx eslint .` before every PR. A pre-commit hook runs
  eslint and the typecheck.

## Conventions

- The CRM follows the app's layout and UX. Content fills the width (`w-full`), not capped or centred.
- Max three row actions; extras go in a `MoreHorizontal` dropdown.
- Form modals use `DialogContent variant="wide"`; compact is for confirmations only.
- Comment sparingly: brief essential whys, not blocks. Rationale belongs in the PR description.
- `CHANGELOG.md` entry on every ship.
- Branch, commit, PR. Never push to `main`.
- Shells may start in `iTrova`, not here. Use `git -C` or `cd` for CRM work.
