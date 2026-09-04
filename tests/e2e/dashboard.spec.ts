import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { AUTH_STATE_PATH } from "./support";

const fullStack = process.env.E2E_FULL_STACK === "1";
test.use({ storageState: fullStack ? AUTH_STATE_PATH : { cookies: [], origins: [] } });
test.skip(!fullStack, "Start the local Supabase stack and set E2E_FULL_STACK=1 to run authenticated flows.");

async function openWorkspace(page: Page, label: string) {
  await page.getByRole("navigation", { name: /Finance Workspace/i }).getByRole("button", { name: label, exact: true }).click();
}

async function choose(page: Page, label: string, option: string) {
  const field = page.locator(".select-field").filter({ has: page.locator(".select-label", { hasText: label }) }).first();
  await field.getByRole("button").first().click();
  await page.getByRole("option", { name: new RegExp(`^${option}(?:$|\\s|·)`, "i") }).click();
}

test.describe.serial("authenticated finance workspace", () => {
  test("keeps the dashboard accessible and its actions contextual", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop navigation contract");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your Money, in Motion." })).toBeVisible();
    await expect(page.getByRole("button", { name: /Post Transaction/i })).toBeVisible();
    await openWorkspace(page, "Accounts");
    await expect(page.getByRole("button", { name: /Add Account/i })).toBeVisible();
    await openWorkspace(page, "Plans");
    await expect(page.getByRole("button", { name: /Create Plan/i })).toBeVisible();
    await openWorkspace(page, "Shopping");
    await expect(page.getByRole("button", { name: /New List/i })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("creates an account and posts foreign-currency income", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Mutations run once against the shared local fixture");
    await page.goto("/");
    await openWorkspace(page, "Accounts");
    const accountForm = page.locator("#account-form form");
    await accountForm.getByLabel("Name").fill("USD Wallet");
    await choose(page, "Currency", "US Dollar");
    await accountForm.getByLabel("Opening balance").fill("100");
    await accountForm.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("status")).toContainText("Saved");
    await expect(page.getByText("USD Wallet", { exact: true })).toBeVisible();

    await openWorkspace(page, "Activity");
    await choose(page, "Type", "Income");
    await choose(page, "Account", "USD Wallet");
    await choose(page, "Category", "Salary");
    const entry = page.locator("#transaction-form form");
    await entry.getByLabel("Amount").fill("25");
    await entry.getByRole("button", { name: "Post transaction" }).click();
    await expect(page.getByRole("status")).toContainText("Transaction posted");
    await expect(page.getByText(/USD Wallet/).first()).toBeVisible();
  });

  test("keeps navigation and content inside a narrow mobile viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile navigation contract");
    await page.goto("/");
    const mobileNav = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(mobileNav).toBeVisible();
    await mobileNav.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Open accounts" }).click();
    await expect(page.getByRole("heading", { name: "Every Balance, Accounted For." })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
