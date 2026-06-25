import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubCustomers, CUSTOMER, MANAGER } from "./support/supabase";

test.describe("Customer Overview (§7.2)", () => {
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

  test("renders the server-side table with health pill, industry and account manager", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await page.goto("/customers");

    await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Industry" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Renewal" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Account manager" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();

    // The stubbed business renders with its red-band "Critical" pill, industry and manager.
    const row = page.getByRole("row", { name: new RegExp(CUSTOMER.name) });
    await expect(row.getByText("Critical")).toBeVisible();
    await expect(row.getByText("Food & Beverage")).toBeVisible();
    await expect(row.getByText("Unassigned")).toBeVisible();
  });

  test("applies a health-band filter server-side (URL + RPC param)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await page.goto("/customers");
    await expect(page.getByRole("row", { name: new RegExp(CUSTOMER.name) })).toBeVisible();

    const req = page.waitForRequest(
      (r) =>
        r.url().includes("/rest/v1/rpc/admin_customers_page") &&
        (r.postData() ?? "").includes('"p_band":"red"'),
    );
    await page.getByLabel("Health band").selectOption("red");
    await req;
    await expect(page).toHaveURL(/band=red/);
  });

  test("bulk-assigns an account manager (writes cs_account_assignment)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await page.goto("/customers");

    await page.getByLabel(`Select ${CUSTOMER.name}`).check();
    await page.getByLabel("Assign account manager").selectOption(MANAGER.id);

    const write = page.waitForRequest(
      (r) =>
        r.url().includes("/rest/v1/cs_account_assignment") &&
        (r.postData() ?? "").includes(MANAGER.id),
    );
    await page.getByRole("button", { name: "Apply" }).click();
    await write;
  });
});
