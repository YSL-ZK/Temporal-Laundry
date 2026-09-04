import { currencyRate, type CurrencyRates, type SupportedCurrency } from "./money";
import type { DashboardData } from "./dashboard";

export const REPORT_PERIODS = [3, 6, 12] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
export type ReportKind = "all" | "income" | "expense";

export type ReportFilters = {
  months: ReportPeriod;
  currency: SupportedCurrency;
  accountId: string;
  categoryId: string;
  kind: ReportKind;
};

export type ReportSource = {
  asOf: string;
  householdCurrency: string;
  currentRates: CurrencyRates;
  transactions: Array<{
    occurredOn: string;
    kind: "income" | "expense";
    amount: number;
    currency: string;
    reportingExchangeRate: number;
    accountId: string;
    categoryId: string | null;
    category: string | null;
  }>;
  accounts: Array<{
    id: string;
    name: string;
    currency: string;
    openingBalance: number;
    trackingStartedOn: string;
    archivedAt: string | null;
  }>;
  entries: Array<{ accountId: string; amount: number; occurredOn: string }>;
  debts: Array<{
    id: string;
    accountId: string | null;
    direction: "payable" | "receivable";
    balance: number;
    currency: string;
    trackingStartedOn: string;
  }>;
  debtPayments: Array<{ debtId: string; amount: number; paidOn: string }>;
  rates: Array<{ valuationDate: string; currency: SupportedCurrency; copPerUnit: number }>;
  truncated: boolean;
};

export type FinanceReport = {
  from: string;
  to: string;
  currency: SupportedCurrency;
  income: number;
  expense: number;
  netCashFlow: number;
  openingNetWorth: number | null;
  closingNetWorth: number | null;
  months: Array<{ key: string; cutoff: string; income: number; expense: number; netWorth: number | null }>;
  categories: Array<{ name: string; amount: number }>;
  transactionCount: number;
  missingConversions: number;
  estimatedConversions: number;
  truncated: boolean;
};

export function reportSourceFromDashboard(data: DashboardData): ReportSource {
  if (!data.household) throw new Error("Household required for reporting");
  return {
    asOf: data.asOf,
    householdCurrency: data.household.currency,
    currentRates: data.exchangeRates?.copPerUnit ?? {},
    transactions: data.reportTransactions,
    accounts: data.reportAccounts,
    entries: data.reportEntries,
    debts: data.debts,
    debtPayments: data.debtPayments,
    rates: data.reportRates,
    truncated: data.reportDataTruncated,
  };
}

function utcDate(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function monthCutoff(key: string, asOf: string) {
  if (key === asOf.slice(0, 7)) return asOf;
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10);
}

export function reportRange(asOf: string, months: ReportPeriod) {
  const anchor = utcDate(asOf);
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - (months - 1), 1, 12));
  return { from: first.toISOString().slice(0, 10), to: asOf };
}

function reportingToDisplayRate(source: ReportSource, target: SupportedCurrency, on: string) {
  if (source.householdCurrency === target) return { rate: 1, estimated: false };
  const requested = [source.householdCurrency, target];
  const selected = requested.map((currency) => {
    if (currency === "COP") return { value: 1, estimated: false };
    const matches = source.rates
      .filter((row) => row.currency === currency)
      .sort((left, right) => left.valuationDate.localeCompare(right.valuationDate));
    const historical = matches.filter((row) => row.valuationDate <= on).at(-1);
    if (historical) return { value: historical.copPerUnit, estimated: false };
    const earliest = matches[0];
    if (earliest) return { value: earliest.copPerUnit, estimated: true };
    const current = source.currentRates[currency as SupportedCurrency];
    return current ? { value: current, estimated: true } : null;
  });
  if (selected.some((item) => item === null)) return null;
  return {
    rate: selected[0]!.value / selected[1]!.value,
    estimated: selected.some((item) => item!.estimated),
  };
}

function nativeToDisplayRate(source: ReportSource, nativeCurrency: string, target: SupportedCurrency, on: string) {
  if (nativeCurrency === target) return { rate: 1, estimated: false };
  const rates: CurrencyRates = { COP: 1 };
  let estimated = false;
  for (const currency of [nativeCurrency, target]) {
    if (currency === "COP") continue;
    const matches = source.rates
      .filter((row) => row.currency === currency)
      .sort((left, right) => left.valuationDate.localeCompare(right.valuationDate));
    const historical = matches.filter((row) => row.valuationDate <= on).at(-1);
    const selected = historical ?? matches[0];
    const value = selected?.copPerUnit ?? source.currentRates[currency as SupportedCurrency];
    if (!value) return null;
    rates[currency as SupportedCurrency] = value;
    if (!historical) estimated = true;
  }
  const rate = currencyRate(nativeCurrency, target, rates);
  return rate === null ? null : { rate, estimated };
}

