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
