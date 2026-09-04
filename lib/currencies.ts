import { SUPPORTED_CURRENCIES } from "./money";

export function buildCurrencyOptions(locale: string, preferredCodes: Array<string | null | undefined>) {
  const normalizedPreferred = preferredCodes
    .map((code) => code?.trim().toUpperCase())
    .filter((code): code is string => Boolean(code && SUPPORTED_CURRENCIES.includes(code as (typeof SUPPORTED_CURRENCIES)[number])));
  const displayNames = new Intl.DisplayNames(locale, { type: "currency" });

  return [...new Set([...normalizedPreferred, ...SUPPORTED_CURRENCIES])].map((code) => ({
    value: code,
    label: code,
    meta: displayNames.of(code) ?? code,
  }));
}
