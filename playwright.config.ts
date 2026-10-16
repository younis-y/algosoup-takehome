import { defineConfig, devices } from "@playwright/test";

const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://algosoup-takehome-ten.vercel.app",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // Only needed for SSO-protected deployment URLs; the production alias is public.
    extraHTTPHeaders: bypass
      ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" }
      : undefined,
  },
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"] } }],
});
