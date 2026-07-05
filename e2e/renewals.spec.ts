import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubCustomers, stubRenewals, CUSTOMER, RENEWAL_PAYMENT } from "./support/supabase";

// Renewals module: a customer list → per-customer renewal payment records (Ref No + notes).
// Reads are staff-wide (visibility-scoped); recording/editing is Management/Admin-only.
test.describe("Renewals (payment records)", () => {
  test("the sidebar links to a customer list that opens the per-customer page", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await stubRenewals(page);
    await page.goto("/");

    await page.getByRole("link", { name: "Renewals" }).click();
    await expect(page).toHaveURL(/\/renewals$/);
    // .first(): the row renders twice (desktop table + hidden mobile card).
    await expect(page.getByText(CUSTOMER.name).first()).toBeVisible();

    await page.getByText(CUSTOMER.name).first().click();
    await expect(page).toHaveURL(new RegExp(`/renewals/${CUSTOMER.id}$`));
    // Context card + the existing record.
    await expect(page.getByText("Subscription", { exact: true })).toBeVisible();
    await expect(page.getByText(RENEWAL_PAYMENT.ref_no)).toBeVisible();
  });

  test("an admin records a payment (writes cs_renewal_payment with the Ref No)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await stubRenewals(page);
    await page.goto(`/renewals/${CUSTOMER.id}`);

    await page.getByRole("button", { name: "Record payment" }).click();
    await page.getByLabel("Payment amount").fill("120000");
    await page.getByLabel("Payment reference number").fill("TRF/2026/00456");
    await page.getByLabel("Payment notes").fill("Annual renewal via bank transfer.");

    const post = page.waitForRequest(
      (r) =>
        r.url().includes("/rest/v1/cs_renewal_payment") &&
        r.method() === "POST" &&
        (r.postData() ?? "").includes("TRF/2026/00456"),
    );
    await page.getByRole("button", { name: "Record payment" }).click(); // submit
    await post;
    await expect(page.getByText("TRF/2026/00456")).toBeVisible();
  });

  test("removing a record asks for confirmation before deleting", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await stubRenewals(page);
    await page.goto(`/renewals/${CUSTOMER.id}`);

    let deleted = false;
    page.on("request", (r) => {
      if (r.url().includes("/rest/v1/cs_renewal_payment") && r.method() === "DELETE") deleted = true;
    });
    await page.getByRole("button", { name: `Remove payment ${RENEWAL_PAYMENT.ref_no}` }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    expect(deleted).toBe(false);

    const del = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_renewal_payment") && r.method() === "DELETE");
    await page.getByRole("button", { name: "Remove record" }).click();
    await del;
  });

  test("a non-admin (CSO) sees records read-only", async ({ page }) => {
    await signIn(page, { staff: true, role: "cso" });
    await stubCustomers(page);
    await stubRenewals(page);
    await page.goto(`/renewals/${CUSTOMER.id}`);

    await expect(page.getByText(RENEWAL_PAYMENT.ref_no)).toBeVisible(); // history readable
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Remove payment/ })).toHaveCount(0);
  });
});
