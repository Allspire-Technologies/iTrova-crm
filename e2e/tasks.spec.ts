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

  test("done tasks archive after 7 days (hidden by default, shown by the Archived filter)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubTasks(page);
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    const rowBase = { business_id: CUSTOMER.id, business_name: CUSTOMER.name, assignee_role: "cso", assignee_id: null, created_by: null, due_date: null };
    const TASKS = [
      { ...rowBase, id: "t-open", title: "Upcoming call", type: "call", status: "todo", created_at: daysAgo(1), updated_at: daysAgo(1), completed_at: null },
      { ...rowBase, id: "t-recent-done", title: "Recently finished demo", type: "meeting", status: "done", created_at: daysAgo(3), updated_at: daysAgo(2), completed_at: daysAgo(2) },
      { ...rowBase, id: "t-old-done", title: "Ancient onboarding call", type: "call", status: "done", created_at: daysAgo(40), updated_at: daysAgo(30), completed_at: daysAgo(30) },
    ];
    // Registered after stubTasks so it wins; honours the ?status=eq.* param the client sends.
    await page.route("**/rest/v1/cs_task_admin**", (r) => {
      const status = new URL(r.request().url()).searchParams.get("status");
      const wanted = status?.startsWith("eq.") ? status.slice(3) : null;
      const body = wanted ? TASKS.filter((t) => t.status === wanted) : TASKS;
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto("/tasks");

    // Default: open + recently-done visible; the 30-day-old done task is archived away.
    await expect(page.getByRole("row", { name: /Upcoming call/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Recently finished demo/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Ancient onboarding call/ })).toHaveCount(0);

    // The plain "done" filter also excludes archived items.
    await page.getByLabel("Filter by status").selectOption("done");
    await expect(page.getByRole("row", { name: /Recently finished demo/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Ancient onboarding call/ })).toHaveCount(0);

    // Archived shows only the old done task (fetches status=eq.done, then ages client-side).
    await page.getByLabel("Filter by status").selectOption("archived");
    await expect(page.getByRole("row", { name: /Ancient onboarding call/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Recently finished demo/ })).toHaveCount(0);
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
