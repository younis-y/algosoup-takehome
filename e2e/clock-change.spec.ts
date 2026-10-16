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

const valid: Omit<Battery, "name"> = {
  capacity: "100",
  power: "50",
  efficiency: "88",
  minSoc: "10",
  maxSoc: "90",
  cycles: "1.5",
};

async function generatePlan(page: Page, deliveryDate: string) {
  await fillBattery(page, { ...valid, name: `E2E clock ${Date.now()}` });
  await expect(page).toHaveURL(/\/batteries\/[^/]+$/);

  await page.getByLabel("Which day are you planning?", { exact: true }).fill(deliveryDate);
  await page.getByRole("button", { name: "Generate plan" }).click();

  // First request for a date fetches prices live from Elexon, so allow extra time.
  await expect(page).toHaveURL(/\/plans\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByTestId("plan-status")).toHaveText("draft");
}

test("spring forward: 46-period delivery day is fully priced", async ({ page }) => {
  await generatePlan(page, "2026-03-29");

  await expect(page.getByText("46 settlement periods")).toBeVisible();
  // The forecast day (03-28) has 48 periods, which covers periods 1..46.
  await expect(page.getByText(/No forecast price for period/)).toHaveCount(0);
});

test("fall back: 50-period delivery day flags periods 49 and 50 as unpriced", async ({
  page,
}) => {
  await generatePlan(page, "2025-10-26");

  await expect(page.getByText("50 settlement periods")).toBeVisible();
  // The forecast day (10-25) has only 48 periods, so 49 and 50 have no price.
  await expect(page.getByText("No forecast price for periods 49, 50")).toBeVisible();
});
