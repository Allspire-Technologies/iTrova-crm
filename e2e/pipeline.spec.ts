import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubPipeline, CUSTOMER, BOARD_OTHER, MANAGER } from "./support/supabase";

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
