import type { Page } from "@playwright/test";
import { stubAuth } from "./supabase";

/** Stub Supabase, then sign in through the Login form. `staff` controls is_platform_admin(). */
export async function signIn(page: Page, opts: { staff: boolean }) {
  await stubAuth(page, { staff: opts.staff });
  await page.goto("/login");
  await page.locator("#le").fill("staff@allspire.tech");
  await page.locator("#lp").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
}
