import type { Page, Route } from "@playwright/test";

export const FAKE_USER = {
  id: "11111111-1111-1111-1111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "staff@allspire.tech",
  app_metadata: { provider: "email" },
  user_metadata: {},
};

const FAKE_JWT = "header.payload.signature";

export const SESSION_BODY = {
  access_token: FAKE_JWT,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 9_999_999_999,
  refresh_token: "fake-refresh",
  user: FAKE_USER,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/**
 * Stub the Supabase Auth + the is_platform_admin RPC so the staff gate can be exercised
 * deterministically. `staff` decides what is_platform_admin() returns.
 */
export async function stubAuth(page: Page, opts: { staff: boolean; role?: string }) {
  await page.route("**/auth/v1/token**", (r) => json(r, SESSION_BODY));
  await page.route("**/auth/v1/user**", (r) => json(r, FAKE_USER));
  // Safety net for any other PostgREST call — registered FIRST so the specific RPC
  // routes below (registered last) win (Playwright = last match wins).
  await page.route("**/rest/v1/**", (r) => json(r, []));
  await page.route("**/rest/v1/rpc/is_platform_admin**", (r) => json(r, opts.staff));
  // The staff role (PRD §3). Defaults to admin so existing tests keep full access.
  await page.route("**/rest/v1/rpc/cs_my_role**", (r) => json(r, opts.staff ? opts.role ?? "admin" : null));
}

// One business with an owner and an active subscription, used to drive the Customers
// screens. Register AFTER stubAuth so these win over the catch-all (last match wins).
export const CUSTOMER = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  name: "Mama Put Foods",
  currency: "NGN",
  subscription_tier: "pro",
  owner_id: "bbbbbbbb-0000-0000-0000-000000000002",
  created_at: "2026-01-15T10:00:00Z",
  timezone: "Africa/Lagos",
  whatsapp_number: "+2348100000000",
};

const OWNER = { id: CUSTOMER.owner_id, owner_name: "Ada Obi", phone: "+2348100000000", last_seen: null };

// One row of the admin_business_aggregates RPC (snake_case, as PostgREST returns it).
const AGG = {
  business_id: CUSTOMER.id,
  name: CUSTOMER.name,
  currency: "NGN",
  timezone: CUSTOMER.timezone,
  whatsapp_number: CUSTOMER.whatsapp_number,
  owner_id: CUSTOMER.owner_id,
  owner_name: OWNER.owner_name,
  plan_key: "pro",
  subscription_status: "active",
  subscription_amount: 5000,
  subscription_cycle: "monthly",
  subscription_started: CUSTOMER.created_at,
  renewal_date: null,
  joined_at: CUSTOMER.created_at,
  total_users: 1,
  active_users: 1,
  last_login: null,
  products_total: 12,
  products_added_30d: 3,
  products_low_stock: 2,
  stock_movements: 5,
  purchase_orders: 4,
  sales_count: 20,
  revenue_recorded: 150000,
  orders_count: 6,
};

const KPI = {
  total_businesses: 1,
  active_subscriptions: 1,
  new_this_month: 0,
  mrr: 5000,
  currency: "NGN",
  total_revenue: 150000,
  total_sales: 20,
  total_products: 12,
};

// Current health band (cs_health_current view) — red, so the business is at risk.
// reasons mirror the real cs_score output: five scoring factors + trip-wire/warning flags.
const HEALTH = {
  business_id: CUSTOMER.id,
  score: 30,
  band: "red",
  reasons: [
    { rule: "login_recency", points: 10, days: 12 },
    { rule: "inventory_setup", points: 20, products: 14 },
    { rule: "sales_activity", points: 0, days: null },
    { rule: "user_adoption", points: 0, active_users: 0 },
    { rule: "renewal_posture", points: 0, status: "expired" },
    { rule: "trip_wire", detail: "no login in 21 days" },
    { rule: "warning", detail: "no sales in 30 days" },
  ],
  captured_at: CUSTOMER.created_at,
};

