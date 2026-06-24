import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubCustomers, CUSTOMER } from "./support/supabase";

test.describe("Dashboard", () => {
  test("staff sees KPIs and recent signups from real reads", async ({ page }) => {
    await signIn(page, { staff: true });
    await expect(page).toHaveURL(/\/admin\/?$/);

    // Stub the cross-tenant reads, then reload so the dashboard recomputes from them.
    await stubCustomers(page);
    await page.goto("/admin/");

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Total businesses")).toBeVisible();
    await expect(page.getByText("MRR")).toBeVisible();
    // The one stubbed business shows up under recent signups.
    await expect(page.getByText(CUSTOMER.name)).toBeVisible();
  });
});
