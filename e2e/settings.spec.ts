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
    await expect(page.getByText("Triage feature requests, own adoption")).toBeVisible(); // §3 matrix
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

  test("admin can change a staff member's role (writes cs_staff_role)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubSettings(page);
    await page.goto("/settings");

    const write = page.waitForRequest(
      (r) => r.url().includes("/rest/v1/cs_staff_role") && (r.method() === "POST" || r.method() === "PATCH"),
    );
    await page.getByLabel(`Role for ${MANAGER.name}`).selectOption("cso");
    await write;
  });

  test("admin can generate a staff invite link", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubSettings(page);
    await page.goto("/settings");

    await page.getByLabel("New staff email").fill("newbie@allspire.tech");
    await page.getByLabel("New staff role").selectOption("support");
    await page.getByRole("button", { name: "Generate invite link" }).click();
    // exact: true — otherwise this also matches the pending row's "Copy invite link for …" button
    // (substring), which races the async roles list and intermittently fails CI.
    await expect(page.getByLabel("Invite link", { exact: true })).toHaveValue(/set-password/);
  });

  test("admin can copy a fresh link for a pending invite", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubSettings(page);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/settings");

    const req = page.waitForRequest((r) => r.url().includes("/functions/v1/invite-staff"));
    await page.getByRole("button", { name: "Copy invite link for sade@allspire.tech" }).click();
    await req;
  });

  test("admin can remove a staff member (writes admin_remove_staff)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubSettings(page);
    await page.goto("/settings");

    page.on("dialog", (d) => d.accept()); // confirm prompt
    const req = page.waitForRequest((r) => r.url().includes("/rest/v1/rpc/admin_remove_staff"));
    await page.getByRole("button", { name: `Remove ${MANAGER.name}` }).click();
    await req;
  });

  test("a non-admin (CSO) sees settings read-only", async ({ page }) => {
    await signIn(page, { staff: true, role: "cso" });
    await stubSettings(page);
    await page.goto("/settings");

    await expect(page.getByText("Only Management/Admin can change thresholds")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save thresholds" })).toHaveCount(0);
    await expect(page.getByLabel(`Role for ${MANAGER.name}`)).toHaveCount(0); // read-only, no select
    await expect(page.getByLabel("New staff email")).toHaveCount(0); // no invite form for non-admin
  });

  test("admin can create an email template (upserts cs_email_template)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubSettings(page);
    await page.goto("/settings");

    await expect(page.getByText("Email templates")).toBeVisible();
    await page.getByRole("button", { name: "New template" }).click();
    await page.getByLabel("Template name").fill("Win-back offer");
    await expect(page.getByLabel("Template key")).toHaveValue("win_back_offer"); // auto-slug
    await page.getByLabel("Template subject").fill("We miss you, {{business_name}}");
    await page.getByLabel("Template body").fill("<p>Hi {{owner_name}}, come back!</p>");

    const post = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_email_template") && r.method() === "POST");
    await page.getByRole("button", { name: "Save template" }).click();
    await post;
  });

  test("admin can edit an existing template (prefilled form)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubSettings(page);
    await page.goto("/settings");

    await page.getByRole("button", { name: "Edit template Welcome / onboarding" }).click();
    const subject = page.getByLabel("Template subject");
    await expect(subject).toHaveValue(/Welcome to iTrova/);
    await subject.fill("Welcome aboard, {{business_name}}!");

    const post = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_email_template") && r.method() === "POST");
    await page.getByRole("button", { name: "Save template" }).click();
    await post;
  });

  test("deleting a template asks for confirmation first", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubSettings(page);
    await page.goto("/settings");

    let deleted = false;
    page.on("request", (r) => {
      if (r.url().includes("/rest/v1/cs_email_template") && r.method() === "DELETE") deleted = true;
    });
    await page.getByRole("button", { name: "Delete template Welcome / onboarding" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    expect(deleted).toBe(false);

    const del = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_email_template") && r.method() === "DELETE");
    await page.getByRole("button", { name: "Delete template", exact: true }).click();
    await del;
  });

  test("a non-admin (CSO) sees templates read-only", async ({ page }) => {
    await signIn(page, { staff: true, role: "cso" });
    await stubSettings(page);
    await page.goto("/settings");

    await expect(page.getByText("Email templates")).toBeVisible();
    await expect(page.getByText("Welcome / onboarding")).toBeVisible(); // list still readable
    await expect(page.getByRole("button", { name: "New template" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Edit template/ })).toHaveCount(0);
    await expect(page.getByText("Only Management/Admin can edit templates.")).toBeVisible();
  });
});
