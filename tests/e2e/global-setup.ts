import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { AUTH_STATE_PATH, E2E_EMAIL, E2E_HOUSEHOLD, E2E_PASSWORD, requireLocalUrl } from "./support";

export default async function globalSetup(config: FullConfig) {
  const supabaseUrl = requireLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for full-stack browser tests.");
  const baseURL = requireLocalUrl(String(config.projects[0]?.use.baseURL ?? ""), "PLAYWRIGHT_BASE_URL");
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (existing.error) throw existing.error;
  for (const user of existing.data.users.filter((candidate) => candidate.email === E2E_EMAIL)) {
    const removed = await admin.auth.admin.deleteUser(user.id);
    if (removed.error) throw removed.error;
  }

  const created = await admin.auth.admin.createUser({
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: "Browser Test" },
  });
  if (created.error) throw created.error;

  const today = bogotaDate();
  const rates = await admin.rpc("store_daily_exchange_rates", {
    target_date: today,
    usd_cop: 4_000,
    eur_cop: 4_500,
    usd_observed_on: today,
    eur_observed_on: today,
  });
  if (rates.error) throw rates.error;

  await mkdir(dirname(AUTH_STATE_PATH), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    await page.goto("/login");
    await page.getByLabel("Email").fill(E2E_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/onboarding$/);
    await page.getByLabel("Household name").fill(E2E_HOUSEHOLD);
    await page.getByLabel("Reporting currency").selectOption("COP");
    await page.getByLabel("Default shopping tax rate").fill("19");
    await page.getByRole("button", { name: "Create household" }).click();
    await page.waitForURL(new RegExp(`${escapeRegex(baseURL)}/?$`));
    await page.getByRole("heading", { name: "Your Money, in Motion." }).waitFor();
    await page.context().storageState({ path: AUTH_STATE_PATH });
  } catch (error) {
    await admin.auth.admin.deleteUser(created.data.user.id);
    throw error;
  } finally {
    await browser.close();
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bogotaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