export function buildFinanceReport(source: ReportSource, filters: ReportFilters): FinanceReport {
  const { from, to } = reportRange(source.asOf, filters.months);
  const monthRows = Array.from({ length: filters.months }, (_, index) => {
    const start = utcDate(from);
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1, 12));
    const key = monthKey(date);
    return { key, cutoff: monthCutoff(key, to), income: 0, expense: 0, netWorth: null as number | null };
  });
  const rowsByMonth = new Map(monthRows.map((row) => [row.key, row]));
  const categoryTotals = new Map<string, number>();
  let missingConversions = 0;
  let estimatedConversions = 0;

  const transactions = source.transactions.filter((transaction) =>
    transaction.occurredOn >= from
    && transaction.occurredOn <= to
    && (!filters.accountId || transaction.accountId === filters.accountId)
    && (!filters.categoryId || transaction.categoryId === filters.categoryId)
    && (filters.kind === "all" || transaction.kind === filters.kind));

  for (const transaction of transactions) {
    let amount = transaction.amount;
    if (transaction.currency !== filters.currency) {
      const displayRate = reportingToDisplayRate(source, filters.currency, transaction.occurredOn);
      if (!displayRate) {
        missingConversions += 1;
        continue;
      }
      if (displayRate.estimated) estimatedConversions += 1;
      amount = transaction.amount * transaction.reportingExchangeRate * displayRate.rate;
    }
    const month = rowsByMonth.get(transaction.occurredOn.slice(0, 7));
    if (month) month[transaction.kind] += amount;
    if (transaction.kind === "expense") {
      const category = transaction.category ?? "Uncategorized";
      categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + amount);
    }
  }

  for (const month of monthRows) {
    let total = 0;
    let complete = true;
    const reportAccounts = source.accounts.filter((account) =>
      (!filters.accountId || account.id === filters.accountId)
      && account.trackingStartedOn <= month.cutoff
      && (!account.archivedAt || account.archivedAt.slice(0, 10) > month.cutoff));

    for (const account of reportAccounts) {
      const balance = account.openingBalance + source.entries
        .filter((entry) => entry.accountId === account.id && entry.occurredOn <= month.cutoff)
        .reduce((sum, entry) => sum + entry.amount, 0);
      const displayRate = nativeToDisplayRate(source, account.currency, filters.currency, month.cutoff);
      if (!displayRate) {
        complete = false;
        continue;
      }
      if (displayRate.estimated) estimatedConversions += 1;
      total += balance * displayRate.rate;
    }

    if (!filters.accountId) {
      for (const debt of source.debts.filter((item) => !item.accountId && item.trackingStartedOn <= month.cutoff)) {
        const historicalBalance = debt.balance + source.debtPayments
          .filter((payment) => payment.debtId === debt.id && payment.paidOn > month.cutoff && payment.paidOn <= source.asOf)
          .reduce((sum, payment) => sum + payment.amount, 0);
        const displayRate = nativeToDisplayRate(source, debt.currency, filters.currency, month.cutoff);
        if (!displayRate) {
          complete = false;
          continue;
        }
        if (displayRate.estimated) estimatedConversions += 1;
        total += historicalBalance * displayRate.rate * (debt.direction === "receivable" ? 1 : -1);
      }
    }
    month.netWorth = complete ? total : null;
  }

  const income = monthRows.reduce((sum, row) => sum + row.income, 0);
  const expense = monthRows.reduce((sum, row) => sum + row.expense, 0);
  return {
    from,
    to,
    currency: filters.currency,
    income,
    expense,
    netCashFlow: income - expense,
    openingNetWorth: monthRows[0]?.netWorth ?? null,
    closingNetWorth: monthRows.at(-1)?.netWorth ?? null,
    months: monthRows,
    categories: [...categoryTotals.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([name, amount]) => ({ name, amount })),
    transactionCount: transactions.length,
    missingConversions,
    estimatedConversions,
    truncated: source.truncated,
  };
}
