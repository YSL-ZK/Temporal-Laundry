import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ArrowsLeftRight,
  Bell,
  CalendarDots,
  CaretRight,
  ChartLineUp,
  ClockCountdown,
  Plus,
  Receipt,
  ShoppingCart,
  Target,
  Wallet,
} from "@phosphor-icons/react";
import type { DashboardData } from "../lib/dashboard";
import { localeFor, translate, type AppLanguage } from "../lib/i18n";
import { currencyRate, formatMoney, netWorthFromPositions, SUPPORTED_CURRENCIES } from "../lib/money";
import LaundryMark from "./laundry-mark";

type MobileDestination = "accounts" | "activity" | "plans" | "shopping" | "reports" | "settings";

type MobileOverviewProps = {
  data: DashboardData;
  language: AppLanguage;
  onNavigate: (destination: MobileDestination) => void;
  onOpenReminders: () => void;
  urgentReminderCount: number;
};

function currency(amount: number, code: string, language: AppLanguage) {
  return formatMoney(amount, code, localeFor(language));
}

function shortDate(value: string, language: AppLanguage) {
  return new Intl.DateTimeFormat(localeFor(language), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function MobileOverview({ data, language, onNavigate, onOpenReminders, urgentReminderCount }: MobileOverviewProps) {
  const household = data.household!;
  const t = (copy: string) => translate(language, copy);
  const monthKey = data.asOf.slice(0, 7);
  const currentMonth = data.reportTransactions.filter((transaction) => transaction.occurredOn.startsWith(monthKey));
  const income = currentMonth.filter((transaction) => transaction.kind === "income").reduce((total, transaction) => total + transaction.amount * transaction.reportingExchangeRate, 0);
  const expenses = currentMonth.filter((transaction) => transaction.kind === "expense").reduce((total, transaction) => total + transaction.amount * transaction.reportingExchangeRate, 0);
  const monthlyPosition = income - expenses;
  const valuedAccounts = data.accounts.filter((account) => account.reportingBalance !== null);
  const valuedUnlinkedDebts = data.debts.filter((debt) => !debt.accountId && debt.reportingBalance !== null);
  const missingValuations = data.accounts.filter((account) => account.reportingBalance === null).length
    + data.debts.filter((debt) => !debt.accountId && debt.reportingBalance === null).length;
  const netWorth = netWorthFromPositions(data.accounts, data.debts);
  const flowTotal = income + expenses;
  const incomeShare = flowTotal > 0 ? Math.round((income / flowTotal) * 100) : 50;
  const openShoppingItems = data.shoppingLists.reduce((total, list) => total + list.items.length, 0);
  const upcoming = data.recurringOccurrences.filter((item) => item.status === "projected").slice(0, 3);
  const recent = data.transactions.slice(0, 4);
  const valuationDate = data.exchangeRates
    ? new Intl.DateTimeFormat(localeFor(language), { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${data.exchangeRates.valuationDate}T12:00:00Z`))
    : null;
  const displayedRates = data.exchangeRates
    ? SUPPORTED_CURRENCIES.filter((code) => code !== household.currency).flatMap((code) => {
      const rate = currencyRate(code, household.currency, data.exchangeRates!.copPerUnit);
      return rate === null ? [] : [{ code, rate }];
    })
    : [];

  return (
    <section className="mobile-home" aria-label={t("Financial overview")}>
      <header className="mobile-home-bar">
        <div className="mobile-home-identity">
          <LaundryMark className="mobile-home-mark" />
          <div>
            <span translate="no">{household.name}</span>
            <strong>{t("Welcome back")}, {data.userName}</strong>
          </div>
        </div>
        <div className="mobile-home-actions"><button className="reminder-button" type="button" onClick={onOpenReminders} aria-label={urgentReminderCount ? `${t("Open reminders")}: ${urgentReminderCount} ${t("need attention")}` : t("Open reminders")} aria-haspopup="dialog"><Bell aria-hidden="true" weight={urgentReminderCount ? "fill" : "regular"} />{urgentReminderCount > 0 && <span>{urgentReminderCount > 99 ? "99+" : urgentReminderCount}</span>}</button><button className="mobile-profile-button" type="button" onClick={() => onNavigate("settings")} aria-label={t("Open settings")}>
          <span aria-hidden="true">{data.userName.slice(0, 2).toUpperCase()}</span>
        </button></div>
      </header>

      <section className="mobile-position" aria-labelledby="mobile-position-title">
        <div className="mobile-position-copy">
          <div className="mobile-position-label">
            <span aria-hidden="true" />
            <p id="mobile-position-title">{t("Current position")}</p>
          </div>
          <p className="mobile-position-value">{currency(netWorth, household.currency, language)}</p>
          <p className="mobile-position-context">
            {language === "es"
              ? `${valuedAccounts.length + valuedUnlinkedDebts.length} posición${valuedAccounts.length + valuedUnlinkedDebts.length === 1 ? "" : "es"} valorada${valuedAccounts.length + valuedUnlinkedDebts.length === 1 ? "" : "s"} en ${household.currency}`
              : `${valuedAccounts.length + valuedUnlinkedDebts.length} position${valuedAccounts.length + valuedUnlinkedDebts.length === 1 ? "" : "s"} valued in ${household.currency}`}
          </p>
        </div>

        <div className="mobile-position-orbit" aria-hidden="true">
          <i className="mobile-orbit-ring mobile-orbit-ring-one" />
          <i className="mobile-orbit-ring mobile-orbit-ring-two" />
          <span className="mobile-orbit-node"><Wallet weight="fill" /></span>
          <span className={monthlyPosition >= 0 ? "mobile-orbit-pulse positive" : "mobile-orbit-pulse negative"}>
            {monthlyPosition >= 0 ? <ArrowUpRight weight="bold" /> : <ArrowDownRight weight="bold" />}
          </span>
        </div>

        <div className="mobile-position-footer">
          <div>
            <span>{t("This month")}</span>
            <strong className={monthlyPosition < 0 ? "negative" : ""}>{monthlyPosition >= 0 ? "+" : ""}{currency(monthlyPosition, household.currency, language)}</strong>
          </div>
          <button type="button" onClick={() => onNavigate("activity")}>
            <Plus weight="bold" aria-hidden="true" />
            <span>{t("New movement")}</span>
          </button>
        </div>
      </section>

      <nav className="mobile-quick-actions" aria-label={t("Quick actions")}>
        <button type="button" onClick={() => onNavigate("accounts")}><Wallet weight="duotone" aria-hidden="true" /><span>{t("Accounts")}</span></button>
        <button type="button" onClick={() => onNavigate("plans")}><Target weight="duotone" aria-hidden="true" /><span>{t("Plans")}</span></button>
        <button type="button" onClick={() => onNavigate("shopping")}><ShoppingCart weight="duotone" aria-hidden="true" /><span>{t("Shopping")}</span>{openShoppingItems > 0 && <small>{openShoppingItems}</small>}</button>
        <button type="button" onClick={() => onNavigate("reports")}><ChartLineUp weight="duotone" aria-hidden="true" /><span>{t("Reports")}</span></button>
      </nav>

      <section className="mobile-rate-rail" aria-labelledby="mobile-rate-title">
        <div className="mobile-rate-heading">
          <span aria-hidden="true"><ArrowsLeftRight weight="duotone" /></span>
          <div>
            <h2 id="mobile-rate-title">{t("Daily exchange rates")}</h2>
            <p>{valuationDate ? `${data.exchangeRates?.stale ? t("Latest available") : t("Valuation date")} ${valuationDate}` : t("Rates unavailable")}</p>
          </div>
        </div>
        {displayedRates.length > 0 ? <div className="mobile-rate-values">
          {displayedRates.map(({ code, rate }) => <span key={code}><small>1 {code}</small><strong>{currency(rate, household.currency, language)}</strong></span>)}
        </div> : <p className="mobile-rate-empty">{t("Rates will appear after the next daily refresh.")}</p>}
        {missingValuations > 0 && <p className="mobile-rate-warning" role="status">{language === "es" ? `${missingValuations} saldo${missingValuations === 1 ? "" : "s"} no se incluyeron porque no tienen una tasa compatible.` : `${missingValuations} balance${missingValuations === 1 ? " was" : "s were"} excluded because a compatible rate is unavailable.`}</p>}
      </section>

      <section className="mobile-home-section mobile-cash-flow" aria-labelledby="mobile-cash-flow-title">
        <div className="mobile-section-heading">
          <div><span>{t("This month")}</span><h2 id="mobile-cash-flow-title">{t("Cash Flow")}</h2></div>
          <button type="button" onClick={() => onNavigate("reports")}>{t("Details")}<CaretRight aria-hidden="true" /></button>
        </div>
        <div className="mobile-flow-values">
          <div className="income"><span><ArrowUpRight weight="bold" aria-hidden="true" />{t("Money In")}</span><strong>{currency(income, household.currency, language)}</strong></div>
          <div className="expense"><span><ArrowDownRight weight="bold" aria-hidden="true" />{t("Money Out")}</span><strong>{currency(expenses, household.currency, language)}</strong></div>
        </div>
        <div className="mobile-flow-line" aria-label={language === "es" ? `${incomeShare}% de los movimientos del mes son ingresos` : `${incomeShare}% of this month's movement is income`} role="img"><i style={{ width: `${incomeShare}%` }} /></div>
      </section>

      <section className="mobile-home-section" aria-labelledby="mobile-upcoming-title">
        <div className="mobile-section-heading">
          <div><span>{t("Next in orbit")}</span><h2 id="mobile-upcoming-title">{t("Upcoming")}</h2></div>
          <button type="button" onClick={() => onNavigate("plans")}>{t("See all")}<CaretRight aria-hidden="true" /></button>
        </div>
        {upcoming.length ? (
          <div className="mobile-upcoming-list">
            {upcoming.map((item) => (
              <article key={item.id}>
                <span className="mobile-due-icon" aria-hidden="true"><CalendarDots weight="duotone" /></span>
                <div><strong>{item.name}</strong><span>{shortDate(item.dueOn, language)} · {t(item.kind)}</span></div>
                <strong>{currency(item.amount, item.currency, language)}</strong>
              </article>
            ))}
          </div>
        ) : (
          <button className="mobile-inline-empty" type="button" onClick={() => onNavigate("plans")}>
            <ClockCountdown weight="duotone" aria-hidden="true" />
            <span><strong>{t("Nothing scheduled")}</strong><small>{t("Add a bill, subscription, or recurring income.")}</small></span>
            <ArrowRight aria-hidden="true" />
          </button>
        )}
      </section>

      <section className="mobile-home-section" aria-labelledby="mobile-recent-title">
        <div className="mobile-section-heading">
          <div><span>{t("Posted ledger")}</span><h2 id="mobile-recent-title">{t("Recent Activity")}</h2></div>
          <button type="button" onClick={() => onNavigate("activity")}>{t("See all")}<CaretRight aria-hidden="true" /></button>
        </div>
        {recent.length ? (
          <div className="mobile-recent-list">
            {recent.map((transaction) => (
              <article key={transaction.id}>
                <span className={transaction.kind === "income" ? "mobile-transaction-icon income" : "mobile-transaction-icon"} aria-hidden="true">
                  {transaction.kind === "transfer" ? <ArrowsLeftRight weight="duotone" /> : <Receipt weight="duotone" />}
                </span>
                <div><strong>{transaction.payee ?? transaction.category ?? t(transaction.kind)}</strong><span>{shortDate(transaction.occurredOn, language)} · {transaction.account ?? t("Account")}</span></div>
                <strong className={transaction.kind === "income" ? "income" : ""}>{transaction.kind === "income" ? "+" : transaction.kind === "expense" ? "−" : ""}{currency(transaction.amount, transaction.currency, language)}</strong>
              </article>
            ))}
          </div>
        ) : (
          <button className="mobile-inline-empty" type="button" onClick={() => onNavigate("activity")}>
            <Receipt weight="duotone" aria-hidden="true" />
            <span><strong>{t("Your ledger is ready")}</strong><small>{t("Record your first movement to see it here.")}</small></span>
            <ArrowRight aria-hidden="true" />
          </button>
        )}
      </section>
    </section>
  );
}
