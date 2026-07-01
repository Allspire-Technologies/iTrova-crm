import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubCustomers, stubPlanChange, planChangeRow, CUSTOMER, FAKE_USER, OTHER_ADMIN } from "./support/supabase";

// Dual-control plan change (Management/Admin): one admin requests, a DIFFERENT admin mints a
// one-time code, the requester applies with password + code (verified server-side).
test.describe("Plan change (dual-control)", () => {
  test("an admin can request a plan change across cycles", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await stubPlanChange(page, { active: null });
    await page.goto(`/customers/${CUSTOMER.id}`);

    await expect(page.getByText("Change or renew plan")).toBeVisible();
    // Cycle first, then the plan priced for that cycle (quarterly variant).
    await page.getByLabel("Billing cycle").selectOption("quarterly");
    await page.getByLabel("Target plan").selectOption("pro");
    const req = page.waitForRequest(
      (r) => r.url().includes("/rest/v1/rpc/admin_request_plan_change") && r.method() === "POST",
    );
    await page.getByRole("button", { name: "Request change" }).click();
    await req;
  });

  test("an admin can request a renewal (keep the current plan)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await stubPlanChange(page, { active: null });
    await page.goto(`/customers/${CUSTOMER.id}`);

    // Current plan (pro / monthly) is preselected → the action reads as a renewal.
    const req = page.waitForRequest(
      (r) => r.url().includes("/rest/v1/rpc/admin_request_plan_change") && r.method() === "POST",
    );
    await page.getByRole("button", { name: "Request renewal" }).click();
    await req;
  });

  test("a different admin can approve and gets a one-time code", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    // Pending request raised by ANOTHER admin → the signed-in admin is the approver.
    await stubPlanChange(page, { active: planChangeRow({ requested_by: OTHER_ADMIN, requested_by_name: "Bola Ade" }) });
    await page.goto(`/customers/${CUSTOMER.id}`);

    const approve = page.waitForRequest(
      (r) => r.url().includes("/rest/v1/rpc/admin_approve_plan_change") && r.method() === "POST",
    );
    await page.getByRole("button", { name: "Generate approval code" }).click();
    await approve;
    await expect(page.getByLabel("Approval code")).toHaveText("123456");
  });

  test("the requesting admin applies with password + code (calls the Edge Function)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    // Approved request owned by the signed-in admin, approved by someone else.
    await stubPlanChange(page, {
      active: planChangeRow({
        status: "approved",
        requested_by: FAKE_USER.id,
        approved_by: OTHER_ADMIN,
        approved_by_name: "Bola Ade",
        code_expires_at: "2099-01-01T00:00:00Z",
      }),
    });
    await page.goto(`/customers/${CUSTOMER.id}`);

    await page.getByLabel("Your password").fill("password123");
    await page.getByLabel("Approval code").fill("123456");
    const exec = page.waitForRequest(
      (r) => r.url().includes("/functions/v1/execute-plan-change") && r.method() === "POST",
    );
    await page.getByRole("button", { name: "Apply change" }).click();
    await exec;
  });

  test("a non-admin (support) cannot see the plan controls", async ({ page }) => {
    await signIn(page, { staff: true, role: "support" });
    await stubCustomers(page);
    await stubPlanChange(page, { active: null });
    await page.goto(`/customers/${CUSTOMER.id}`);

    await expect(page.getByRole("heading", { name: CUSTOMER.name })).toBeVisible(); // page loaded
    await expect(page.getByText("Change or renew plan")).toHaveCount(0);
  });
});
