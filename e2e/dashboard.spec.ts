import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubCustomers, CUSTOMER } from "./support/supabase";

test.describe("Dashboard", () => {
  test("staff sees KPI cards and the at-risk list from real reads", async ({ page }) => {
    await signIn(page, { staff: true });
    await expect(page).toHaveURL(/\/\/localhost:8090\/$/);

    // Stub the secured aggregates/health/alerts, then reload so Home recomputes from them.
    await stubCustomers(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Total Businesses")).toBeVisible();
    await expect(page.getByText("MRR", { exact: true })).toBeVisible();
    await expect(page.getByText("Businesses At Risk")).toBeVisible();
    // The cs_health_snapshot history drives the at-risk trend chart.
    await expect(page.getByText("At-risk trend")).toBeVisible();
    // The stubbed churn alert surfaces the business in the at-risk list.
    await expect(page.getByText(CUSTOMER.name)).toBeVisible();
  });

  test("a non-admin (support) sees neither MRR/ARR nor 'all' framing", async ({ page }) => {
    await signIn(page, { staff: true, role: "support" });
    await stubCustomers(page);
    await page.goto("/");

    await expect(page.getByText("Total Businesses")).toBeVisible();
    await expect(page.getByText("MRR", { exact: true })).toHaveCount(0); // revenue is admin-only
    await expect(page.getByText("ARR", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Overview of your assigned customers.")).toBeVisible();
  });

  test("does not overflow horizontally on a narrow phone (long business names truncate)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await signIn(page, { staff: true });
    await stubCustomers(page);
    // A very long business name in a list card is the case that used to force horizontal scroll.
    await page.route("**/rest/v1/rpc/admin_business_aggregates**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            business_id: "00000000-0000-0000-0000-0000000000f1",
            name: "Supercalifragilistic Distribution & Logistics International Holdings Ltd",
            currency: "NGN", owner_id: "00000000-0000-0000-0000-0000000000f2",
            subscription_status: "active", subscription_amount: 187654321, subscription_cycle: "month",
            renewal_date: "2026-07-05", joined_at: "2026-06-01T00:00:00Z", last_login: "2026-06-29T00:00:00Z",
          },
        ]),
      }),
    );
    await page.goto("/");
    await expect(page.getByText("Total Businesses")).toBeVisible();
    await expect(page.getByText("Renewals due")).toBeVisible();

    // The page must not scroll horizontally: the document is no wider than the viewport.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("a KPI card click-through lands on a filtered Customers view", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await page.goto("/");

    await page.getByRole("link", { name: /Paying Businesses/ }).click();
    await expect(page).toHaveURL(/\/customers\?filter=paying$/);
    await expect(page.getByText("Paying", { exact: true })).toBeVisible(); // active-filter chip
    await expect(page.getByRole("row", { name: new RegExp(CUSTOMER.name) })).toBeVisible();
  });
});
