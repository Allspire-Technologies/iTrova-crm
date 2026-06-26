import { test, expect } from "@playwright/test";
import { signIn } from "./support/auth";
import { stubAuth, SESSION_BODY } from "./support/supabase";

test.describe("Set password (invited staff)", () => {
  test("verifies an invite token (own-domain link) then shows the form", async ({ page }) => {
    await stubAuth(page, { staff: true });
    await page.route("**/auth/v1/verify**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION_BODY) }),
    );
    await page.goto("/set-password?token_hash=tok_abc123&type=invite");

    await expect(page.getByRole("heading", { name: "Set your password" })).toBeVisible();
    await expect(page.getByLabel("New password")).toBeVisible();
  });

  test("a signed-in invitee sees the name + password form", async ({ page }) => {
    // The invite link establishes a session; we model that with a normal signed-in session.
    await signIn(page, { staff: true });
    await page.goto("/set-password");

    await expect(page.getByRole("heading", { name: "Set your password" })).toBeVisible();
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByLabel("New password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Set password & continue" })).toBeVisible();
  });

  test("without a session it points the visitor back to their invite link", async ({ page }) => {
    await page.goto("/set-password");
    await expect(page.getByText("open it from your invite link", { exact: false })).toBeVisible();
  });
});
