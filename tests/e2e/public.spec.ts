import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("public authentication shell", () => {
  test("explains password requirements before calling Supabase", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Pick up where your money left off." })).toBeVisible();
    await page.getByRole("button", { name: "Need an account? Create one" }).click();
    await page.getByLabel("Email").fill("browser@example.com");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("status")).toHaveText(/at least 12 characters.*uppercase.*lowercase.*number/i);
    await expect(page.getByLabel("Password requirements")).toBeVisible();
  });

  test("has no automatic WCAG A or AA violations", async ({ page }) => {
    await page.goto("/login");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("reflows without horizontal clipping", async ({ page }) => {
    await page.goto("/login");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "Need an account? Create one" })).toBeVisible();
  });

  test("publishes an installable manifest with Laundry icons", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();
    expect(manifest).toMatchObject({ name: "Laundry", short_name: "Laundry", display: "standalone", start_url: "/" });
    expect(manifest.icons).toEqual(expect.arrayContaining([expect.objectContaining({ sizes: "192x192" }), expect.objectContaining({ sizes: "512x512" })]));
  });
});
