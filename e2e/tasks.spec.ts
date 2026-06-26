import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubTasks, CUSTOMER } from "./support/supabase";

const isTask = (url: string) => url.includes("/rest/v1/cs_task") && !url.includes("cs_task_admin");

test.describe("Tasks queue (§7.7)", () => {
  test("renders the queue and creates a task", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubTasks(page);
    await page.goto("/tasks");

    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
    // The seeded task row, linked to its business.
    await expect(page.getByRole("row", { name: new RegExp(CUSTOMER.name) })).toBeVisible();

    await page.getByLabel("Task title").fill("Logged a kickoff call");
    const post = page.waitForRequest((r) => isTask(r.url()) && r.method() === "POST");
    await page.getByRole("button", { name: "Add task" }).click();
    await post;
  });

  test("filters by status (server-side query)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubTasks(page);
    await page.goto("/tasks");
    await expect(page.getByRole("row", { name: new RegExp(CUSTOMER.name) })).toBeVisible();

    const req = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_task_admin") && r.url().includes("status=eq.done"));
    await page.getByLabel("Filter by status").selectOption("done");
    await req;
  });

  test("marks a task done (PATCH cs_task)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubTasks(page);
    await page.goto("/tasks");

    const patch = page.waitForRequest((r) => isTask(r.url()) && r.method() === "PATCH");
    await page.getByLabel("Status for Renewal discussion").first().selectOption("done");
    await patch;
  });
});
