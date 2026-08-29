const COMMON_CURRENCY_CODES = ["COP", "USD", "EUR", "GBP", "CAD", "MXN", "BRL", "ARS", "CLP", "PEN", "JPY", "CNY", "AUD", "CHF"];

export function buildCurrencyOptions(locale: string, preferredCodes: Array<string | null | undefined>) {
  const normalizedPreferred = preferredCodes
    .map((code) => code?.trim().toUpperCase())
    .filter((code): code is string => Boolean(code && /^[A-Z]{3}$/.test(code)));
  const displayNames = new Intl.DisplayNames(locale, { type: "currency" });

  return [...new Set([...normalizedPreferred, ...COMMON_CURRENCY_CODES])].map((code) => ({
    value: code,
    label: code,
    meta: displayNames.of(code) ?? code,
  }));
}
