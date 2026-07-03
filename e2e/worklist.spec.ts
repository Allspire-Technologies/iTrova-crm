import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { CUSTOMER } from "./support/supabase";

const base = { business_id: CUSTOMER.id, business_name: CUSTOMER.name, priority: null, sub_type: null, rating: null, votes: null, due_date: null, assignee_role: null };

const WORKLIST = [
  { ...base, kind: "task", id: "wk-task-1", title: "Call Ada about renewal", status: "todo", sub_type: "follow_up", assignee_role: "cso", due_date: "2026-07-10", created_at: "2026-07-01T10:00:00Z" },
  { ...base, kind: "ticket", id: "wk-tik-1", title: "Login is broken", status: "open", priority: "high", created_at: "2026-07-01T09:00:00Z" },
  { ...base, kind: "feature", id: "wk-feat-1", title: "Bulk export", status: "new", votes: 3, created_at: "2026-07-01T08:00:00Z" },
  { ...base, kind: "note", id: "wk-note-1", title: "Met Ada at the conference", status: null, sub_type: "meeting", created_at: "2026-07-01T07:00:00Z" },
  { ...base, kind: "feedback", id: "wk-fb-1", title: "Loves the new dashboard", status: null, rating: 5, created_at: "2026-07-01T06:00:00Z" },
];

async function stubWorklist(page: import("@playwright/test").Page) {
  await page.route("**/rest/v1/cs_worklist_admin**", (r) => {
    // Honour the ?kind=eq.<kind> filter the client sends, so the type filter is exercised for real.
    const kind = new URL(r.request().url()).searchParams.get("kind");
    const wanted = kind?.startsWith("eq.") ? kind.slice(3) : null;
    const body = wanted ? WORKLIST.filter((w) => w.kind === wanted) : WORKLIST;
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

test.describe("Worklist", () => {
  test("lists every Notes & CRM item type with a customer link and the right status control", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubWorklist(page);
    await page.getByRole("link", { name: "Worklist" }).click();
    await expect(page).toHaveURL(/\/worklist$/);

    // Assert against the desktop table (the mobile cards render the same content but hidden at ≥sm).
    const table = page.getByRole("table");
    for (const title of ["Call Ada about renewal", "Login is broken", "Bulk export", "Met Ada at the conference", "Loves the new dashboard"]) {
      await expect(table.getByText(title)).toBeVisible();
    }
    // Status-bearing items get an editable dropdown; notes/feedback are read-only.
    await expect(table.getByLabel("Status for Call Ada about renewal")).toHaveValue("todo");
    await expect(table.getByLabel("Status for Login is broken")).toHaveValue("open");
    await expect(table.getByLabel("Status for Met Ada at the conference")).toHaveCount(0);
    // Customer link points back to the detail page.
    await expect(table.getByRole("button", { name: CUSTOMER.name }).first()).toBeVisible();
  });

  test("updates a task's status inline", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubWorklist(page);
    let patched: unknown = null;
    await page.route("**/rest/v1/cs_task**", (r) => {
      if (r.request().method() === "PATCH") {
        patched = r.request().postDataJSON();
        return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...WORKLIST[0], status: "done" }) });
      }
      return r.fallback();
    });
    await page.goto("/worklist");

    const select = page.getByRole("table").getByLabel("Status for Call Ada about renewal");
    await select.selectOption("done");
    await expect(select).toHaveValue("done");
    expect(patched).toMatchObject({ status: "done" });
  });

  test("filters the list by type", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubWorklist(page);
    await page.goto("/worklist");

    await page.getByLabel("Filter by type").selectOption("ticket");
    await expect(page.getByRole("table").getByText("Login is broken")).toBeVisible();
    // The re-fetch is scoped to tickets, so the task drops out of the list entirely.
    await expect(page.getByText("Call Ada about renewal")).toHaveCount(0);
  });
});
