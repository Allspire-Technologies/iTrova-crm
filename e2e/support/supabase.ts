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

export async function stubCustomers(page: Page) {
  await page.route("**/rest/v1/businesses**", (r) => {
    // Detail uses .maybeSingle() (id=eq.<id>) → return a single object; the list returns an array.
    const single = r.request().url().includes("id=eq.");
    return json(r, single ? CUSTOMER : [CUSTOMER]);
  });
  await page.route("**/rest/v1/profiles**", (r) => json(r, [OWNER]));
  await page.route("**/rest/v1/subscriptions**", (r) => {
    const single = r.request().url().includes("business_id=eq.");
    const detail = {
      plan_key: "pro",
      cycle: "month",
      status: "active",
      amount: 5000,
      currency: "NGN",
      current_period_end: null,
      started_at: CUSTOMER.created_at,
    };
    return json(r, single ? detail : [{ business_id: CUSTOMER.id, status: "active", amount: 5000 }]);
  });
}
