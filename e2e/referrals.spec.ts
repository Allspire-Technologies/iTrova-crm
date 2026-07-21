import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubReferrals } from "./support/supabase";

// Referrals module (§ referral program). Registry (admin-only writes) + applications queue +
// referred-signups view with the reward computed from referral_config.
test.describe("Referrals module", () => {
  const REFERRED = [
    { business_id: "biz-9", business_name: "Kano Grains", signed_up_at: "2026-07-10T09:00:00Z", code: "ADAOBI0305",
      referrer_name: "Ada Obi", referrer_kind: "affiliate", effective_share_percent: 25, plan_key: "pro",
      first_paid_at: "2026-07-15", total_paid_12m: 90000, converted: true, matched: true },
    { business_id: "biz-8", business_name: "Bright Stores", signed_up_at: "2026-07-08T09:00:00Z", code: "GHOSTCODE",
      referrer_name: null, referrer_kind: null, effective_share_percent: 25, plan_key: null,
      first_paid_at: null, total_paid_12m: 0, converted: false, matched: false },
  ];

  test("admin sees referred signups with the reward computed from config", async ({ page }) => {
    await signIn(page, { staff: true }); // default role = admin
    await stubReferrals(page, { referred: REFERRED });
    await page.goto("/referrals");
    await expect(page.getByRole("heading", { name: "Referrals" })).toBeVisible();
    // Converted affiliate referral: 25% of ₦90,000 = ₦22,500.
    const row = page.getByRole("row", { name: /Kano Grains/ });
    await expect(row.getByText("Paying")).toBeVisible();
    await expect(row.getByText(/22,500/)).toBeVisible();
    // Unregistered code is flagged and pays nothing yet.
    await expect(page.getByText("— unregistered code")).toBeVisible();
  });

  test("Add referrer offers only Affiliate and Staff (businesses opt in from their portal)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubReferrals(page);
    await page.goto("/referrals");
    await page.getByRole("tab", { name: "Referrers" }).click();
    await page.getByRole("button", { name: "Add referrer" }).click();
    const type = page.locator("select").first();
    await expect(type.locator("option")).toHaveText(["Affiliate", "Staff"]);
    // Code suggestion = name slug + last 4 phone digits.
    await page.getByRole("textbox").nth(0).fill("Ada Obi"); // Name
    await page.getByRole("textbox").nth(1).fill("0810 000 0305"); // Phone
    await page.getByRole("button", { name: "Suggest" }).click();
    await expect(page.getByRole("textbox").nth(2)).toHaveValue("ADAOBI0305"); // Code
    // Structured payout bank fields are present.
    await expect(page.getByText("Payout bank details")).toBeVisible();
    // With an email + the box ticked, saving emails the referrer their details.
    await page.getByRole("textbox").nth(3).fill("ada@x.example"); // Email
    const welcome = page.waitForRequest((r) => r.url().includes("/functions/v1/send-referrer-welcome") && r.method() === "POST");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await welcome;
  });

  test("a non-admin (support) cannot add referrers or edit program settings", async ({ page }) => {
    await signIn(page, { staff: true, role: "support" });
    await stubReferrals(page);
    await page.goto("/referrals");
    await page.getByRole("tab", { name: "Referrers" }).click();
    await expect(page.getByRole("button", { name: "Add referrer" })).toHaveCount(0);
    await page.getByRole("tab", { name: "Program settings" }).click();
    await expect(page.getByText("Only Management/Admin can change")).toBeVisible();
  });

  test("admin approves an affiliate application from the queue", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubReferrals(page, { applications: [
      { id: "app-1", name: "Tunde Bello", phone: "08030000000", email: "tunde@x.example", how_promote: "WhatsApp groups", status: "pending", created_at: "2026-07-17T00:00:00Z" },
    ] });
    await page.goto("/referrals");
    await page.getByRole("tab", { name: /Applications/ }).click();
    await expect(page.getByText("Tunde Bello")).toBeVisible();
    const patch = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_referrer_application") && r.method() === "PATCH");
    await page.getByRole("button", { name: "Approve" }).click();
    await patch;
  });
});
