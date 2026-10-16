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
  await page.getByLabel("How fast can it charge or discharge?", { exact: true }).fill(b.power);
  await page.getByLabel("How much comes back after a round trip?", { exact: true }).fill(b.efficiency);
  await page.getByLabel("Minimum charge (%)", { exact: true }).fill(b.minSoc);
  await page.getByLabel("Maximum charge (%)", { exact: true }).fill(b.maxSoc);
  await page.getByLabel("Cycles allowed per day", { exact: true }).fill(b.cycles);
  await page.getByRole("button", { name: "Add battery" }).click();
}

const DATE = "2026-10-14";

test("an approved plan cannot be overwritten by regenerating the same date", async ({ page }) => {
  const name = `E2E integrity ${Date.now()}`;
  await fillBattery(page, {
    name,
    capacity: "100",
    power: "50",
    efficiency: "88",
    minSoc: "10",
    maxSoc: "90",
    cycles: "1.5",
  });

  await expect(page).toHaveURL(/\/batteries\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const batteryUrl = page.url();

  await page.getByLabel("Which day are you planning?", { exact: true }).fill(DATE);
  await page.getByRole("button", { name: "Generate plan" }).click();

  const status = page.getByTestId("plan-status");
  await expect(page).toHaveURL(/\/plans\/[^/]+$/);
  await expect(status).toHaveText("draft");

  await page.getByRole("button", { name: "Approve plan" }).click();
  await expect(status).toHaveText("approved");
  const planUrl = page.url();

  // Try to regenerate the same date from the battery page.
  await page.goto(batteryUrl);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.getByLabel("Which day are you planning?", { exact: true }).fill(DATE);
  // Prevent: the UI explains and disables regeneration for an approved date.
  await expect(page.getByTestId("plan-locked")).toContainText("already approved");
  const generate = page.getByRole("button", { name: "Generate plan" });
  await expect(generate).toBeDisabled();

  // Enforce: re-enable the button as a stale tab would; the database guard still refuses.
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Generate plan")?.removeAttribute("disabled"));
  await generate.click();
  // Next.js also renders an empty role="alert" route announcer, so match on text.
  await expect(
    page.getByRole("alert").filter({ hasText: /already approved and can't be regenerated/ }),
  ).toBeVisible();
  await expect(page).toHaveURL(batteryUrl);

  // The approved plan row must be untouched.
  await page.goto(planUrl);
  await expect(status).toHaveText("approved");
});