// Customer Detail (§7.4) fixtures.
const PROFILE_EXTRA = { industry: "Food & Beverage", owner_email: "ada@mamaput.example" };
const USAGE = {
  products_total: 12, products_30d: 3, products_90d: 7,
  sales_total: 20, sales_30d: 5, sales_90d: 14,
  revenue_total: 150000, revenue_30d: 40000, revenue_90d: 110000,
  stock_total: 5, stock_30d: 1, stock_90d: 3,
  po_total: 4, po_30d: 1, po_90d: 2,
  orders_total: 6, orders_30d: 2, orders_90d: 4,
};
const PIPELINE = { business_id: CUSTOMER.id, stage: "onboarding", stage_source: "auto", created_at: CUSTOMER.created_at, updated_at: CUSTOMER.created_at };
const BIZ_ALERT = {
  id: "eeeeeeee-0000-0000-0000-000000000005",
  business_id: CUSTOMER.id,
  kind: "churn",
  severity: "critical",
  detail: "No login for 21 days",
  status: "active",
  acknowledged_by: null,
  created_at: CUSTOMER.created_at,
  updated_at: CUSTOMER.created_at,
  resolved_at: null,
};
const HEALTH_SNAPSHOT = {
  id: "ffffffff-0000-0000-0000-000000000006",
  business_id: CUSTOMER.id,
  score: 42,
  band: "yellow",
  reasons: ["Recomputed now"],
  captured_at: CUSTOMER.created_at,
  created_at: CUSTOMER.created_at,
  updated_at: CUSTOMER.created_at,
};

// Internal staff member (candidate account manager), from admin_customers_facets / admin_list_staff.
export const MANAGER = { id: "dddddddd-0000-0000-0000-000000000004", name: "Sade Bello" };

// One row of the admin_customers_page RPC (snake_case, includes the window total_count).
export const PAGE_ROW = {
  business_id: CUSTOMER.id,
  name: CUSTOMER.name,
  industry: "Food & Beverage",
  plan_key: "pro",
  subscription_status: "active",
  joined_at: CUSTOMER.created_at,
  products_total: 12,
  sales_count: 20,
  total_users: 1,
  last_login: null,
  renewal_date: null,
  health_score: 30,
  health_band: "red",
  account_manager_id: null,
  account_manager_name: null,
  owner_name: "Ada Obi",
  total_count: 1,
};

const FACETS = { plans: ["pro"], industries: ["Food & Beverage"], managers: [MANAGER] };

// An open churn alert (cs_alert_active view) — drives the Home at-risk list.
const ALERT = {
  id: "cccccccc-0000-0000-0000-000000000003",
  business_id: CUSTOMER.id,
  business_name: CUSTOMER.name,
  kind: "churn",
  severity: "critical",
  detail: "no login for 30 days",
  status: "active",
  acknowledged_by: null,
  created_at: CUSTOMER.created_at,
  updated_at: CUSTOMER.created_at,
  resolved_at: null,
};

// Health trend (admin_health_trend) + per-business snapshot history (cs_health_snapshot).
const HEALTH_TREND = [
  { day: "2026-06-10", at_risk: 5, yellow: 8, green: 20, total: 33 },
  { day: "2026-06-17", at_risk: 4, yellow: 9, green: 21, total: 34 },
  { day: "2026-06-24", at_risk: 6, yellow: 7, green: 22, total: 35 },
];
const HEALTH_HISTORY = [
  { id: "s3", business_id: CUSTOMER.id, score: 30, band: "red", reasons: [], captured_at: "2026-06-24T02:00:00Z", created_at: "2026-06-24T02:00:00Z", updated_at: "2026-06-24T02:00:00Z" },
  { id: "s2", business_id: CUSTOMER.id, score: 45, band: "yellow", reasons: [], captured_at: "2026-06-17T02:00:00Z", created_at: "2026-06-17T02:00:00Z", updated_at: "2026-06-17T02:00:00Z" },
  { id: "s1", business_id: CUSTOMER.id, score: 60, band: "yellow", reasons: [], captured_at: "2026-06-10T02:00:00Z", created_at: "2026-06-10T02:00:00Z", updated_at: "2026-06-10T02:00:00Z" },
];

// Tunable thresholds (cs_settings singleton).
export const SETTINGS = {
  singleton: true,
  login_green_days: 7, login_yellow_days: 14, login_red_days: 30,
  sales_green_days: 7, sales_mid_days: 14, sales_window_days: 30,
  products_stale_days: 30, adoption_active_days: 14,
  renewal_healthy_days: 30, renewal_window_days: 14,
  band_green_min: 70, band_yellow_min: 40, warning_no_sales_days: 14,
  updated_at: CUSTOMER.created_at,
};

export const STAFF_ROLE_ROW = { user_id: MANAGER.id, name: MANAGER.name, email: "sade@allspire.tech", role: "support", pending: true };

