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
  await page.getByLabel("What's it called?", { exact: true }).fill(b.name);
  await page.getByLabel("How much energy can it store?", { exact: true }).fill(b.capacity);
  await page.getByLabel("How fast can it fill up or empty?", { exact: true }).fill(b.power);
  await page.getByLabel("How much energy comes back out?", { exact: true }).fill(b.efficiency);
  await page.getByLabel("Minimum charge (%)", { exact: true }).fill(b.minSoc);
  await page.getByLabel("Maximum charge (%)", { exact: true }).fill(b.maxSoc);
  await page.getByLabel("How many full fills a day?", { exact: true }).fill(b.cycles);
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
// Every <input> is covered, including both halves of the "Keep its charge between" range field.
async function forceSubmit(page: Page, button: string) {
  await page.evaluate((name) => {
    document.querySelectorAll("input").forEach((i) => { i.removeAttribute("min"); i.removeAttribute("max"); });
    [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === name)?.removeAttribute("disabled");
  }, button);
  await page.getByRole("button", { name: button }).click();
}

test("prevents, then rejects, a battery with impossible efficiency", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("What's it called?", { exact: true }).fill(`E2E bad ${Date.now()}`);
  await page.getByLabel("How much energy comes back out?", { exact: true }).fill("120");
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
  // Min and max SoC share one range field but stay separate inputs.
  await expect(page.getByRole("group", { name: "Keep its charge between" })).toBeVisible();
  await page.getByLabel("Minimum charge (%)", { exact: true }).fill("60");
  await expect(page.getByLabel("Maximum charge (%)", { exact: true })).toHaveAttribute("min", "61");
  await page.getByLabel("Maximum charge (%)", { exact: true }).fill("40");
  await expect(page.getByTestId("battery-problems")).toContainText("The lower charge limit must be below the upper one");
  await expect(page.getByRole("button", { name: "Add battery" })).toBeDisabled();
});

test("create battery, generate, approve and execute a plan", async ({ page }) => {
  const name = `E2E ${Date.now()}`;
  await fillBattery(page, { ...valid, name });

  await expect(page).toHaveURL(/\/batteries\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  await page.getByLabel("Which day are you planning?", { exact: true }).fill("2026-10-14");
  await page.getByRole("button", { name: "Make a plan" }).click();

  const status = page.getByTestId("plan-status");
  const approve = page.getByRole("button", { name: "Approve plan" });
  const execute = page.getByRole("button", { name: "Mark as done" });

  await expect(page).toHaveURL(/\/plans\/[^/]+$/);
  await expect(status).toHaveText("Draft");
  await expect(page.getByText("Expected P&L").first()).toBeVisible();
  // Seeded NESO prices for 2026-10-14 make Dynamic Containment worth committing.
  await expect(page.getByTestId("pnl-mix")).toContainText("more than buying and selling alone");
  await expect(execute).toBeHidden();

  await approve.click();
  await expect(status).toHaveText("Approved");
  await expect(approve).toBeHidden();

  await execute.click();
  await expect(status).toHaveText("Done");
  await expect(page.getByText("Realised P&L").first()).toBeVisible();

  await page.screenshot({ path: "e2e/screenshots/executed-plan.png", fullPage: true });
});
