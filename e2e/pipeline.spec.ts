import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubPipeline, CUSTOMER, BOARD_OTHER, MANAGER, LEAD } from "./support/supabase";

test.describe("Customer Success Pipeline (§7.6)", () => {
  test("renders the 8 lifecycle columns with cards", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubPipeline(page);
    await page.goto("/pipeline");

    for (const label of ["Lead", "Registered", "Subscribed", "Onboarding", "Active", "Power User", "Renewed", "Churned"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }

    // Cards carry the business name, account manager and renewal date.
    await expect(page.getByText(CUSTOMER.name)).toBeVisible();
    await expect(page.getByText(BOARD_OTHER.name)).toBeVisible();
    await expect(page.getByText(MANAGER.name)).toBeVisible();
    await expect(page.getByText("Unassigned")).toBeVisible();
    await expect(page.getByText(/Renews/)).toBeVisible();
    // The Lead column shows the standalone prospect (from cs_lead, not a business).
    await expect(page.getByText(LEAD.name)).toBeVisible();
  });

  test("admin can add a standalone lead (writes cs_lead)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubPipeline(page);
    await page.goto("/pipeline");

    await page.getByRole("button", { name: "Add lead" }).click();
    await page.getByLabel("Lead name").fill("New Prospect Co");
    const post = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_lead") && r.method() === "POST");
    await page.getByRole("button", { name: "Save lead" }).click();
    await post;
  });

  test("admin can convert a lead (writes cs_lead status)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubPipeline(page);
    await page.goto("/pipeline");

    const patch = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_lead") && r.method() === "PATCH");
    await page.getByRole("button", { name: `Convert ${LEAD.name}` }).click();
    await patch;
  });

  test("a business cannot be dropped into the Lead column", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubPipeline(page);
    await page.goto("/pipeline");

    const card = page.getByText(CUSTOMER.name);
    const leadColumn = page.getByText("Lead", { exact: true }).locator("xpath=ancestor::div[2]");
    await expect(card).toBeVisible();

    // The Lead column has no drop handler, so dropping a business there writes nothing.
    let wrote = false;
    await page.route("**/rest/v1/cs_pipeline**", (r) => {
      if (r.request().method() === "POST" || r.request().method() === "PATCH") wrote = true;
      return r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await card.dispatchEvent("dragstart", { dataTransfer });
    await leadColumn.dispatchEvent("dragover", { dataTransfer });
    await leadColumn.dispatchEvent("drop", { dataTransfer });
    await card.dispatchEvent("dragend", { dataTransfer });
    await page.waitForTimeout(300);
    expect(wrote).toBe(false);
  });

  test("a manual drag writes cs_pipeline with stage_source=manual", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubPipeline(page);
    await page.goto("/pipeline");

    const card = page.getByText(CUSTOMER.name);
    const powerUserColumn = page.getByText("Power User", { exact: true }).locator("xpath=ancestor::div[2]");
    await expect(card).toBeVisible();

    const write = page.waitForRequest(
      (r) =>
        r.url().includes("/rest/v1/cs_pipeline") &&
        (r.postData() ?? "").includes('"stage":"power_user"') &&
        (r.postData() ?? "").includes('"stage_source":"manual"'),
    );

    // Deterministic HTML5 drag-and-drop: a shared DataTransfer carries the dragged id
    // across the dispatched dragstart → dragover → drop sequence (robust under parallel load).
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await card.dispatchEvent("dragstart", { dataTransfer });
    await powerUserColumn.dispatchEvent("dragover", { dataTransfer });
    await powerUserColumn.dispatchEvent("drop", { dataTransfer });
    await card.dispatchEvent("dragend", { dataTransfer });

    await write;
  });

  test("clicking a card opens Customer Detail", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubPipeline(page);
    await page.goto("/pipeline");

    await page.getByText(BOARD_OTHER.name).click();
    await expect(page).toHaveURL(new RegExp(`/customers/${BOARD_OTHER.id}$`));
  });
});
