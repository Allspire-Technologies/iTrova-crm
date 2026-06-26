import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubCustomers } from "./support/supabase";

test.describe("App shell", () => {
  test("collapses and expands the sidebar", async ({ page }) => {
    await signIn(page, { staff: true });
    await expect(page).toHaveURL(/\/\/localhost:8090\/$/);

    const label = page.getByText("Customers", { exact: true });
    await expect(label).toBeVisible();

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(label).toHaveCount(0); // labels hide when collapsed

    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(page.getByText("Customers", { exact: true })).toBeVisible();
  });

  test("exposes the PWA manifest and theme color", async ({ page }) => {
    await signIn(page, { staff: true });
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#1CA070");
  });

  test("mobile: hamburger opens the nav drawer and navigates", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, { staff: true });
    await stubCustomers(page);

    // No nav visible until the drawer is opened (desktop sidebar is hidden on mobile).
    await expect(page.getByRole("link", { name: "Customers" })).toHaveCount(0);
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("link", { name: "Customers" }).click();
    await expect(page).toHaveURL(/\/customers$/);
    // Drawer closed after navigating.
    await expect(page.getByRole("button", { name: "Close menu" })).toHaveCount(0);
  });
});
