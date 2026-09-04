export const SUPPORTED_CURRENCIES = ["COP", "USD", "EUR"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
export type CurrencyRates = Partial<Record<SupportedCurrency, number>>;

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return SUPPORTED_CURRENCIES.includes(value.trim().toUpperCase() as SupportedCurrency);
}

export function formatMoney(amount: number, currency: string, locale = "en-US") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: currency === "COP" ? 0 : 2,
    maximumFractionDigits: currency === "COP" ? 0 : 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function currencyRate(source: string, target: string, copPerUnit: CurrencyRates) {
  const normalizedSource = source.trim().toUpperCase();
  const normalizedTarget = target.trim().toUpperCase();
  if (normalizedSource === normalizedTarget) return 1;
  if (!isSupportedCurrency(normalizedSource) || !isSupportedCurrency(normalizedTarget)) return null;
  const sourceRate = copPerUnit[normalizedSource];
  const targetRate = copPerUnit[normalizedTarget];
  if (!sourceRate || !targetRate || sourceRate <= 0 || targetRate <= 0) return null;
  return sourceRate / targetRate;
}

export function convertMoney(amount: number, source: string, target: string, copPerUnit: CurrencyRates) {
  const rate = currencyRate(source, target, copPerUnit);
  return rate === null ? null : amount * rate;
}

type ReportingPosition = { reportingBalance: number | null };
type DebtPosition = ReportingPosition & {
  accountId: string | null;
  direction: "payable" | "receivable";
};

export function netWorthFromPositions(accounts: ReportingPosition[], debts: DebtPosition[]) {
  const accountTotal = accounts.reduce((total, account) => total + (account.reportingBalance ?? 0), 0);
  const unlinkedDebtTotal = debts
    .filter((debt) => !debt.accountId)
    .reduce(
      (total, debt) => total + (debt.direction === "receivable" ? 1 : -1) * (debt.reportingBalance ?? 0),
      0,
    );

  return accountTotal + unlinkedDebtTotal;
}