export async function stubSettings(page: Page) {
  await page.route("**/rest/v1/cs_settings**", (r) => json(r, SETTINGS));
  await page.route("**/rest/v1/rpc/admin_customers_page**", (r) => json(r, [PAGE_ROW]));
  await page.route("**/rest/v1/rpc/admin_customers_facets**", (r) => json(r, FACETS));
  await page.route("**/rest/v1/rpc/admin_list_staff_roles**", (r) => json(r, [STAFF_ROLE_ROW]));
  await page.route("**/rest/v1/cs_staff_role**", (r) => json(r, [{ ...STAFF_ROLE_ROW, role: "cso" }]));
  await page.route("**/rest/v1/rpc/admin_remove_staff**", (r) => json(r, null));
  await page.route("**/functions/v1/invite-staff**", (r) => json(r, { token_hash: "tok_abc123", type: "invite", email: "newbie@allspire.tech" }));
  await page.route("**/rest/v1/cs_account_assignment**", (r) =>
    json(r, { business_id: CUSTOMER.id, account_manager_id: MANAGER.id, assigned_at: CUSTOMER.created_at, created_at: CUSTOMER.created_at, updated_at: CUSTOMER.created_at }),
  );
  // Email templates card: list for GET; upsert (POST) echoes the sent row (.single()).
  await page.route("**/rest/v1/cs_email_template**", (r) => {
    const method = r.request().method();
    if (method === "GET") return json(r, EMAIL_TEMPLATES);
    if (method === "DELETE") return json(r, []);
    let sent: Record<string, unknown> = {};
    try { sent = JSON.parse(r.request().postData() || "{}"); } catch { /* keep {} */ }
    return json(r, { ...EMAIL_TEMPLATES[0], ...sent });
  });
}

export async function stubCustomers(page: Page) {
  // Both the table (no arg) and the detail (p_business_id) hit the same RPC.
  await page.route("**/rest/v1/rpc/admin_business_aggregates**", (r) => json(r, [AGG]));
  await page.route("**/rest/v1/rpc/admin_dashboard_kpis**", (r) => json(r, [KPI]));
  // Renewal Revenue card (admin-only): total recorded in cs_renewal_payment.
  await page.route("**/rest/v1/rpc/admin_renewal_revenue**", (r) => json(r, [{ total: 350000, payment_count: 3 }]));
  await page.route("**/rest/v1/cs_health_current**", (r) => json(r, [HEALTH]));
  await page.route("**/rest/v1/cs_health_snapshot**", (r) => json(r, HEALTH_HISTORY));
  await page.route("**/rest/v1/rpc/admin_health_trend**", (r) => json(r, HEALTH_TREND));
  await page.route("**/rest/v1/cs_alert_active**", (r) => json(r, [ALERT]));
  // Customer Overview (§7.2): the server-side paginated page + its filter facets.
  await page.route("**/rest/v1/rpc/admin_customers_page**", (r) => json(r, [PAGE_ROW]));
  await page.route("**/rest/v1/rpc/admin_customers_facets**", (r) => json(r, FACETS));
  // Bulk account-manager assignment upserts here.
  await page.route("**/rest/v1/cs_account_assignment**", (r) => json(r, []));
  // Customer Detail (§7.4): profile extras, usage trends, pipeline, alerts, workflow RPCs.
  await page.route("**/rest/v1/rpc/admin_business_profile**", (r) => json(r, [PROFILE_EXTRA]));
  await page.route("**/rest/v1/rpc/admin_business_usage**", (r) => json(r, [USAGE]));
  await page.route("**/rest/v1/cs_pipeline**", (r) => json(r, [PIPELINE]));
  await page.route("**/rest/v1/cs_alert**", (r) => json(r, [BIZ_ALERT]));
  await page.route("**/rest/v1/rpc/cs_recompute_business**", (r) => json(r, HEALTH_SNAPSHOT));
  await page.route("**/rest/v1/rpc/cs_recompute_alerts_business**", (r) => json(r, [BIZ_ALERT]));
  // CRM tabs: lists default empty; creates echo a row back.
  await page.route("**/rest/v1/cs_note**", (r) =>
    r.request().method() === "POST"
      ? json(r, [{ id: "00000000-0000-0000-0000-0000000000a1", business_id: CUSTOMER.id, author_id: null, type: "general", body: "Logged a kickoff call", created_at: CUSTOMER.created_at, updated_at: CUSTOMER.created_at }])
      : json(r, []),
  );
  // Tasks: empty on the detail tab; create (incl. one-click from an alert) echoes a row.
  await page.route("**/rest/v1/cs_task**", (r) => (r.request().method() === "POST" ? json(r, [CREATED_TASK]) : json(r, [])));
  // The detail page still reads the team from profiles (admin-read RLS).
  await page.route("**/rest/v1/profiles**", (r) => json(r, [OWNER]));
}

