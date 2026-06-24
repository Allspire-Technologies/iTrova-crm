import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:8090",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npx vite preview --port 8090 --strictPort",
    url: "http://localhost:8090",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      E2E: "true",
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-anon-key",
    },
  },
});
