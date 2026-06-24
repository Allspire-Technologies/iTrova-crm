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
