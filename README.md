# iTrova Admin OS — CRM / Customer Success Dashboard

Internal, **staff-only** Admin Operating System for iTrova. It reads iTrova's operational data
across **all** tenants and layers customer-success workflow (health, alerts, pipeline, tasks,
notes/tickets) on top. It runs as a **separate app** against the **same Supabase project** as
iTrova — using the **publishable (anon) key only**; the service-role key is never in the browser.

- **Stack:** React 18 + TypeScript + Vite + Tailwind + Radix/shadcn, react-router. Supabase
  (Postgres + Auth + RLS + pg_cron). Deployed on Cloudflare Workers (`itrova-crm`).
- **Shared project ref:** `wnuyzsjhijhnhkpcnnqu` (the iTrova Supabase project).

---

## 1. Local development

```bash
npm install
cp .env.example .env.local      # then fill in the publishable key
npm run dev                     # http://localhost:8090
```

`.env.local` (publishable/anon key only — see [.env.example](.env.example)):

```
VITE_SUPABASE_URL=https://wnuyzsjhijhnhkpcnnqu.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<the project's publishable/anon key>
```

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build` | Production build (runs typecheck first) |
| `npm run e2e` | Playwright e2e (builds + serves on :8090, all reads mocked) |
| `npm run deploy` | Build + `wrangler deploy` to Cloudflare |

CI (GitHub Actions) runs **Lint & types** and **Playwright e2e** on every PR.

---

## 2. Database setup (one-time)

All schema lives in [`supabase/migrations/`](supabase/migrations) and targets the **shared iTrova
project**. Apply them **in filename order** — each is idempotent and additive, and several seed or
backfill data at the end.

Apply with the Supabase CLI:

```bash
supabase link --project-ref wnuyzsjhijhnhkpcnnqu
supabase db push
```

…or paste each file, in order, into the Supabase **SQL editor**.

| # | Migration | Adds |
|---|---|---|
| 1 | `..090000_platform_admins` | `platform_admins` + `is_platform_admin()` — the staff gate |
| 2 | `..100000_admin_read_rls` | platform-admin read policies on `businesses` / `profiles` |
| 3 | `..110000_subscriptions` | `subscriptions` table |
| 4 | `..120000_admin_aggregates` | `mv_business_aggregates` + staff-gated aggregate RPCs + 5-min cron |
| 5 | `..130000_fix_admin_kpis_result_type` | KPI result-type fix |
| 6 | `..140000_cs_tables` | the `cs_*` CRM tables (RLS staff-only) |
| 7 | `..150000_cs_health_engine` | `cs_settings`, `cs_score`/`cs_compute_health`, `cs_health_current`, nightly cron |
| 8 | `..160000_cs_alert_engine` | `cs_alert_rules`/`cs_eval_alerts*`, dedup + auto-resolve |
| 9 | `..170000_cs_nightly_consolidation` | single `cs_nightly()` job + `cs_alert_active` view |
| 10 | `..180000_admin_customers_page` | server-side `admin_customers_page` / facets / staff list |
| 11 | `..190000_business_detail` | `admin_business_profile` + `admin_business_usage` |
| 12 | `..200000_cs_pipeline_derivation` | `cs_auto_stage`/`cs_derive_pipeline`, `admin_pipeline_board` |
| 13 | `..210000_cs_pipeline_rules_align` | pure, testable `cs_pipeline_stage()` per §7.6 |
| 14 | `..220000_cs_task_assignee_role` | `cs_task.assignee_role` + `cs_task_admin` view |
| 15 | `..230000_admin_health_trend` | `admin_health_trend()` for the Home chart |
| 16 | `..240000_staff_roles` | `cs_staff_role` + capability helpers + role-aware `cs_*` RLS (§3) |
| 17 | `..250000_role_scoped_reads` | role-scope the read RPCs (Support → assigned) + gate revenue |
| 18 | `..627110000_subscriptions_active_for_all` | active `subscriptions` row for every business (incl. Free), via backfill + new-business trigger |
| 19 | `..627120000_assignable_staff_name` | `admin_list_staff()` prefers the invitee's entered name over the `'Staff'` profile placeholder |
| 20 | `..627130000_subscription_renewal_sync` | sync `subscriptions` (incl. `current_period_end` renewal) from `businesses.subscription_*` on insert/update |
| 21 | `..627150000_account_manager_name` | `admin_customers_page` / `admin_pipeline_board` prefer the manager's entered name over the `'Staff'` placeholder |
| 22 | `..627160000_cs_leads` | `cs_lead` — standalone prospects for the pipeline's Lead column (decoupled from businesses); frees any business pinned to `lead` |

### Seed the first internal admin

The dashboard is invisible to anyone **not** in `platform_admins`. Add yourself once (the user must
already exist in `auth.users`, i.e. have signed in to Supabase Auth at least once):

```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'you@allspire.tech'
on conflict do nothing;
```

New users seeded this way default to the **admin** role; change it in **Settings → Roles**. To revoke access, delete their `platform_admins` row.

### Adding more staff (in-app invites)

Once the first admin exists, staff are added from **Settings → Roles → Invite a staff member** — no SQL. It generates a link the admin copies and sends; the invitee opens it, sets their name + password on `/set-password`, and they're in with the chosen role. This needs the invite Edge Function and one Auth setting:

```bash
supabase functions deploy invite-staff      # holds the service-role key server-side
```

- The function uses the auto-provided `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — nothing extra to configure.
- Add your app's `…/set-password` to **Auth → URL Configuration → Redirect URLs** so the invite link is allowed to land there.
- No email/SMTP is required (the link is generated and copied, not emailed). If you later want it auto-emailed, switch the function from `generateLink` to `inviteUserByEmail` and configure SMTP.

