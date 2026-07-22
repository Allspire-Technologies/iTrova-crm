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

  test("approving an application auto-creates the affiliate (registry insert + status update)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubReferrals(page, { applications: [
      { id: "app-1", name: "Tunde Bello", phone: "08030000305", email: "tunde@x.example", how_promote: "WhatsApp groups", status: "pending", created_at: "2026-07-17T00:00:00Z" },
    ] });
    await page.goto("/referrals");
    await page.getByRole("tab", { name: /Applications/ }).click();
    await expect(page.getByText("Tunde Bello")).toBeVisible();
    const insert = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_referrer") && !r.url().includes("application") && r.method() === "POST");
    const patch = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_referrer_application") && r.method() === "PATCH");
    await page.getByRole("button", { name: "Approve" }).click();
    const req = await insert; await patch;
    // Created as an affiliate with the code suggested from the applicant's name + last-4 phone.
    expect(req.postData() ?? "").toContain('"kind":"affiliate"');
    expect(req.postData() ?? "").toContain("TUNDEBELLO0305");
  });

  test("admin marks an affiliate's accrued balance paid (confirm dialog → payout RPC)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubReferrals(page, { summary: [
      { code: "ADAOBI0305", name: "Ada Obi", kind: "affiliate", phone: "0810", email: "ada@x.example", active: true, business_id: null, effective_share_percent: 25, referred_count: 3, converted_count: 2, earned: 30000, paid: 0, accrued: 30000, bank_name: "GTB", account_number: "0123456789", account_name: "Ada Obi" },
    ] });
    await page.goto("/referrals");
    await page.getByRole("tab", { name: "Referrers" }).click();
    await expect(page.getByText("Ada Obi")).toBeVisible();
    await expect(page.getByRole("cell", { name: /30,000/ }).last()).toBeVisible(); // accrued
    await page.getByRole("button", { name: "Mark paid" }).click();
    await expect(page.getByRole("heading", { name: "Mark payout as paid" })).toBeVisible();
    const payout = page.waitForRequest((r) => r.url().includes("/rest/v1/rpc/cs_record_payout") && r.method() === "POST");
    await page.getByRole("button", { name: "Confirm paid" }).click();
    const req = await payout;
    expect(req.postData() ?? "").toContain('"p_kind":"cash"');
    expect(req.postData() ?? "").toContain('"p_amount":30000');
  });

  test("a business referrer shows on Referrers and its credit applies to their subscription", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubReferrals(page, { summary: [
      { code: "SUNRISE7811", name: "Sunrise Stores", kind: "business", phone: "0817", email: null, active: true, business_id: "biz-1", effective_share_percent: 25, referred_count: 4, converted_count: 3, earned: 60000, paid: 0, accrued: 60000, bank_name: null, account_number: null, account_name: null },
    ] });
    await page.goto("/referrals");
    await page.getByRole("tab", { name: "Referrers" }).click();
    await expect(page.getByText("Sunrise Stores")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Business" })).toBeVisible();
    await page.getByRole("button", { name: "Apply credit" }).click();
    await expect(page.getByRole("heading", { name: "Apply credit to subscription" })).toBeVisible();
    const payout = page.waitForRequest((r) => r.url().includes("/rest/v1/rpc/cs_record_payout") && r.method() === "POST");
    await page.getByRole("button", { name: "Apply credit", exact: true }).nth(1).click();
    const req = await payout;
    expect(req.postData() ?? "").toContain('"p_kind":"subscription"');
    expect(req.postData() ?? "").toContain('"p_business_id":"biz-1"');
  });
});
