import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubCustomers, CUSTOMER } from "./support/supabase";

test.describe("Customers", () => {
  test("staff sees the businesses list and can open a detail", async ({ page }) => {
    await signIn(page, { staff: true });
    await expect(page).toHaveURL(/\/\/localhost:8090\/$/);

    // Mock the cross-tenant reads, then navigate into Customers.
    await stubCustomers(page);
    await page.getByRole("link", { name: "Customers" }).click();
    await expect(page).toHaveURL(/\/customers$/);

    const row = page.getByRole("row", { name: new RegExp(CUSTOMER.name) });
    await expect(row).toBeVisible();
    await expect(page.getByText("Ada Obi")).toBeVisible();

    await row.click();
    await expect(page).toHaveURL(new RegExp(`/customers/${CUSTOMER.id}$`));
    await expect(page.getByRole("heading", { name: CUSTOMER.name })).toBeVisible();
    await expect(page.getByText("Subscription")).toBeVisible();
    await expect(page.getByText("Owner")).toBeVisible();
  });
});
