import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubCustomers, stubMessaging, stubMessageLog, CUSTOMER } from "./support/supabase";

// The Messages module: a central log of every customer email sent (all customers), with the sender
// and status, backed by the cs_message_log RPC (visibility-scoped server-side).
test.describe("Messages module", () => {
  const ROWS = [
    { id: "m1", business_id: CUSTOMER.id, business_name: "Mama Put Foods", to_email: "ada@mamaput.example", subject: "Welcome to iTrova", template_key: "welcome", status: "sent", error: null, created_at: "2026-07-10T10:00:00Z", created_by: "u1", created_by_name: "Bola Adeyemi" },
    { id: "m2", business_id: "biz-2", business_name: "Kano Grains", to_email: "amina@kano.example", subject: "Renewal reminder", template_key: null, status: "failed", error: "Address bounced", created_at: "2026-07-09T09:00:00Z", created_by: "u2", created_by_name: "Joy Okon" },
  ];

  test("lists messages across customers with sender + status and links to the customer", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page); // so navigating into a customer doesn't error
    await stubMessageLog(page, ROWS);
    await page.goto("/messages");

    await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
    // Both customers' messages appear, with sender + status. Scope to the table — the page also
    // renders mobile cards in the DOM, so an unscoped getByText would match twice.
    const table = page.getByRole("table");
    await expect(table.getByText("Welcome to iTrova")).toBeVisible();
    await expect(table.getByText("Bola Adeyemi")).toBeVisible();
    await expect(table.getByText("Kano Grains")).toBeVisible();
    await expect(table.getByText("Address bounced")).toBeVisible();

    // Clicking a row opens that customer.
    await table.getByText("Welcome to iTrova").click();
    await expect(page).toHaveURL(new RegExp(`/customers/${CUSTOMER.id}`));
  });

  test("searching sends the term to the RPC", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubMessageLog(page, ROWS);
    await page.goto("/messages");
    await expect(page.getByRole("table").getByText("Welcome to iTrova")).toBeVisible();

    const searched = page.waitForRequest(
      (r) => r.url().includes("/rest/v1/rpc/cs_message_log") && (r.postData() ?? "").includes("Renewal"),
    );
    await page.getByPlaceholder("Search subject, customer or recipient…").fill("Renewal");
    await searched; // the debounced search passed p_search to the server
  });

  test("empty state when nothing has been sent", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubMessageLog(page, []);
    await page.goto("/messages");
    await expect(page.getByText("No messages yet")).toBeVisible();
  });

  test("paginates when there are more than a page of messages", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubMessageLog(page, ROWS, 60); // 60 total → 2 pages at 50/page
    await page.goto("/messages");

    await expect(page.getByText(/of 60/)).toBeVisible();
    await expect(page.getByText(/Page 1 of 2/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Prev/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /Next/ })).toBeEnabled();

    await page.getByRole("button", { name: /Next/ }).click();
    await expect(page.getByText(/Page 2 of 2/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Prev/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Next/ })).toBeDisabled();
  });

  test("Send message: compose to a customer picked from the list", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page); // powers the recipient picker search
    await stubMessaging(page); // templates + the send Edge Function
    await stubMessageLog(page, []);
    await page.goto("/messages");

    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Add a recipient from the searchable picker.
    await page.getByLabel("Add a customer").fill("Mama");
    await page.getByRole("button", { name: /Mama Put Foods/ }).click();
    await expect(page.getByText("Recipients (1)")).toBeVisible();

    // Freeform compose + send.
    await page.getByLabel("Email subject").fill("A quick update for you");
    await page.getByLabel("Email body").fill("Hello, here is our update.");
    const sent = page.waitForRequest(
      (r) => r.url().includes("/functions/v1/send-customer-email") && r.method() === "POST",
    );
    await page.getByRole("button", { name: /Send to 1/ }).click();
    const req = await sent;
    // Sent for the picked customer; the recipient is resolved server-side (browser never sets it).
    expect(req.postData() ?? "").toContain(CUSTOMER.id);
    expect(req.postData() ?? "").not.toContain("to_email");
  });

  test("Customers page: bulk Send message pre-fills the selected customers", async ({ page }) => {
    await signIn(page, { staff: true, role: "admin" });
    await stubCustomers(page);
    await stubMessaging(page);
    await page.goto("/customers");

    await page.getByRole("checkbox", { name: "Select Mama Put Foods" }).check();
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // The composer opens with the ticked customer already a recipient.
    await expect(page.getByText("Recipients (1)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove Mama Put Foods" })).toBeVisible();
  });
});