### Verify the engines (optional)

Pure rule functions have crafted-input SQL tests in [`supabase/tests/`](supabase/tests) — run each
in the SQL editor after applying migrations; they `raise notice` on pass and `assert` on mismatch:

- `cs_health_engine_test.sql` (§7.3 scoring + bands + trip-wires)
- `cs_alert_engine_test.sql` (§7.5 four rules + renewal escalation)
- `cs_pipeline_rules_test.sql` (§7.6 stage derivation)
- `cs_staff_roles_test.sql` (§3 capability matrix)

---

## 3. Scheduled jobs (pg_cron, already scheduled by the migrations)

| Job | Schedule | Does |
|---|---|---|
| `refresh_business_aggregates` | every 5 min | `refresh materialized view concurrently mv_business_aggregates` |
| `cs_nightly` | `0 2 * * *` (02:00 UTC) | health snapshots → alert evaluation → pipeline derivation |

On-demand equivalents are exposed as staff-gated RPCs (e.g. **Recompute health** and
**Re-evaluate alerts** on a customer's detail page; **Refresh** on the pipeline board).

---

## 4. Tuning without a deploy

All thresholds (login 7/14/30d, no-sales windows, renewal window, health-score cutoffs) live in the
single `cs_settings` row, which the engine reads on every compute. Edit them in-app at
**Settings → Health & alert thresholds**, or directly:

```sql
update public.cs_settings set login_red_days = 21, band_green_min = 75 where singleton;
```

Changes apply on the next nightly snapshot or any on-demand recompute — no redeploy.

---

## 5. Security model

- **Staff gate:** `StaffGate` → `is_platform_admin()` (a `SECURITY DEFINER` check against
  `platform_admins`). No session → `/login`; signed-in non-staff → `/no-access`.
- **Cross-tenant reads** go only through `SECURITY DEFINER` RPCs / `security_invoker` views that
  re-check `is_platform_admin()`. The `mv_business_aggregates` matview is **not** directly readable.
- **`cs_*` tables** have RLS restricting all access to staff; author/`created_by` is stamped
  server-side from `auth.uid()` (tamper-proof audit).
- **No service-role key in the browser** — the client uses the publishable key only.

---

## 6. Deploy

**Auto-deploy:** every green push to `main` deploys to Cloudflare Workers (CI `deploy` job, after
lint/types + e2e pass). Manual deploy is still `npm run deploy` (build + `wrangler deploy`, served at
the SPA root). Config: [`wrangler.jsonc`](wrangler.jsonc).

The CI deploy stays a no-op (CI green) until these **repo secrets** are set
(Settings → Secrets and variables → Actions):

| Secret | What |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token with the *Edit Cloudflare Workers* permission |
| `CLOUDFLARE_ACCOUNT_ID` | the Cloudflare account id |
| `VITE_SUPABASE_URL` | `https://wnuyzsjhijhnhkpcnnqu.supabase.co` (build-time) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the project's publishable/anon key (build-time) |

**Cache busting:** the build stamps the service worker (`public/sw.js`) with the commit SHA
(`scripts/stamp-sw.mjs`), so each deploy gets a new cache name and the SW's `activate` handler purges
the previous deploy's cache. Combined with content-hashed asset filenames and the network-first HTML
strategy, users always get the new build on their next visit — no manual cache clearing.

---

## 7. Known follow-ups

- **`businesses.industry`** is read defensively (`industry | business_type | category | sector`)
  because the real column name wasn't confirmed against the live schema. If Industry shows "—"
  everywhere, pin the real column in `admin_customers_page` / `admin_business_profile`.
- **Staff roles** (PM / CSO / Support) are currently *labels* on tasks and a reference matrix in
  Settings — every internal user has full staff access. Per-user enforcement needs a staff-roles
  table + gating.
