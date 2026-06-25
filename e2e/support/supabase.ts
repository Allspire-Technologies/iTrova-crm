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
export async function stubAuth(page: Page, opts: { staff: boolean }) {
  await page.route("**/auth/v1/token**", (r) => json(r, SESSION_BODY));
  await page.route("**/auth/v1/user**", (r) => json(r, FAKE_USER));
  // Safety net for any other PostgREST call — registered FIRST so the specific RPC
  // route below (registered last) wins for is_platform_admin (Playwright = last match wins).
  await page.route("**/rest/v1/**", (r) => json(r, []));
  await page.route("**/rest/v1/rpc/is_platform_admin**", (r) => json(r, opts.staff));
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
  subscription_cycle: "month",
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
const HEALTH = {
  business_id: CUSTOMER.id,
  score: 30,
  band: "red",
  reasons: ["No login in 21 days", "No sales in 30 days"],
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

export async function stubSettings(page: Page) {
  await page.route("**/rest/v1/cs_settings**", (r) => json(r, SETTINGS));
  await page.route("**/rest/v1/rpc/admin_customers_page**", (r) => json(r, [PAGE_ROW]));
  await page.route("**/rest/v1/rpc/admin_customers_facets**", (r) => json(r, FACETS));
  await page.route("**/rest/v1/cs_account_assignment**", (r) =>
    json(r, { business_id: CUSTOMER.id, account_manager_id: MANAGER.id, assigned_at: CUSTOMER.created_at, created_at: CUSTOMER.created_at, updated_at: CUSTOMER.created_at }),
  );
}

export async function stubCustomers(page: Page) {
  // Both the table (no arg) and the detail (p_business_id) hit the same RPC.
  await page.route("**/rest/v1/rpc/admin_business_aggregates**", (r) => json(r, [AGG]));
  await page.route("**/rest/v1/rpc/admin_dashboard_kpis**", (r) => json(r, [KPI]));
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

export async function stubPipeline(page: Page) {
  await page.route("**/rest/v1/rpc/admin_pipeline_board**", (r) => json(r, BOARD));
  await page.route("**/rest/v1/cs_pipeline**", (r) => json(r, [PIPELINE]));
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
