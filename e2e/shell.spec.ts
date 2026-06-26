import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";

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
});
