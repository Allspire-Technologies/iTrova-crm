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
const HEALTH = { business_id: CUSTOMER.id, score: 30, band: "red", reasons: [], captured_at: CUSTOMER.created_at };

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

export async function stubCustomers(page: Page) {
  // Both the table (no arg) and the detail (p_business_id) hit the same RPC.
  await page.route("**/rest/v1/rpc/admin_business_aggregates**", (r) => json(r, [AGG]));
  await page.route("**/rest/v1/rpc/admin_dashboard_kpis**", (r) => json(r, [KPI]));
  await page.route("**/rest/v1/cs_health_current**", (r) => json(r, [HEALTH]));
  await page.route("**/rest/v1/cs_alert_active**", (r) => json(r, [ALERT]));
  // The detail page still reads the team from profiles (admin-read RLS).
  await page.route("**/rest/v1/profiles**", (r) => json(r, [OWNER]));
}
