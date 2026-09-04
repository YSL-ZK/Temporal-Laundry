"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChartLineUp, DownloadSimple, Wallet, WarningCircle } from "@phosphor-icons/react";
import type { DashboardData } from "../lib/dashboard";
import { localeFor, translate, type AppLanguage } from "../lib/i18n";
import { formatMoney, type SupportedCurrency } from "../lib/money";
import { buildFinanceReport, reportSourceFromDashboard, type ReportKind, type ReportPeriod } from "../lib/reports";
import { SelectField } from "./select-field";

function monthLabel(key: string, language: AppLanguage) {
  return new Intl.DateTimeFormat(localeFor(language), { month: "short", year: "2-digit", timeZone: "UTC" })
    .format(new Date(`${key}-01T12:00:00Z`));
}

function dateLabel(value: string, language: AppLanguage) {
  return new Intl.DateTimeFormat(localeFor(language), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00Z`));
}

export function ReportsWorkspace({ data, language }: { data: DashboardData; language: AppLanguage }) {
  const household = data.household!;
  const t = (copy: string) => translate(language, copy);
  const [months, setMonths] = useState<ReportPeriod>(6);
  const [currency, setCurrency] = useState<SupportedCurrency>(household.currency as SupportedCurrency);
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [kind, setKind] = useState<ReportKind>("all");
  const report = useMemo(() => buildFinanceReport(reportSourceFromDashboard(data), { months, currency, accountId, categoryId, kind }), [accountId, categoryId, currency, data, kind, months]);
  const money = (amount: number) => formatMoney(amount, currency, localeFor(language));
  const maxFlow = Math.max(1, ...report.months.flatMap((month) => [month.income, month.expense]));
  const maxCategory = Math.max(1, ...report.categories.map((category) => category.amount));
  const netWorthValues = report.months.flatMap((month) => month.netWorth === null ? [] : [month.netWorth]);
  const netWorthMin = Math.min(...netWorthValues, 0);
  const netWorthMax = Math.max(...netWorthValues, 1);
  const netWorthSpan = Math.max(1, netWorthMax - netWorthMin);
  const netWorthPoints = report.months.flatMap((month, index) => month.netWorth === null ? [] : [{
    x: report.months.length === 1 ? 300 : 24 + index * (552 / (report.months.length - 1)),
    y: 156 - ((month.netWorth - netWorthMin) / netWorthSpan) * 128,
    value: month.netWorth,
    key: month.key,
  }]);
  const query = new URLSearchParams({ months: String(months), currency, accountId, categoryId, kind }).toString();
  const netWorthDelta = report.openingNetWorth === null || report.closingNetWorth === null ? null : report.closingNetWorth - report.openingNetWorth;

  return <section className="reports-workspace">
    <section className="report-filter-deck" aria-labelledby="report-filter-title">
      <div className="report-filter-heading">
        <div><p className="eyebrow">{t("REPORT LENS")}</p><h2 id="report-filter-title">{t("Choose what the ledger should explain")}</h2><p>{t("Every amount is converted into one comparison currency without changing its original record.")}</p></div>
        <span>{dateLabel(report.from, language)} <i aria-hidden="true" /> {dateLabel(report.to, language)}</span>
      </div>
      <div className="report-filter-grid">
        <SelectField name="report-period" label={t("Period")} value={String(months)} onValueChange={(value) => setMonths(Number(value) as ReportPeriod)} closeLabel={t("Close")} sheetTitle={t("Choose a reporting period")} options={[
          { value: "3", label: t("Last 3 months") }, { value: "6", label: t("Last 6 months") }, { value: "12", label: t("Last 12 months") },
        ]} />
        <SelectField name="report-currency" label={t("Comparison currency")} value={currency} onValueChange={(value) => setCurrency(value as SupportedCurrency)} closeLabel={t("Close")} sheetTitle={t("Choose a comparison currency")} options={["COP", "USD", "EUR"].map((value) => ({ value, label: value }))} />
        <SelectField name="report-account" label={t("Account")} value={accountId} onValueChange={setAccountId} closeLabel={t("Close")} sheetTitle={t("Filter by account")} options={[{ value: "", label: t("All accounts") }, ...data.reportAccounts.map((account) => ({ value: account.id, label: account.name, meta: account.currency }))]} />
        <SelectField name="report-category" label={t("Category")} value={categoryId} onValueChange={setCategoryId} closeLabel={t("Close")} sheetTitle={t("Filter by category")} options={[{ value: "", label: t("All categories") }, ...data.categories.map((category) => ({ value: category.id, label: category.name, group: t(category.kind) }))]} />
        <SelectField name="report-kind" label={t("Movement type")} value={kind} onValueChange={(value) => setKind(value as ReportKind)} closeLabel={t("Close")} sheetTitle={t("Filter by movement type")} options={[{ value: "all", label: t("Income and expenses") }, { value: "income", label: t("Income only") }, { value: "expense", label: t("Expenses only") }]} />
      </div>
    </section>

    <section className="report-hero report-hero-refined">
      <div><p className="eyebrow">{t("NET CASH FLOW")}</p><h2>{money(report.netCashFlow)}</h2><p>{report.netCashFlow >= 0 ? t("More money entered than left during this reporting window.") : t("More money left than entered during this reporting window.")}</p></div>
      <div className="report-hero-orbit" aria-hidden="true"><i /><i /><span>{currency}</span></div>
      <a className="report-export" href={`/export/report?${query}`}><DownloadSimple aria-hidden="true" weight="bold" />{t("Export this report")}</a>
    </section>

    <section className="report-summary-rail" aria-label={t("Report summary")}>
      <article><span className="positive"><ArrowUpRight aria-hidden="true" weight="bold" /></span><small>{t("Income")}</small><strong>{money(report.income)}</strong></article>
      <article><span className="negative"><ArrowDownRight aria-hidden="true" weight="bold" /></span><small>{t("Expenses")}</small><strong>{money(report.expense)}</strong></article>
      <article><span><Wallet aria-hidden="true" weight="duotone" /></span><small>{t("Closing net worth")}</small><strong>{report.closingNetWorth === null ? t("Unavailable") : money(report.closingNetWorth)}</strong></article>
      <article><span><ChartLineUp aria-hidden="true" weight="duotone" /></span><small>{t("Net-worth movement")}</small><strong>{netWorthDelta === null ? t("Unavailable") : `${netWorthDelta >= 0 ? "+" : ""}${money(netWorthDelta)}`}</strong></article>
    </section>

    <div className="report-grid report-grid-refined">
      <section className="dashboard-panel report-flow">
        <div className="panel-heading"><div><p className="eyebrow">{t("CASH FLOW")}</p><h2>{t("Income and expenses")}</h2><p>{report.transactionCount} {t("posted movements in this lens")}</p></div></div>
        <div className="flow-chart" role="list" aria-label={t("Monthly income and expense comparison")}>
          {report.months.map((month) => <div className="flow-month" role="listitem" key={month.key}><div className="flow-bars" role="img" aria-label={`${monthLabel(month.key, language)}: ${t("Income")} ${money(month.income)}, ${t("Expenses")} ${money(month.expense)}`}><i aria-hidden="true" className="income-bar" style={{ height: `${Math.max(month.income ? 3 : 0, month.income / maxFlow * 100)}%` }} /><i aria-hidden="true" className="expense-bar" style={{ height: `${Math.max(month.expense ? 3 : 0, month.expense / maxFlow * 100)}%` }} /></div><strong>{monthLabel(month.key, language)}</strong><span>{money(month.income - month.expense)}</span></div>)}
        </div>
        <div className="report-legend"><span><i aria-hidden="true" className="income-dot" />{t("Income")} {money(report.income)}</span><span><i aria-hidden="true" className="expense-dot" />{t("Expenses")} {money(report.expense)}</span></div>
      </section>

      <section className="dashboard-panel report-net-worth">
        <div className="panel-heading"><div><p className="eyebrow">{t("POSITION HISTORY")}</p><h2>{t("Net worth over time")}</h2><p>{t("Accounts plus unlinked amounts owed to you, minus unlinked amounts you owe.")}</p></div></div>
        {netWorthPoints.length ? <><svg className="net-worth-chart" viewBox="0 0 600 180" role="img" aria-label={t("Net worth history chart")} preserveAspectRatio="none"><defs><linearGradient id="net-worth-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--mint-strong)" stopOpacity=".28" /><stop offset="1" stopColor="var(--mint-strong)" stopOpacity="0" /></linearGradient></defs><path d={`M ${netWorthPoints.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${netWorthPoints.at(-1)!.x} 168 L ${netWorthPoints[0].x} 168 Z`} fill="url(#net-worth-fill)" /><polyline points={netWorthPoints.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="var(--mint)" strokeWidth="3" vectorEffect="non-scaling-stroke" />{netWorthPoints.map((point) => <circle key={point.key} cx={point.x} cy={point.y} r="5" fill="var(--vault-deep)" stroke="var(--mint)" strokeWidth="3"><title>{monthLabel(point.key, language)}: {money(point.value)}</title></circle>)}</svg><div className="net-worth-axis">{report.months.map((month) => <span key={month.key}>{monthLabel(month.key, language)}</span>)}</div></> : <div className="report-chart-empty"><WarningCircle aria-hidden="true" weight="duotone" /><strong>{t("Historical valuation is unavailable")}</strong><p>{t("Laundry needs a stored exchange rate for every currency represented in this view.")}</p></div>}
      </section>

      <section className="dashboard-panel report-categories">
        <div className="panel-heading"><div><p className="eyebrow">{t("SPENDING MIX")}</p><h2>{t("Where money went")}</h2></div></div>
        {report.categories.length ? <div className="category-report-list">{report.categories.slice(0, 8).map((category) => <div className="category-report-row" key={category.name}><div><strong>{category.name}</strong><span>{money(category.amount)}</span></div><div aria-hidden="true" className="category-report-track"><i style={{ width: `${category.amount / maxCategory * 100}%` }} /></div></div>)}</div> : <div className="report-chart-empty compact"><ChartLineUp aria-hidden="true" weight="duotone" /><strong>{t("No expenses match these filters")}</strong></div>}
      </section>

      <section className="dashboard-panel report-exports">
        <div className="panel-heading"><div><p className="eyebrow">{t("PORTABLE RECORDS")}</p><h2>{t("Download your data")}</h2><p>{t("CSV files stay private, are never cached, and open in common spreadsheet apps.")}</p></div></div>
        <div className="report-export-list">
          <a href={`/export/report?${query}`}><span><ChartLineUp aria-hidden="true" weight="duotone" /></span><div><strong>{t("Filtered monthly report")}</strong><small>{t("Cash flow and net worth in the selected currency")}</small></div><DownloadSimple aria-hidden="true" /></a>
          <a href={`/export/accounts?currency=${currency}`}><span><Wallet aria-hidden="true" weight="duotone" /></span><div><strong>{t("Account balances")}</strong><small>{t("Native and converted balances as of today")}</small></div><DownloadSimple aria-hidden="true" /></a>
          <a href="/export/transactions"><span><ArrowUpRight aria-hidden="true" weight="duotone" /></span><div><strong>{t("Complete movement ledger")}</strong><small>{t("Posted records with historical reporting rates")}</small></div><DownloadSimple aria-hidden="true" /></a>
        </div>
      </section>
    </div>

    {(report.missingConversions > 0 || report.estimatedConversions > 0 || report.truncated) && <aside className="report-integrity-note"><WarningCircle aria-hidden="true" weight="duotone" /><div><strong>{t("Valuation note")}</strong><p>{report.missingConversions > 0 ? t("Some values could not be converted and are omitted.") : report.truncated ? t("This household has more report rows than this beta view can load; use the ledger export for the complete record.") : t("At least one early date uses the nearest available official rate because no prior daily rate was stored.")}</p></div></aside>}
  </section>;
}
