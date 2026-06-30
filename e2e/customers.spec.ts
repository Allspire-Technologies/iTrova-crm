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
    await expect(page.getByText("Ada Obi").first()).toBeVisible();

    await row.click();
    await expect(page).toHaveURL(new RegExp(`/customers/${CUSTOMER.id}$`));
    await expect(page.getByRole("heading", { name: CUSTOMER.name })).toBeVisible();
    await expect(page.getByText("Profile", { exact: true })).toBeVisible();
    await expect(page.getByText("Subscription", { exact: true })).toBeVisible();
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

    await page.getByLabel(`Select ${CUSTOMER.name}`).first().check();
    await page.getByLabel("Assign account manager").selectOption(MANAGER.id);

    const write = page.waitForRequest(
      (r) =>
        r.url().includes("/rest/v1/cs_account_assignment") &&
        (r.postData() ?? "").includes(MANAGER.id),
    );
    await page.getByRole("button", { name: "Apply" }).click();
    await write;
  });

  test("admin deletes a business after confirming (calls admin_delete_business)", async ({ page }) => {
    await signIn(page, { staff: true }); // default staff role is admin
    await stubCustomers(page);
    await page.goto("/customers");
    await expect(page.getByRole("row", { name: new RegExp(CUSTOMER.name) })).toBeVisible();

    // Clicking delete opens a confirmation first — it does not delete immediately.
    await page.getByRole("button", { name: `Delete ${CUSTOMER.name}` }).first().click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText(`Delete ${CUSTOMER.name}?`)).toBeVisible();

    const del = page.waitForRequest(
      (r) =>
        r.url().includes("/rest/v1/rpc/admin_delete_business") &&
        (r.postData() ?? "").includes(CUSTOMER.id),
    );
    await dialog.getByRole("button", { name: "Delete business" }).click();
    await del;
  });

  test("admin deletes from the detail page (calls RPC, returns to the list)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await page.goto(`/customers/${CUSTOMER.id}`);
    await expect(page.getByRole("heading", { name: CUSTOMER.name })).toBeVisible();

    await page.getByRole("button", { name: "Delete business" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText(`Delete ${CUSTOMER.name}?`)).toBeVisible();

    const del = page.waitForRequest(
      (r) =>
        r.url().includes("/rest/v1/rpc/admin_delete_business") &&
        (r.postData() ?? "").includes(CUSTOMER.id),
    );
    await dialog.getByRole("button", { name: "Delete business" }).click();
    await del;
    await expect(page).toHaveURL(/\/customers$/);
  });

  test("non-admin staff cannot see the delete action", async ({ page }) => {
    await signIn(page, { staff: true, role: "support" });
    await stubCustomers(page);
    await page.goto("/customers");
    await expect(page.getByRole("row", { name: new RegExp(CUSTOMER.name) })).toBeVisible();

    await expect(page.getByRole("columnheader", { name: "Delete" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(0);
  });
});
