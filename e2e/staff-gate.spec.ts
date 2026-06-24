import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubAuth } from "./support/supabase";

test.describe("Staff gate", () => {
  test("redirects an unauthenticated visitor to login", async ({ page }) => {
    await stubAuth(page, { staff: true });
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("blocks a signed-in non-staff (customer) session", async ({ page }) => {
    await signIn(page, { staff: false });
    await expect(page).toHaveURL(/\/no-access$/);
    await expect(page.getByText("Staff access only")).toBeVisible();
    // Admin OS shell must NOT render for a customer
    await expect(page.getByRole("link", { name: "Customers" })).toHaveCount(0);
  });

  test("lets a staff session into Admin OS", async ({ page }) => {
    await signIn(page, { staff: true });
    await expect(page).toHaveURL(/\/\/localhost:8090\/$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Customers" })).toBeVisible();
  });
});
