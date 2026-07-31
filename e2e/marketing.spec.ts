import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./support/auth";

// Marketing module: AI-drafted calendar (free cloud models, browser-called) + share-intent posting.
const json = (r: Parameters<Parameters<Page["route"]>[1]>[0], body: unknown) =>
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const AI_SETTINGS = { marketing_ai: { provider: "groq", model: "llama-3.3-70b-versatile", keys: { groq: "gsk_test" }, productUrl: "https://allspire.tech/products" } };

const POSTS = [
  { id: "sp-1", scheduled_date: "2026-08-03", pillar: "tip", caption: "Count your stock weekly — small leaks sink shops.", hashtags: "#SME #Nigeria", card_text: "Count your stock weekly", status: "draft", posted_to: [], notes: null },
  { id: "sp-2", scheduled_date: "2026-08-05", pillar: "feature", caption: "iTrova invoices deduct stock automatically.", hashtags: "#Inventory", card_text: "Invoices that mind your stock", status: "approved", posted_to: [], notes: null },
];

async function stubMarketing(page: Page, posts: unknown[] = POSTS) {
  await page.route("**/rest/v1/cs_settings**", (r) => json(r, AI_SETTINGS));
  await page.route("**/rest/v1/cs_social_post**", (r) => {
    const m = r.request().method();
    if (m === "GET") return json(r, posts);
    return json(r, m === "POST" ? [] : {});
  });
}

async function gotoAugust(page: Page, time = "2026-08-15T10:00:00Z") {
  // Fixture posts live in Aug 2026 — pin the clock so the page opens on that month.
  await page.clock.setFixedTime(new Date(time));
  await page.goto("/marketing");
  await expect(page.getByRole("heading", { name: "Marketing" })).toBeVisible();
  await expect(page.getByText("August 2026").first()).toBeVisible();
}

test.describe("Marketing", () => {
  test("calendar lists drafts; approving a post PATCHes its status", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubMarketing(page);
    await gotoAugust(page);
    await expect(page.getByText("Count your stock weekly — small leaks sink shops.")).toBeVisible();
    await expect(page.getByText("1 draft")).toBeVisible();
    // August 2026 is the calendar floor — no navigating to earlier months.
    await expect(page.getByRole("button", { name: "Previous month" })).toBeDisabled();
    const patch = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_social_post") && r.method() === "PATCH");
    await page.getByRole("button", { name: "Approve" }).click();
    expect((await patch).postData() ?? "").toContain('"status":"approved"');
  });

  test("Share opens the logged-in account intents (X prefills the caption)", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubMarketing(page);
    await gotoAugust(page);
    await page.getByRole("button", { name: "Share" }).click();
    const x = page.getByRole("link", { name: "X (Twitter)" });
    await expect(x).toBeVisible();
    const href = await x.getAttribute("href");
    expect(href).toContain("twitter.com/intent/tweet?text=");
    expect(decodeURIComponent(href ?? "")).toContain("iTrova invoices deduct stock automatically.");
    await expect(page.getByRole("link", { name: /Facebook/ })).toHaveAttribute("href", /facebook\.com\/sharer/);
    await expect(page.getByRole("link", { name: /WhatsApp/ })).toHaveAttribute("href", /wa\.me/);
  });

  test("Generate month calls the free model and inserts drafts", async ({ page }) => {
    await signIn(page, { staff: true });
    await stubMarketing(page, []);
    const drafts = [
      { date: "2026-08-03", pillar: "tip", caption: "Price for profit, not just sales. https://allspire.tech/products", hashtags: "#SME", card_text: "Price for profit" },
      { date: "2026-08-05", pillar: "feature", caption: "See your top products in iTrova. https://allspire.tech/products", hashtags: "#Nigeria", card_text: "Know your top products" },
    ];
    await page.route("**/api.groq.com/**", (r) => json(r, { choices: [{ message: { content: JSON.stringify(drafts) } }] }));
    // Aug 1: only future slots (3rd, 5th, …) are schedulable — past days are never drafted.
    await gotoAugust(page, "2026-08-01T06:00:00Z");
    const insert = page.waitForRequest((r) => r.url().includes("/rest/v1/cs_social_post") && r.method() === "POST");
    await page.getByRole("button", { name: "Generate month" }).click();
    const body = (await insert).postData() ?? "";
    expect(body).toContain("Price for profit, not just sales.");
    expect(body).toContain('"scheduled_date":"2026-08-03"');
    await expect(page.getByText(/drafts? added/)).toBeVisible();
  });

  test("support staff can share but not generate or edit", async ({ page }) => {
    await signIn(page, { staff: true, role: "support" });
    await stubMarketing(page);
    await gotoAugust(page);
    await expect(page.getByRole("button", { name: "Generate month" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "AI settings" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
  });
});
