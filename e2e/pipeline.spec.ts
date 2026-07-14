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

  test("the board fits the viewport and cards scroll within each column", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubPipeline(page);
    await page.goto("/pipeline");

    const board = page.getByTestId("pipeline-board");
    await expect(board).toBeVisible();

    // The board fills the screen but does not push the page past the viewport: its bottom edge
    // sits within the window (so the whole page does not scroll vertically).
    const viewport = page.viewportSize()!;
    const box = (await board.boundingBox())!;
    expect(box.height).toBeGreaterThan(200);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);

    // Cards scroll inside the column, not the page: the list is its own vertical scroll area.
    const overflowY = await page.getByTestId("lead-list").evaluate((el) => getComputedStyle(el).overflowY);
    expect(overflowY).toBe("auto");
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

  test("converting a lead confirms first, then keeps the card with a Converted badge", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubPipeline(page);
    await page.goto("/pipeline");

    // Convert opens a confirm dialog and does NOT write until confirmed.
    let converted = false;
    page.on("request", (r) => {
      if (r.url().includes("/rest/v1/cs_lead") && r.method() === "PATCH") converted = true;
    });
    await page.getByRole("button", { name: `Convert ${LEAD.name}` }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    expect(converted).toBe(false);

    const patch = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_lead") && r.method() === "PATCH");
    await page.getByRole("button", { name: "Mark converted" }).click();
    await patch;

    // The card stays put; only the Convert button is replaced by a Converted badge.
    // (exact match avoids colliding with the "Marked … as converted" toast.)
    await expect(page.getByText(LEAD.name, { exact: true })).toBeVisible();
    await expect(page.getByText("Converted", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Convert ${LEAD.name}` })).toHaveCount(0);
  });

  test("editing a converted lead can revert it back to open", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubPipeline(page);
    await page.goto("/pipeline");

    // Convert first so the card is in the converted state.
    await page.getByRole("button", { name: `Convert ${LEAD.name}` }).click();
    await page.getByRole("button", { name: "Mark converted" }).click();
    await expect(page.getByText("Converted", { exact: true })).toBeVisible();

    // Edit → the revert toggle is offered only for converted leads.
    await page.getByRole("button", { name: `Edit ${LEAD.name}` }).click();
    const revert = page.getByLabel("Revert to open lead");
    await expect(revert).toBeVisible();
    await revert.check();

    const patch = page.waitForRequest(
      (r) => r.url().includes("/rest/v1/cs_lead") && r.method() === "PATCH" && (r.postData() ?? "").includes('"status":"open"'),
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await patch;

    // Back to open: the Converted badge is gone and Convert is available again.
    await expect(page.getByText("Converted", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Convert ${LEAD.name}` })).toBeVisible();
  });

  test("removing a lead asks for confirmation before deleting", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubPipeline(page);
    await page.goto("/pipeline");

    // Clicking Remove opens a confirm dialog and does NOT delete on its own. This route still
    // serves [LEAD] for the list GET (which may race the override in CI) so the card always
    // renders; only DELETE is tracked.
    let deleted = false;
    await page.route("**/rest/v1/cs_lead**", (r) => {
      const method = r.request().method();
      if (method === "DELETE") deleted = true;
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(method === "GET" ? [LEAD] : []) });
    });
    await page.getByRole("button", { name: `Remove ${LEAD.name}` }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    expect(deleted).toBe(false);

    const del = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_lead") && r.method() === "DELETE");
    await page.getByRole("button", { name: "Remove lead" }).click();
    await del;
    expect(deleted).toBe(true);
  });

  test("admin can edit a lead (writes cs_lead fields)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubPipeline(page);
    await page.goto("/pipeline");

    await page.getByRole("button", { name: `Edit ${LEAD.name}` }).click();
    const nameField = page.getByLabel("Edit lead name");
    await expect(nameField).toHaveValue(LEAD.name);
    await nameField.fill("Renamed Prospect Co");

    const patch = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_lead") && r.method() === "PATCH");
    await page.getByRole("button", { name: "Save", exact: true }).click();
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

    // .first(): after the drop, the optimistic re-render can briefly show the card in both the old
    // and new columns — an ambiguous locator then fails strict mode at the dragend dispatch.
    const card = page.getByText(CUSTOMER.name).first();
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
