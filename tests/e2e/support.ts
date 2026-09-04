import path from "node:path";

export const E2E_EMAIL = "laundry.browser@local.test";
export const E2E_PASSWORD = "LaundryBrowser1";
export const E2E_HOUSEHOLD = "Browser Test Household";
export const AUTH_STATE_PATH = path.join(process.cwd(), "tests", "e2e", ".auth", "user.json");

export function requireLocalUrl(value: string | undefined, variable: string) {
  if (!value) throw new Error(`${variable} is required for full-stack browser tests.`);
  const parsed = new URL(value);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsed.hostname)) {
    throw new Error(`${variable} must point to localhost. Refusing to mutate a hosted environment.`);
  }
  return value;
}
