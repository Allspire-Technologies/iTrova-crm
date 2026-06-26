import type { Page } from "@playwright/test";
import { stubAuth } from "./supabase";

/** Stub Supabase, then sign in through the Login form. `staff` controls is_platform_admin();
 *  optional `role` (admin|cso|pm|support) controls cs_my_role() — defaults to admin. */
export async function signIn(page: Page, opts: { staff: boolean; role?: string }) {
  await stubAuth(page, opts);
  await page.goto("/login");
  await page.locator("#le").fill("staff@allspire.tech");
  await page.locator("#lp").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
}