export { BIZ_ALERT, PROFILE_EXTRA };

// Renewal payment records (Renewals module). GET → fixture; POST/PATCH echo sent fields (.single()).
export const RENEWAL_PAYMENT = {
  id: "abababab-0000-0000-0000-0000000000r1",
  business_id: CUSTOMER.id,
  paid_at: "2026-06-15",
  amount: 10000,
  currency: "NGN",
  ref_no: "TRF/2026/00123",
  notes: "Bank transfer confirmed by finance.",
  plan_key: "pro",
  cycle: "monthly",
  created_by: null,
  created_at: CUSTOMER.created_at,
  updated_at: CUSTOMER.created_at,
};
export async function stubRenewals(page: Page, opts: { records?: unknown[] } = {}) {
  await page.route("**/rest/v1/cs_renewal_payment**", (r) => {
    const method = r.request().method();
    if (method === "GET") return json(r, opts.records ?? [RENEWAL_PAYMENT]);
    if (method === "DELETE") return json(r, []);
    let sent: Record<string, unknown> = {};
    try { sent = JSON.parse(r.request().postData() || "{}"); } catch { /* keep {} */ }
    return json(r, { ...RENEWAL_PAYMENT, ...sent });
  });
}

// Direct customer email. `history` is what cs_customer_message returns (default none).
export const EMAIL_TEMPLATES = [
  { key: "welcome", name: "Welcome / onboarding", subject: "Welcome to iTrova, {{business_name}}", body: "<p>Hi {{owner_name}},</p><p>Welcome to {{plan}}.</p>" },
  { key: "renewal_reminder", name: "Renewal reminder", subject: "Your iTrova plan renews on {{renewal_date}}", body: "<p>Hi {{owner_name}},</p><p>{{business_name}} renews soon.</p>" },
];
export async function stubMessaging(page: Page, opts: { history?: unknown[] } = {}) {
  await page.route("**/rest/v1/cs_email_template**", (r) => json(r, EMAIL_TEMPLATES));
  // History comes from the cs_customer_messages RPC (resolves the sender name server-side).
  await page.route("**/rest/v1/rpc/cs_customer_messages**", (r) => json(r, opts.history ?? []));
  // The function resolves the recipient server-side and echoes it back.
  await page.route("**/functions/v1/send-customer-email**", (r) => json(r, { ok: true, id: "msg-1", to_email: "ada@mamaput.example" }));
}

// The central Messages module log (cs_message_log RPC — all customers, sender + business resolved).
// The RPC carries the full filtered count on each row (total_count) for the pager; inject it here so
// tests only need to supply the visible rows. Pass `total` to simulate more pages than are returned.
export async function stubMessageLog(page: Page, rows: unknown[] = [], total?: number) {
  const withCount = rows.map((r) => ({ ...(r as Record<string, unknown>), total_count: total ?? rows.length }));
  await page.route("**/rest/v1/rpc/cs_message_log**", (r) => json(r, withCount));
}

// Dual-control plan change (§ plan change). The signed-in admin is FAKE_USER; a second admin is
// OTHER_ADMIN. `active` sets the row admin_get_plan_change returns (null = no in-flight request).
export const OTHER_ADMIN = "22222222-2222-2222-2222-222222222222";
// iTrova's plan_prices_view — one row per (plan_key × cycle) with the per-cycle price + discount.
// The current business is on "pro" / monthly.
export const PLAN_CATALOGUE = [
  { plan_key: "free", plan_name: "Free", cycle: "monthly", price_amount: 0, discount_percent: 0 },
  { plan_key: "pro", plan_name: "Pro", cycle: "monthly", price_amount: 10000, discount_percent: 0 },
  { plan_key: "pro", plan_name: "Pro", cycle: "quarterly", price_amount: 30000, discount_percent: 25 },
  { plan_key: "pro", plan_name: "Pro", cycle: "annual", price_amount: 120000, discount_percent: 25 },
  { plan_key: "business", plan_name: "Business", cycle: "monthly", price_amount: 25000, discount_percent: 0 },
  { plan_key: "business", plan_name: "Business", cycle: "quarterly", price_amount: 75000, discount_percent: 20 },
];
export function planChangeRow(over: Record<string, unknown> = {}) {
  return {
    id: "cccccccc-0000-0000-0000-0000000000c1",
    business_id: CUSTOMER.id,
    from_tier: "pro",
    to_tier: "pro",
    from_cycle: "monthly",
    to_cycle: "annual",
    status: "pending",
    requested_by: FAKE_USER.id,
    requested_by_name: "You",
    approved_by: null,
    approved_by_name: null,
    code_expires_at: null,
    created_at: CUSTOMER.created_at,
    ...over,
  };
}
export async function stubPlanChange(page: Page, opts: { active?: Record<string, unknown> | null } = {}) {
  await page.route("**/rest/v1/rpc/admin_list_plans**", (r) => json(r, PLAN_CATALOGUE));
  await page.route("**/rest/v1/rpc/admin_get_plan_change**", (r) => json(r, opts.active ? [opts.active] : []));
  await page.route("**/rest/v1/rpc/admin_request_plan_change**", (r) => json(r, "cccccccc-0000-0000-0000-0000000000c1"));
  await page.route("**/rest/v1/rpc/admin_approve_plan_change**", (r) => json(r, "123456"));
  await page.route("**/rest/v1/rpc/admin_cancel_plan_change**", (r) => json(r, null));
  await page.route("**/functions/v1/execute-plan-change**", (r) => json(r, { ok: true, to_tier: "business" }));
}

