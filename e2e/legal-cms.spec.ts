import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";

// Legal documents (Terms, Privacy, DPA, Affiliate Terms) are versioned rows the websites read;
// both consoles edit them through the generic CollectionTab.
const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const ITROVA_DOCS = [
  { id: "d1", slug: "terms", title: "Terms of Service", body_md: "# Terms", effective_at: "2026-09-11", published: true },
  { id: "d2", slug: "affiliate-terms", title: "Affiliate Programme Terms", body_md: "Pays {{affiliate_share_percent}}%", effective_at: "2026-09-11", published: true },
];
const ALLSPIRE_DOCS = [
  { id: "a1", slug: "privacy", title: "Privacy Policy", body_md: "# Privacy", effective_at: "2026-09-11", published: false },
];

test.describe("Legal documents in the CMS consoles", () => {
  test("Website console lists iTrova legal docs and an admin can add a new version", async ({ page }) => {
    await signIn(page, { staff: true });
    await page.route("**/rest/v1/cms_legal_doc**", (r) => {
      if (r.request().method() === "POST") return r.fulfill(json([JSON.parse(r.request().postData() || "{}")]));
      return r.fulfill(json(ITROVA_DOCS));
    });
    await page.goto("/website");
    await page.getByRole("tab", { name: "Legal" }).click();
    await expect(page.getByText("Terms of Service")).toBeVisible();
    await expect(page.getByText("Affiliate Programme Terms")).toBeVisible();

    const insert = page.waitForRequest((r) => r.url().includes("/rest/v1/cms_legal_doc") && r.method() === "POST");
    await page.getByRole("button", { name: "New" }).click();
    await page.getByLabel(/^Document/).selectOption("privacy");
    await page.getByLabel(/^Title/).fill("Privacy Policy");
    await page.getByLabel(/^Effective date/).fill("2026-10-01");
    await page.getByLabel(/^Body/).fill("# Privacy\n\nUpdated.");
    await page.getByRole("button", { name: "Save" }).click();
    const body = (await insert).postData() ?? "";
    expect(body).toContain('"slug":"privacy"');
    expect(body).toContain('"effective_at":"2026-10-01"');
  });

  test("Allspire console has a Legal tab; support can read but not add", async ({ page }) => {
    await signIn(page, { staff: true, role: "support" });
    await page.route("**/rest/v1/as_legal_doc**", (r) => r.fulfill(json(ALLSPIRE_DOCS)));
    await page.goto("/allspire");
    await page.getByRole("tab", { name: "Legal" }).click();
    await expect(page.getByText("Privacy Policy")).toBeVisible();
    await expect(page.getByRole("button", { name: "New" })).toHaveCount(0);
  });
});
