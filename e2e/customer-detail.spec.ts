import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubCustomers, stubActivation, CUSTOMER, PROFILE_EXTRA } from "./support/supabase";

test.describe("Customer Detail (§7.4)", () => {
  test("renders the profile, health reasons, pipeline and all sections", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await page.goto(`/customers/${CUSTOMER.id}`);

    await expect(page.getByRole("heading", { name: CUSTOMER.name })).toBeVisible();
    // Section headings.
    for (const h of ["Profile", "Customer Success Workflow", "Product Usage", "User Activity", "Notes & CRM"]) {
      await expect(page.getByText(h, { exact: true }).first()).toBeVisible();
    }
    // Profile content: email, industry, pipeline stage and a health reason.
    await expect(page.getByText(PROFILE_EXTRA.owner_email)).toBeVisible();
    await expect(page.getByText("Food & Beverage")).toBeVisible();
    await expect(page.getByText("Onboarding").first()).toBeVisible();
    await expect(page.getByText("Health trend")).toBeVisible(); // sparkline from snapshot history
    // Health breakdown: scored factors + trip-wire/warning flags (not raw JSON).
    await expect(page.getByText("Health breakdown")).toBeVisible();
    await expect(page.getByText("Login recency")).toBeVisible();
    await expect(page.getByText("No sales recorded")).toBeVisible(); // sales_activity detail
    await expect(page.getByText("No login in 21 days")).toBeVisible(); // trip-wire, sentence-cased
    await expect(page.getByText("No sales in 30 days")).toBeVisible(); // warning
  });

  test("a non-admin (support) does not see the subscription amount", async ({ page }) => {
    await signIn(page, { staff: true, role: "support" });
    await stubCustomers(page);
    await page.goto(`/customers/${CUSTOMER.id}`);

    await expect(page.getByText("Subscription", { exact: true })).toBeVisible();
    await expect(page.getByText("Amount", { exact: true })).toHaveCount(0); // revenue is admin-only
  });

  test("recompute health calls the staff-gated RPC", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await page.goto(`/customers/${CUSTOMER.id}`);

    const req = page.waitForRequest((r) => r.url().includes("/rest/v1/rpc/cs_recompute_business"));
    await page.getByRole("button", { name: "Recompute health" }).click();
    await req;
  });

  test("acknowledges an open alert (writes cs_alert)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await page.goto(`/customers/${CUSTOMER.id}`);

    await expect(page.getByText("No login for 21 days")).toBeVisible();
    const patch = page.waitForRequest(
      (r) => r.url().includes("/rest/v1/cs_alert") && r.method() === "PATCH",
    );
    await page.getByRole("button", { name: "Acknowledge" }).click();
    await patch;
  });

  test("creates a task from an alert (writes cs_task)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await page.goto(`/customers/${CUSTOMER.id}`);

    await expect(page.getByText("No login for 21 days")).toBeVisible();
    const post = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_task") && r.method() === "POST");
    await page.getByRole("button", { name: "Create task" }).click();
    await post;
  });

  test("lazily loads the CRM tabs and adds a note (writes cs_note)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await page.goto(`/customers/${CUSTOMER.id}`);

    await page.getByText("Notes & CRM", { exact: true }).scrollIntoViewIfNeeded();
    const body = page.getByLabel("Note body");
    await expect(body).toBeVisible(); // lazy section mounted
    await body.fill("Logged a kickoff call");

    const post = page.waitForRequest(
      (r) => r.url().includes("/rest/v1/cs_note") && r.method() === "POST",
    );
    await page.getByRole("button", { name: "Add note" }).click();
    await post;
  });
  test("admin resends the activation email while the owner is not activated", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await stubActivation(page, { confirmedAt: null });
    await page.goto(`/customers/${CUSTOMER.id}`);

    await expect(page.getByText("Not activated")).toBeVisible();
    const button = page.getByRole("button", { name: "Resend activation email" });
    await expect(button).toBeEnabled();
    const send = page.waitForRequest(
      (r) => r.url().includes("/functions/v1/resend-activation-email") && r.method() === "POST",
    );
    await button.click();
    await page.getByRole("button", { name: "Send activation email", exact: true }).click();
    const req = await send;
    // The browser never chooses the recipient — the function resolves the owner server-side.
    expect(req.postData() ?? "").toContain(CUSTOMER.id);
    expect(req.postData() ?? "").not.toContain(PROFILE_EXTRA.owner_email);
    await expect(page.getByText(/Activation email sent to/)).toBeVisible();
    await expect(button).toBeDisabled(); // one send per minute
  });

  test("the resend action is greyed out once the owner has activated", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await stubActivation(page, { confirmedAt: "2026-02-01T09:00:00Z" });
    await page.goto(`/customers/${CUSTOMER.id}`);

    await expect(page.getByText("Activated", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend activation email" })).toBeDisabled();
  });

  test("a CSO does not get the resend action", async ({ page }) => {
    await signIn(page, { staff: true, role: "cso" });
    await stubCustomers(page);
    await stubActivation(page);
    await page.goto(`/customers/${CUSTOMER.id}`);

    await expect(page.getByText("Not activated")).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend activation email" })).toHaveCount(0);
  });
});
