import { expect, test, type Page } from "@playwright/test";

type Battery = {
  name: string;
  capacity: string;
  power: string;
  efficiency: string;
  minSoc: string;
  maxSoc: string;
  cycles: string;
};

async function fillBattery(page: Page, b: Battery) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Batteries" })).toBeVisible();
  await page.getByLabel("Name").fill(b.name);
  await page.getByLabel("Energy capacity (MWh)").fill(b.capacity);
  await page.getByLabel("Power (MW)").fill(b.power);
  await page.getByLabel("Round-trip efficiency (%)").fill(b.efficiency);
  await page.getByLabel("Min SoC (%)").fill(b.minSoc);
  await page.getByLabel("Max SoC (%)").fill(b.maxSoc);
  await page.getByLabel("Max cycles per day").fill(b.cycles);
  await page.getByRole("button", { name: "Add battery" }).click();
}

const valid: Omit<Battery, "name"> = {
  capacity: "100",
  power: "50",
  efficiency: "88",
  minSoc: "10",
  maxSoc: "90",
  cycles: "1.5",
};

// Strip the client-side guards, as a stale tab or hand-made request would, to hit the server check.
async function forceSubmit(page: Page, button: string) {
  await page.evaluate((name) => {
    document.querySelectorAll("input").forEach((i) => { i.removeAttribute("min"); i.removeAttribute("max"); });
    [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === name)?.removeAttribute("disabled");
  }, button);
  await page.getByRole("button", { name: button }).click();
}

test("prevents, then rejects, a battery with impossible efficiency", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Name").fill(`E2E bad ${Date.now()}`);
  await page.getByLabel("Round-trip efficiency (%)").fill("120");
  // Prevent: the reason is shown and the action is unavailable.
  await expect(page.getByTestId("battery-problems")).toContainText(/efficiency/i);
  await expect(page.getByRole("button", { name: "Add battery" })).toBeDisabled();
  // Enforce: the server still refuses. Next.js also renders an empty role="alert" route announcer, so match on text.
  await forceSubmit(page, "Add battery");
  await expect(page.getByRole("alert").filter({ hasText: /efficiency/i })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("max SoC cannot be set below min SoC", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Min SoC (%)").fill("60");
  await expect(page.getByLabel("Max SoC (%)")).toHaveAttribute("min", "61");
  await page.getByLabel("Max SoC (%)").fill("40");
  await expect(page.getByTestId("battery-problems")).toContainText("Min SoC must be below max SoC");
  await expect(page.getByRole("button", { name: "Add battery" })).toBeDisabled();
});

test("create battery, generate, approve and execute a plan", async ({ page }) => {
  const name = `E2E ${Date.now()}`;
  await fillBattery(page, { ...valid, name });

  await expect(page).toHaveURL(/\/batteries\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  await page.getByLabel("Delivery date").fill("2026-10-14");
  await page.getByRole("button", { name: "Generate plan" }).click();

  const status = page.getByTestId("plan-status");
  const approve = page.getByRole("button", { name: "Approve plan" });
  const execute = page.getByRole("button", { name: "Mark executed" });

  await expect(page).toHaveURL(/\/plans\/[^/]+$/);
  await expect(status).toHaveText("draft");
  await expect(page.getByText("Expected P&L").first()).toBeVisible();
  await expect(execute).toBeHidden();

  await approve.click();
  await expect(status).toHaveText("approved");
  await expect(approve).toBeHidden();

  await execute.click();
  await expect(status).toHaveText("executed");
  await expect(page.getByText("Realised P&L").first()).toBeVisible();

  await page.screenshot({ path: "e2e/screenshots/executed-plan.png", fullPage: true });
});
