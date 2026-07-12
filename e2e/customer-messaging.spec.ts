import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubCustomers, stubMessaging, CUSTOMER } from "./support/supabase";

// Direct customer email (Management/Admin + Support): a Messages tab on Customer Detail with a
// template/freeform composer + history. Sending goes through the send-customer-email Edge Function.
test.describe("Customer messaging (§ email)", () => {
  async function openMessages(page: import("@playwright/test").Page) {
    await page.goto(`/customers/${CUSTOMER.id}`);
    await page.getByText("Notes & CRM", { exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole("tab", { name: "Messages" }).click();
  }

  test("an admin sends a templated email (calls the Edge Function)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await stubMessaging(page);
    await openMessages(page);

    // Pick a template → subject/body prefill with merge fields applied.
    await page.getByLabel("Email template").selectOption("welcome");
    await expect(page.getByLabel("Email subject")).toHaveValue(/Mama Put Foods/);

    const send = page.waitForRequest(
      (r) => r.url().includes("/functions/v1/send-customer-email") && r.method() === "POST",
    );
    await page.getByRole("button", { name: "Send email" }).click();
    const req = await send;
    // The browser never chooses the recipient — the function resolves the owner server-side.
    expect(req.postData() ?? "").not.toContain("to_email");
  });

  test("support can compose and send", async ({ page }) => {
    await signIn(page, { staff: true, role: "support" });
    await stubCustomers(page);
    await stubMessaging(page);
    await openMessages(page);

    await expect(page.getByLabel("Email subject")).toBeVisible();
    await page.getByLabel("Email subject").fill("Quick check-in");
    const body = page.getByLabel("Email body");
    await body.fill("Hello, just checking in.");
    // Bold it via the toolbar — the rich-text editor should emit real HTML, not plain text.
    await body.selectText();
    await page.getByRole("button", { name: "Bold" }).click();

    const send = page.waitForRequest(
      (r) => r.url().includes("/functions/v1/send-customer-email") && r.method() === "POST",
    );
    await page.getByRole("button", { name: "Send email" }).click();
    const req = await send;
    expect(req.postData() ?? "").toContain("<strong>Hello, just checking in.</strong>");
  });

  test("a CSO sees history but cannot compose", async ({ page }) => {
    await signIn(page, { staff: true, role: "cso" });
    await stubCustomers(page);
    await stubMessaging(page, {
      history: [
        { id: "m1", business_id: CUSTOMER.id, to_email: "ada@mamaput.example", subject: "Welcome to iTrova", template_key: "welcome", status: "sent", error: null, created_at: CUSTOMER.created_at, created_by: "u1", created_by_name: "Bola Adeyemi" },
      ],
    });
    await openMessages(page);

    await expect(page.getByText("Only Management/Admin and Support can email customers.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send email" })).toHaveCount(0);
    await expect(page.getByText("Welcome to iTrova")).toBeVisible(); // history still readable
    await expect(page.getByText(/by Bola Adeyemi/)).toBeVisible(); // the log shows who sent it
  });

  test("send is disabled when the customer has no owner email", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubCustomers(page);
    await stubMessaging(page);
    // No owner email on file for this business.
    await page.route("**/rest/v1/rpc/admin_business_profile**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ industry: "Food & Beverage", owner_email: null }]) }),
    );
    await openMessages(page);

    await expect(page.getByText("no owner email on file")).toBeVisible();
    // Even with a complete subject + body, Send stays disabled without a recipient.
    await page.getByLabel("Email subject").fill("Hello");
    await page.getByLabel("Email body").fill("A message.");
    await expect(page.getByRole("button", { name: "Send email" })).toBeDisabled();
  });
});
