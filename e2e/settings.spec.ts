import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubSettings, CUSTOMER, MANAGER } from "./support/supabase";

test.describe("Settings (§3/§8)", () => {
  test("loads thresholds and saves to cs_settings (no redeploy)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubSettings(page);
    await page.goto("/settings");

    await expect(page.getByText("Health & alert thresholds")).toBeVisible();
    const field = page.getByLabel("Healthy within");
    await expect(field).toHaveValue("7");
    await field.fill("10");

    const patch = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_settings") && r.method() === "PATCH");
    await page.getByRole("button", { name: "Save thresholds" }).click();
    await patch;
  });

  test("shows the role matrix and account-manager assignment", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubSettings(page);
    await page.goto("/settings");

    await expect(page.getByText("Roles & visibility")).toBeVisible();
    await expect(page.getByText("Customer Success Officer").first()).toBeVisible();
    await expect(page.getByText("Account-manager assignment")).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(CUSTOMER.name) })).toBeVisible();
  });

  test("assigns an account manager (writes cs_account_assignment)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubSettings(page);
    await page.goto("/settings");

    const post = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_account_assignment") && r.method() === "POST");
    await page.getByLabel(`Account manager for ${CUSTOMER.name}`).selectOption(MANAGER.id);
    await post;
  });
});