// Customer Success Pipeline board (§7.6) — two businesses in different stages.
export const BOARD_OTHER = { id: "aaaaaaaa-0000-0000-0000-000000000099", name: "Bright Stores" };
const BOARD = [
  {
    business_id: CUSTOMER.id,
    name: CUSTOMER.name,
    stage: "onboarding",
    stage_source: "auto",
    health_band: "red",
    health_score: 30,
    renewal_date: null,
    account_manager_id: MANAGER.id,
    account_manager_name: MANAGER.name,
  },
  {
    business_id: BOARD_OTHER.id,
    name: BOARD_OTHER.name,
    stage: "active",
    stage_source: "auto",
    health_band: "green",
    health_score: 88,
    renewal_date: "2026-09-01T00:00:00Z",
    account_manager_id: null,
    account_manager_name: null,
  },
];

// One standalone prospect for the Lead column (cs_lead) — decoupled from businesses.
export const LEAD = {
  id: "ffff0000-0000-0000-0000-0000000000aa",
  name: "Prospect Foods Ltd",
  contact_name: "Bola Ade",
  contact_email: "bola@prospect.example",
  contact_phone: null,
  source: "Referral",
  notes: null,
  status: "open",
  business_id: null,
  created_by: null,
  created_at: CUSTOMER.created_at,
  updated_at: CUSTOMER.created_at,
};

export async function stubPipeline(page: Page) {
  await page.route("**/rest/v1/rpc/admin_pipeline_board**", (r) => json(r, BOARD));
  await page.route("**/rest/v1/cs_pipeline**", (r) => json(r, [PIPELINE]));
  // cs_lead: array for the list (GET); for create/convert/edit (.single()) echo the sent fields
  // merged onto the base lead, so PATCH actually reflects e.g. status:"converted".
  await page.route("**/rest/v1/cs_lead**", (r) => {
    const method = r.request().method();
    if (method === "GET") return json(r, [LEAD]);
    if (method === "DELETE") return json(r, []);
    let sent: Record<string, unknown> = {};
    try { sent = JSON.parse(r.request().postData() || "{}"); } catch { /* keep {} */ }
    return json(r, { ...LEAD, ...sent });
  });
}

// Tasks queue (§7.7).
export const TASK_ROW = {
  id: "11111111-aaaa-0000-0000-000000000001",
  business_id: CUSTOMER.id,
  business_name: CUSTOMER.name,
  title: "Renewal discussion",
  type: "renewal",
  assignee_role: "cso",
  assignee_id: null,
  created_by: null,
  due_date: "2026-07-02",
  status: "todo",
  created_at: CUSTOMER.created_at,
  updated_at: CUSTOMER.created_at,
  completed_at: null,
};
const CREATED_TASK = { ...TASK_ROW, id: "22222222-aaaa-0000-0000-000000000002", title: "Logged a kickoff call" };

export async function stubTasks(page: Page) {
  // Register cs_task first, then cs_task_admin, so the admin view wins (last match wins).
  await page.route("**/rest/v1/cs_task**", (r) => {
    const m = r.request().method();
    if (m === "POST") return json(r, [CREATED_TASK]);
    if (m === "PATCH") return json(r, [{ ...TASK_ROW, status: "done", completed_at: CUSTOMER.created_at }]);
    return json(r, [TASK_ROW]);
  });
  await page.route("**/rest/v1/cs_task_admin**", (r) => json(r, [TASK_ROW]));
}
