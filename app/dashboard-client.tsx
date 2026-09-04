"use client";

import { FormEvent, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, ArrowsLeftRight, Bank, Bell, CalendarDots, CaretRight, ChartDonut, ChartLineUp, ChatCircleDots, CheckCircle, CreditCard, DeviceMobile, DownloadSimple, GearSix, GlobeHemisphereWest, House, Plus, Receipt, SignOut, ShoppingCart, Target, Trash, WarningCircle, Wallet } from "@phosphor-icons/react";
import { buildCurrencyOptions } from "../lib/currencies";
import { budgetRolloverAmount, compareBudgetSpend, nextBudgetMonth, type BudgetRolloverDecision } from "../lib/budgets";
import type { DashboardData } from "../lib/dashboard";
import { projectDebtStrategy, type DebtStrategy } from "../lib/debt-strategy";
import { debtPayoffMonths } from "../lib/finance";
import { forecastGoal } from "../lib/goals";
import { localeFor, translate, type AppLanguage } from "../lib/i18n";
import { formatMoney, netWorthFromPositions } from "../lib/money";
import { cardUtilization, obligationState, statementRemaining } from "../lib/obligations";
import { createClient } from "../lib/supabase/client";
import { addShoppingItem, allocateGoal, archiveAccount, checkoutShoppingList, confirmRecurringOccurrence, createAccount, createAccountReconciliation, createBudget, createBudgetEnvelope, createCategory, createDebt, createGoal, createHouseholdInvitation, createRecurringRule, createShoppingList, recordCardPayment, recordCardStatement, recordDebtPayment, rolloverBudget, skipRecurringOccurrence, updateAccount, updateProfileLanguage, uploadReceipt, voidOwnedExpense } from "./actions/finance";
import { ActivityWorkspace } from "./activity-workspace";
import FinanceAssistant from "./finance-assistant";
import LaundryMark from "./laundry-mark";
import { MobileOverview } from "./mobile-overview";
import ReminderCenter, { reminderCount } from "./reminder-center";
import { ReportsWorkspace } from "./reports-workspace";
import { SelectField } from "./select-field";

const currencyFormatter = (currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: currency === "COP" ? 0 : 2, maximumFractionDigits: currency === "COP" ? 0 : 2 });
const money = (amount: number, currency: string) => formatMoney(amount, currency);
const moneyParts = (amount: number, currency: string) => {
  const parts = currencyFormatter(currency).formatToParts(amount);
  return {
    currency: parts.find((part) => part.type === "currency")?.value ?? currency,
    amount: parts.filter((part) => part.type !== "currency" && part.type !== "literal").map((part) => part.value).join(""),
  };
};
type DashboardTab = "overview" | "accounts" | "activity" | "plans" | "shopping" | "reports" | "assistant" | "settings";
const NAV_ITEMS: Array<{ id: DashboardTab; label: string; icon: typeof House }> = [
  { id: "overview", label: "Overview", icon: House },
  { id: "accounts", label: "Accounts", icon: Wallet },
  { id: "activity", label: "Activity", icon: ArrowsLeftRight },
  { id: "plans", label: "Plans", icon: Target },
  { id: "shopping", label: "Shopping", icon: ShoppingCart },
  { id: "reports", label: "Reports", icon: ChartLineUp },
  { id: "assistant", label: "Ask Laundry", icon: ChatCircleDots },
  { id: "settings", label: "Settings", icon: GearSix },
];
const MOBILE_NAV_IDS = new Set<DashboardTab>(["overview", "activity", "plans", "shopping", "settings"]);
type CheckoutLine = { selected: boolean; quantity: string; actualPrice: string; discount: string; taxRate: string; fixedTax: string; categoryId: string };
type CheckoutAdjustments = { discount: string; shipping: string; tip: string };
const numeric = (value: string | number | undefined | null) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };

export default function DashboardClient({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [message, setMessage] = useState("");
  const [language, setLanguage] = useState<AppLanguage>(data.language);
  const [expenseToRemove, setExpenseToRemove] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountToArchive, setAccountToArchive] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [checkoutList, setCheckoutList] = useState<string | null>(null);
  const [checkoutDraft, setCheckoutDraft] = useState<Record<string, CheckoutLine>>({});
  const [checkoutAdjustments, setCheckoutAdjustments] = useState<Record<string, CheckoutAdjustments>>({});
  const household = data.household!;
  const netWorth = netWorthFromPositions(data.accounts, data.debts);
  const moneyOut = data.reportTransactions.filter((item) => item.kind === "expense").reduce((sum, item) => sum + item.amount * item.reportingExchangeRate, 0);
  const moneyIn = data.reportTransactions.filter((item) => item.kind === "income").reduce((sum, item) => sum + item.amount * item.reportingExchangeRate, 0);
  const expenseCategories = data.categories.filter((category) => category.kind === "expense");
  const defaultShoppingCategory = expenseCategories.find((category) => category.name.toLowerCase() === "shopping")?.id ?? expenseCategories[0]?.id ?? "";
  const t = (copy: string) => translate(language, copy);
  const workspaceCurrencyOptions = buildCurrencyOptions(localeFor(language), [household.currency, ...data.accounts.map((account) => account.currency), ...data.shoppingLists.map((list) => list.currency)]);
  const primaryMobileNav = NAV_ITEMS.filter(({ id }) => MOBILE_NAV_IDS.has(id));
  const urgentReminderCount = useMemo(() => reminderCount(data), [data]);
  const currentMobileNav = NAV_ITEMS.find(({ id }) => id === tab)!;
  const mobileNavItems = MOBILE_NAV_IDS.has(tab) ? primaryMobileNav : [NAV_ITEMS[0], currentMobileNav, NAV_ITEMS[2], NAV_ITEMS[3], NAV_ITEMS[7]];
  const complete = (result: { error?: string }) => { setMessage(result.error ?? t("Saved.")); if (!result.error) router.refresh(); };
  const viewMeta: Record<DashboardTab, { eyebrow: string; title: string }> = {
    overview: { eyebrow: "FINANCIAL POSITION", title: "Your Money, in Motion." },
    accounts: { eyebrow: "ACCOUNTS & CARDS", title: "Every Balance, Accounted For." },
    activity: { eyebrow: "POSTED LEDGER", title: "Follow Every Movement." },
    plans: { eyebrow: "GOALS & OBLIGATIONS", title: "Give the Future a Number." },
    shopping: { eyebrow: "COLLABORATIVE LISTS", title: "Plan the Cart Before the Checkout." },
    reports: { eyebrow: "LEDGER REPORTS", title: "See the Shape of Your Money." },
    assistant: { eyebrow: "PRIVATE FINANCE EXPLAINER", title: "Turn the Ledger Into a Next Step." },
    settings: { eyebrow: "HOUSEHOLD CONTROL", title: "Shape Your Shared Space." },
  };

  useEffect(() => { document.documentElement.lang = language; }, [language]);

  async function signOut() {
    setSigningOut(true);
    setMessage("");
    const { error } = await createClient().auth.signOut({ scope: "local" });
    if (error) { setMessage("Sign out failed. Check your connection and try again."); setSigningOut(false); return; }
    router.replace("/login");
    router.refresh();
  }

  function submitLanguage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedLanguage = new FormData(event.currentTarget).get("language") === "es" ? "es" : "en";
    setLanguage(selectedLanguage);
    startTransition(async () => complete(await updateProfileLanguage({ language: selectedLanguage })));
  }

  function removeExpense(transactionId: string) {
    startTransition(async () => {
      const result = await voidOwnedExpense({ transactionId });
      setExpenseToRemove(null);
      complete(result);
    });
  }

  function moveTo(tabId: DashboardTab, targetId?: string) {
    setTab(tabId);
    if (targetId) requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    startTransition(async () => complete(await createAccount({ householdId: household.id, name: form.get("name"), kind: form.get("kind"), currency: form.get("currency"), openingBalance: form.get("openingBalance") || 0, visibility: form.get("visibility"), creditLimit: form.get("creditLimit") || undefined, paymentAccountId: form.get("paymentAccountId") || undefined, closingDay: form.get("closingDay") || undefined, dueDay: form.get("dueDay") || undefined })));
  }
  function submitAccountUpdate(accountId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateAccount({ accountId, name: form.get("name"), visibility: form.get("visibility"), creditLimit: form.get("creditLimit") || undefined, paymentAccountId: form.get("paymentAccountId") || undefined, closingDay: form.get("closingDay") || undefined, dueDay: form.get("dueDay") || undefined });
      if (!result.error) setEditingAccountId(null);
      complete(result);
    });
  }
  function archiveSelectedAccount(accountId: string) {
    startTransition(async () => {
      const result = await archiveAccount({ accountId });
      if (!result.error) setAccountToArchive(null);
      complete(result);
    });
  }
  function submitList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    startTransition(async () => complete(await createShoppingList({ householdId: household.id, name: form.get("name"), currency: form.get("currency"), visibility: form.get("visibility"), defaultTaxRate: form.get("taxRate") || household.taxRate })));
  }
  function submitShoppingItem(listId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    startTransition(async () => complete(await addShoppingItem({ listId, name: form.get("name"), quantity: form.get("quantity") || 1, estimatedPrice: form.get("estimatedPrice") || 0, categoryId: form.get("categoryId") || undefined, taxRate: form.get("taxRate") || undefined })));
  }
  function openCheckout(list: DashboardData["shoppingLists"][number]) {
    setCheckoutDraft(Object.fromEntries(list.items.map((item) => [item.id, { selected: true, quantity: String(item.quantity), actualPrice: String(item.actualPrice ?? item.estimatedPrice), discount: "0", taxRate: String(item.taxRate ?? list.taxRate), fixedTax: "", categoryId: item.categoryId ?? defaultShoppingCategory }])));
    setCheckoutAdjustments((current) => ({ ...current, [list.id]: { discount: String(list.discount), shipping: String(list.shipping), tip: String(list.tip) } }));
    setCheckoutList(list.id);
  }
  function updateCheckoutLine(itemId: string, field: keyof CheckoutLine, value: string | boolean) {
    setCheckoutDraft((current) => ({ ...current, [itemId]: { ...(current[itemId] ?? { selected: false, quantity: "1", actualPrice: "0", discount: "0", taxRate: "0", fixedTax: "", categoryId: defaultShoppingCategory }), [field]: value } as CheckoutLine }));
  }
  function updateCheckoutAdjustment(listId: string, field: keyof CheckoutAdjustments, value: string) {
    setCheckoutAdjustments((current) => ({ ...current, [listId]: { ...(current[listId] ?? { discount: "0", shipping: "0", tip: "0" }), [field]: value } }));
  }
  function checkoutPreview(list: DashboardData["shoppingLists"][number]) {
    const adjustment = checkoutAdjustments[list.id] ?? { discount: "0", shipping: "0", tip: "0" };
    const lines = list.items.filter((item) => checkoutDraft[item.id]?.selected).map((item) => {
      const draft = checkoutDraft[item.id]; const subtotal = numeric(draft?.quantity) * numeric(draft?.actualPrice); const discount = Math.min(Math.max(0, numeric(draft?.discount)), subtotal);
      const fixedTax = draft?.fixedTax === "" ? null : numeric(draft?.fixedTax); const tax = fixedTax ?? subtotal * Math.max(0, numeric(draft?.taxRate)) / 100;
      return { subtotal, discount, tax };
    });
    const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0); const itemDiscount = lines.reduce((sum, line) => sum + line.discount, 0); const tax = lines.reduce((sum, line) => sum + line.tax, 0);
    const discount = Math.min(Math.max(0, numeric(adjustment.discount)), Math.max(0, subtotal - itemDiscount)); const shipping = Math.max(0, numeric(adjustment.shipping)); const tip = Math.max(0, numeric(adjustment.tip));
    return { count: lines.length, subtotal, itemDiscount, tax, discount, shipping, tip, total: Math.max(0, subtotal - itemDiscount - discount + tax + shipping + tip) };
  }
  function submitCheckout(list: DashboardData["shoppingLists"][number], event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const adjustment = checkoutAdjustments[list.id] ?? { discount: "0", shipping: "0", tip: "0" };
    const items = list.items.filter((item) => checkoutDraft[item.id]?.selected).map((item) => { const draft = checkoutDraft[item.id]; return { id: item.id, categoryId: draft.categoryId || undefined, quantity: draft.quantity, actualPrice: draft.actualPrice, discount: draft.discount || 0, taxRate: draft.fixedTax === "" ? draft.taxRate : undefined, fixedTax: draft.fixedTax || undefined }; });
    if (!items.length) { setMessage("Select at least one item for checkout."); return; }
    startTransition(async () => {
      const result = await checkoutShoppingList({ listId: list.id, accountId: form.get("accountId"), categoryId: form.get("categoryId"), occurredOn: form.get("occurredOn"), visibility: form.get("visibility"), discount: adjustment.discount || 0, shipping: adjustment.shipping || 0, tip: adjustment.tip || 0, note: form.get("note") || undefined, items });
      if (result.error || !result.data) { complete(result); return; }
      const receipt = form.get("receipt");
      if (receipt instanceof File && receipt.size > 0) {
        const receiptForm = new FormData(); receiptForm.set("transactionId", result.data.id); receiptForm.set("file", receipt);
        const receiptResult = await uploadReceipt(receiptForm);
        if (receiptResult.error) { setMessage("Checkout posted, but the receipt could not be saved."); router.refresh(); return; }
      }
      setCheckoutList(null); setMessage("Shopping checkout posted."); router.refresh();
    });
  }
  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    startTransition(async () => complete(await createHouseholdInvitation({ householdId: household.id, email: form.get("email") })));
  }
  function submitCategory(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await createCategory({ householdId: household.id, name: form.get("name"), kind: form.get("kind"), color: form.get("color") || undefined }))); }
  function submitGoal(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await createGoal({ householdId: household.id, name: form.get("name"), targetAmount: form.get("targetAmount"), currency: form.get("currency"), targetDate: form.get("targetDate") || undefined, visibility: form.get("visibility") }))); }
  function submitDebt(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await createDebt({ householdId: household.id, creditor: form.get("creditor"), direction: form.get("direction"), balance: form.get("balance"), currency: form.get("currency"), interestRate: form.get("rate") || undefined, minimumPayment: form.get("minimum") || undefined, dueDay: form.get("dueDay") || undefined, accountId: form.get("accountId") || undefined, visibility: form.get("visibility") }))); }
  function submitBudget(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await createBudget({ householdId: household.id, categoryId: form.get("categoryId") || undefined, month: form.get("month"), amount: form.get("amount"), envelopeAmount: form.get("envelope") || 0, currency: form.get("currency"), visibility: form.get("visibility") }))); }
  function submitRecurring(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await createRecurringRule({ householdId: household.id, accountId: form.get("accountId"), categoryId: form.get("categoryId") || undefined, name: form.get("name"), amount: form.get("amount"), cadence: form.get("cadence"), nextDueOn: form.get("nextDueOn"), ruleKind: form.get("ruleKind"), visibility: form.get("visibility"), provider: form.get("provider") || undefined, serviceReference: form.get("serviceReference") || undefined, billingPeriod: form.get("billingPeriod") || undefined }))); }
  function submitGoalAllocation(goalId: string, event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await allocateGoal({ goalId, amount: form.get("amount"), allocatedOn: form.get("allocatedOn"), note: form.get("note") || undefined }))); }
  function submitDebtPayment(debtId: string, visibility: "private" | "shared", event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await recordDebtPayment({ debtId, accountId: form.get("accountId"), amount: form.get("amount"), paidOn: form.get("paidOn"), visibility: form.get("visibility") || visibility, note: form.get("note") || undefined }))); }
  function submitBudgetEnvelope(budgetId: string, event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await createBudgetEnvelope({ budgetId, name: form.get("name"), amount: form.get("amount") || 0 }))); }
  function submitBudgetRollover(budgetId: string, event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await rolloverBudget({ budgetId, decision: form.get("decision") }))); }
  function confirmOccurrence(occurrence: DashboardData["recurringOccurrences"][number]) { startTransition(async () => complete(await confirmRecurringOccurrence({ occurrenceId: occurrence.id, paidOn: data.asOf }))); }
  function skipOccurrence(occurrenceId: string) { startTransition(async () => complete(await skipRecurringOccurrence({ occurrenceId }))); }
  function submitCardStatement(cardId: string, event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await recordCardStatement({ cardId, periodStart: form.get("periodStart"), closingOn: form.get("closingOn"), dueOn: form.get("dueOn"), statementBalance: form.get("statementBalance") }))); }
  function submitCardPayment(statementId: string, event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await recordCardPayment({ statementId, amount: form.get("amount"), paidOn: form.get("paidOn") }))); }
  function submitReconciliation(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await createAccountReconciliation({ accountId: form.get("accountId"), periodStart: form.get("periodStart"), endingOn: form.get("endingOn"), statementBalance: form.get("statementBalance"), createAdjustment: form.get("createAdjustment") === "true", note: form.get("note") || undefined }))); }

  const headerActions: Record<DashboardTab, { label: string; icon: typeof Plus; tab?: DashboardTab; target?: string; href?: string }> = {
    overview: { label: "Post Transaction", icon: Plus, tab: "activity", target: "transaction-form" },
    accounts: { label: "Add Account", icon: Bank, target: "account-form" },
    activity: { label: "New Entry", icon: Plus, target: "transaction-form" },
    plans: { label: "Create Plan", icon: Target, target: "plans-start" },
    shopping: { label: "New List", icon: ShoppingCart, target: "shopping-form" },
    reports: { label: "Export CSV", icon: DownloadSimple, href: `/export/report?months=6&currency=${household.currency}` },
    assistant: { label: "Ask Laundry", icon: ChatCircleDots, target: "finance-question" },
    settings: { label: "Manage Expenses", icon: GearSix, target: "expense-management" },
  };
  const headerAction = headerActions[tab];
  const HeaderActionIcon = headerAction.icon;

  return <div className="ledger-app">
    <a className="skip-link" href="#main-content">{t("Skip to Main Content")}</a>
    <aside className="app-rail">
      <div className="rail-brand"><LaundryMark className="rail-brand-mark" /><span><strong translate="no">Laundry</strong><small>{t("Household Finance")}</small></span></div>
      <button className="rail-household" type="button" onClick={() => setTab("settings")}><span className="household-orb" aria-hidden="true"><ChartDonut weight="duotone" /></span><span className="rail-household-copy"><small>{t("ACTIVE HOUSEHOLD")}</small><strong>{household.name}</strong></span><CaretRight aria-hidden="true" /></button>
      <nav className="rail-nav desktop-rail-nav" aria-label="Finance Workspace">{NAV_ITEMS.map(({ id, label, icon: Icon }) => <button className={tab === id ? "rail-link active" : "rail-link"} type="button" onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} key={id}><Icon aria-hidden="true" weight={tab === id ? "fill" : "regular"} /><span>{t(label)}</span>{id === "plans" && data.recurring.length > 0 && <small>{data.recurring.length}</small>}</button>)}</nav>
      <nav className="mobile-dock-nav" aria-label={language === "es" ? "Navegación principal" : "Primary navigation"}>{mobileNavItems.map(({ id, label, icon: Icon }) => <button className={tab === id ? "rail-link active" : "rail-link"} type="button" onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} key={id}><Icon aria-hidden="true" weight={tab === id ? "fill" : "regular"} /><span>{t(label)}</span></button>)}</nav>
      <div className="rail-bottom"><div className="rail-profile"><span className="profile-avatar" aria-hidden="true">{data.userName.slice(0, 2).toUpperCase()}</span><span className="profile-copy"><strong>{data.userName}</strong><small>{t("Signed In")}</small></span></div><button className="signout-button" type="button" onClick={signOut} disabled={signingOut} aria-label={signingOut ? t("Signing Out…") : t("Sign Out")}><SignOut aria-hidden="true" /><span>{signingOut ? t("Signing Out…") : t("Sign Out")}</span></button></div>
    </aside>
    <main className={tab === "overview" ? "content dashboard-surface mobile-overview-active" : "content dashboard-surface"} id="main-content">
    <header className={tab === "overview" ? "workspace-header overview-workspace-header" : "workspace-header"}><div className="workspace-title"><LaundryMark className="mobile-workspace-mark" /><div><p className="eyebrow">{t(viewMeta[tab].eyebrow)}</p><h1>{t(viewMeta[tab].title)}</h1><p className="workspace-date">{new Intl.DateTimeFormat(localeFor(language), { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${data.asOf}T12:00:00Z`))} · {language === "es" ? `Hola, ${data.userName}.` : `Welcome, ${data.userName}.`}</p></div></div><div className="workspace-actions"><button className="reminder-button" type="button" onClick={() => setRemindersOpen(true)} aria-label={urgentReminderCount ? `${t("Open reminders")}: ${urgentReminderCount} ${t("need attention")}` : t("Open reminders")} aria-haspopup="dialog" aria-expanded={remindersOpen}><Bell aria-hidden="true" weight={urgentReminderCount ? "fill" : "regular"} />{urgentReminderCount > 0 && <span>{urgentReminderCount > 99 ? "99+" : urgentReminderCount}</span>}</button>{headerAction.href ? <a className="primary-action" href={headerAction.href}><HeaderActionIcon aria-hidden="true" weight="bold" /><span>{t(headerAction.label)}</span></a> : <button className="primary-action" type="button" onClick={() => moveTo(headerAction.tab ?? tab, headerAction.target)}><HeaderActionIcon aria-hidden="true" weight="bold" /><span>{t(headerAction.label)}</span></button>}</div></header>
    {message && <p className="workspace-message" role="status" aria-live="polite">{message}</p>}
    {headerAction.target && <span className="view-action-anchor" id={headerAction.target} aria-hidden="true" />}
    {tab === "overview" && <OverviewPanel data={data} netWorth={netWorth} moneyIn={moneyIn} moneyOut={moneyOut} onNavigate={setTab} onOpenReminders={() => setRemindersOpen(true)} urgentReminderCount={urgentReminderCount} language={language} />}
    {tab === "accounts" && <AccountsWorkspace data={data} household={household} language={language} pending={pending} currencyOptions={workspaceCurrencyOptions} editingAccountId={editingAccountId} accountToArchive={accountToArchive} onCreate={submitAccount} onEdit={setEditingAccountId} onCancelEdit={() => setEditingAccountId(null)} onUpdate={submitAccountUpdate} onRequestArchive={setAccountToArchive} onCancelArchive={() => setAccountToArchive(null)} onArchive={archiveSelectedAccount} onCreateStatement={submitCardStatement} onPayStatement={submitCardPayment} onReconcile={submitReconciliation} />}
    {tab === "activity" && <ActivityWorkspace data={data} language={language} />}
    {tab === "plans" && <PlansWorkspace data={data} household={household} pending={pending} onCreateGoal={submitGoal} onAllocateGoal={submitGoalAllocation} onCreateDebt={submitDebt} onPayDebt={submitDebtPayment} onCreateBudget={submitBudget} onCreateEnvelope={submitBudgetEnvelope} onRolloverBudget={submitBudgetRollover} onCreateRecurring={submitRecurring} onConfirmOccurrence={confirmOccurrence} onSkipOccurrence={skipOccurrence} language={language} />}
    {tab === "shopping" && <section className="stack-page"><section className="wide-card"><h2>Create shopping list</h2><form className="form-grid" onSubmit={submitList}><label>List name<input name="name" required maxLength={100} /></label><SelectField name="currency" label={t("Currency")} defaultValue={household.currency} closeLabel={t("Close")} sheetTitle={t("Choose a currency")} options={workspaceCurrencyOptions} required /><label>Visibility<select name="visibility" defaultValue="shared"><option value="shared">Shared</option><option value="private">Private</option></select></label><label>Tax rate %<input name="taxRate" defaultValue={household.taxRate} inputMode="decimal" /></label><button className="submit-button" disabled={pending}>Create list</button></form></section>{data.shoppingLists.map((list) => { const preview = checkoutPreview(list); const adjustment = checkoutAdjustments[list.id] ?? { discount: String(list.discount), shipping: String(list.shipping), tip: String(list.tip) }; return <section className="wide-card shopping-workspace" key={list.id}><div className="section-head"><div><p className="eyebrow">{list.visibility} LIST</p><h2>{list.name}</h2><p>{list.items.length} open item{list.items.length === 1 ? "" : "s"} · tax default {list.taxRate}%</p></div><button className="add-button" type="button" disabled={!list.items.length || !data.accounts.length || !expenseCategories.length} onClick={() => openCheckout(list)}>Go shopping</button></div><div className="shopping-lines">{list.items.length ? list.items.map((item) => <div className="shopping-item" key={item.id}><div className="grow"><strong>{item.name}</strong><span>{item.quantity} × {money(item.actualPrice ?? item.estimatedPrice, list.currency)}{item.taxRate !== null ? ` · ${item.taxRate}% tax` : ""}</span></div><strong>{money(item.quantity * (item.actualPrice ?? item.estimatedPrice), list.currency)}</strong></div>) : <p className="muted">Nothing left on this list. Add the next item below.</p>}</div><form className="shopping-add-form" onSubmit={(event) => submitShoppingItem(list.id, event)}><label>Item<input name="name" required maxLength={160} placeholder="e.g. Coffee" /></label><label>Qty<input name="quantity" type="number" min="0.001" step="0.001" defaultValue="1" required /></label><label>Estimated price<input name="estimatedPrice" inputMode="decimal" defaultValue="0" required /></label><label>Category<select name="categoryId" defaultValue={defaultShoppingCategory}>{expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Tax %<input name="taxRate" inputMode="decimal" placeholder={`${list.taxRate}`} /></label><button type="submit" className="text-button" disabled={pending}>Add item</button></form>{checkoutList === list.id && <form className="checkout-review" onSubmit={(event) => submitCheckout(list, event)}><div className="checkout-heading"><div><p className="eyebrow">TRIP REVIEW</p><h3>Confirm what you bought</h3></div><button type="button" className="text-button" onClick={() => setCheckoutList(null)}>Cancel</button></div><fieldset className="checkout-items"><legend>Items</legend>{list.items.map((item) => { const draft = checkoutDraft[item.id] ?? { selected: false, quantity: String(item.quantity), actualPrice: String(item.actualPrice ?? item.estimatedPrice), discount: "0", taxRate: String(item.taxRate ?? list.taxRate), fixedTax: "", categoryId: item.categoryId ?? defaultShoppingCategory }; return <div className="checkout-item-line" key={item.id}><label className="item-select"><input type="checkbox" checked={draft.selected} onChange={(event) => updateCheckoutLine(item.id, "selected", event.target.checked)} /><span>{item.name}</span></label><label>Qty<input disabled={!draft.selected} type="number" min="0.001" step="0.001" value={draft.quantity} onChange={(event) => updateCheckoutLine(item.id, "quantity", event.target.value)} /></label><label>Actual price<input disabled={!draft.selected} inputMode="decimal" value={draft.actualPrice} onChange={(event) => updateCheckoutLine(item.id, "actualPrice", event.target.value)} /></label><label>Item discount<input disabled={!draft.selected} inputMode="decimal" value={draft.discount} onChange={(event) => updateCheckoutLine(item.id, "discount", event.target.value)} /></label><label>Tax %<input disabled={!draft.selected || draft.fixedTax !== ""} inputMode="decimal" value={draft.taxRate} onChange={(event) => updateCheckoutLine(item.id, "taxRate", event.target.value)} /></label><label>Fixed tax<input disabled={!draft.selected} inputMode="decimal" value={draft.fixedTax} onChange={(event) => updateCheckoutLine(item.id, "fixedTax", event.target.value)} /></label><label>Category<select disabled={!draft.selected} value={draft.categoryId} onChange={(event) => updateCheckoutLine(item.id, "categoryId", event.target.value)}>{expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div>; })}</fieldset><div className="checkout-adjustments"><label>List discount<input inputMode="decimal" value={adjustment.discount} onChange={(event) => updateCheckoutAdjustment(list.id, "discount", event.target.value)} /></label><label>Shipping<input inputMode="decimal" value={adjustment.shipping} onChange={(event) => updateCheckoutAdjustment(list.id, "shipping", event.target.value)} /></label><label>Tip<input inputMode="decimal" value={adjustment.tip} onChange={(event) => updateCheckoutAdjustment(list.id, "tip", event.target.value)} /></label></div><div className="checkout-meta"><label>Paying account<select name="accountId" required>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label><label>Overall category<select name="categoryId" defaultValue={defaultShoppingCategory} required>{expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Date<input name="occurredOn" type="date" defaultValue={data.asOf} required /></label><label>Visibility<select name="visibility" defaultValue={list.visibility}><option value="shared">Shared</option><option value="private">Private</option></select></label><label>Receipt (optional)<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></label><label className="full">Note<input name="note" maxLength={2000} placeholder="Optional store or trip note" /></label></div><div className="checkout-total" aria-live="polite"><span>{preview.count} selected · subtotal {money(preview.subtotal, list.currency)} · tax {money(preview.tax, list.currency)}</span><strong>{money(preview.total, list.currency)}</strong></div><button className="submit-button" disabled={pending || preview.count === 0 || preview.total <= 0}>Post itemized expense</button><p className="form-note">The total is recalculated securely on the server. Purchased lines are retained on the transaction; only unbought items remain on this list.</p></form>}</section>; })}</section>}
    {tab === "reports" && <ReportsWorkspace data={data} language={language} />}
    {tab === "assistant" && <FinanceAssistant data={data} />}
    {tab === "settings" && <SettingsPanel data={data} language={language} pending={pending} signingOut={signingOut} expenseToRemove={expenseToRemove} onLanguage={submitLanguage} onCreateCategory={submitCategory} onInvite={submitInvite} onSignOut={signOut} onRequestRemove={setExpenseToRemove} onCancelRemove={() => setExpenseToRemove(null)} onRemove={removeExpense} onNavigate={setTab} />}
  </main><ReminderCenter data={data} language={language} open={remindersOpen} onClose={() => setRemindersOpen(false)} onNavigate={(destination) => moveTo(destination)} /></div>;
}

type AccountsWorkspaceProps = {
  data: DashboardData;
  household: NonNullable<DashboardData["household"]>;
  language: AppLanguage;
  pending: boolean;
  currencyOptions: ReturnType<typeof buildCurrencyOptions>;
  editingAccountId: string | null;
  accountToArchive: string | null;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onEdit: (accountId: string) => void;
  onCancelEdit: () => void;
  onUpdate: (accountId: string, event: FormEvent<HTMLFormElement>) => void;
  onRequestArchive: (accountId: string) => void;
  onCancelArchive: () => void;
  onArchive: (accountId: string) => void;
  onCreateStatement: (cardId: string, event: FormEvent<HTMLFormElement>) => void;
  onPayStatement: (statementId: string, event: FormEvent<HTMLFormElement>) => void;
  onReconcile: (event: FormEvent<HTMLFormElement>) => void;
};

function AccountsWorkspace({ data, household, language, pending, currencyOptions, editingAccountId, accountToArchive, onCreate, onEdit, onCancelEdit, onUpdate, onRequestArchive, onCancelArchive, onArchive, onCreateStatement, onPayStatement, onReconcile }: AccountsWorkspaceProps) {
  const [newKind, setNewKind] = useState("bank");
  const [reconciliationAccountId, setReconciliationAccountId] = useState(data.accounts[0]?.id ?? "");
  const t = (copy: string) => translate(language, copy);
  const accountTypeOptions = [
    { value: "bank", label: t("Bank") }, { value: "cash", label: t("Cash") },
    { value: "savings", label: t("Savings") }, { value: "card", label: t("Credit card") },
    { value: "loan", label: t("Loan") },
  ];
  const visibilityOptions = [{ value: "shared", label: t("Shared") }, { value: "private", label: t("Private") }];
  const paymentOptions = [{ value: "", label: t("None") }, ...data.accounts.filter((account) => account.kind !== "card").map((account) => ({ value: account.id, label: account.name, meta: account.currency }))];
  const missingConversions = data.accounts.filter((account) => account.reportingBalance === null && account.currency !== household.currency);
  const defaultDueDate = new Date(`${data.asOf}T12:00:00Z`); defaultDueDate.setUTCDate(defaultDueDate.getUTCDate() + 20);

  return <section className="stack-page accounts-workspace">
    <section className="wide-card" id="account-form">
      <div className="section-head"><div><p className="eyebrow">{t("ACCOUNT LEDGER")}</p><h2>{t("Add account or card")}</h2><p>{t("Balances remain in their original currency and are converted only for household reporting.")}</p></div></div>
      <form className="form-grid" onSubmit={onCreate}>
        <label>{t("Name")}<input name="name" required maxLength={80} /></label>
        <SelectField name="kind" label={t("Type")} value={newKind} onValueChange={setNewKind} closeLabel={t("Close")} sheetTitle={t("Choose the account type")} options={accountTypeOptions} required />
        <SelectField name="currency" label={t("Currency")} defaultValue={household.currency} closeLabel={t("Close")} sheetTitle={t("Choose a currency")} options={currencyOptions} required />
        <label>{t("Opening balance")}<span className="money-input"><input name="openingBalance" type="number" step="any" inputMode="decimal" defaultValue="0" /><small>{t("Original currency")}</small></span></label>
        <SelectField name="visibility" label={t("Visibility")} defaultValue="shared" closeLabel={t("Close")} sheetTitle={t("Choose who can see it")} options={visibilityOptions} required />
        {newKind === "card" && <>
          <label>{t("Card limit (optional)")}<input name="creditLimit" type="number" min="0" step="any" inputMode="decimal" /></label>
          <SelectField name="paymentAccountId" label={t("Payment account")} defaultValue="" closeLabel={t("Close")} sheetTitle={t("Choose the payment account")} options={paymentOptions} />
          <label>{t("Closing day (card)")}<input name="closingDay" type="number" min="1" max="31" /></label>
          <label>{t("Due day (card)")}<input name="dueDay" type="number" min="1" max="31" /></label>
        </>}
        <button className="submit-button" disabled={pending}>{t("Create account")}</button>
      </form>
    </section>

    <section className="wide-card">
      <div className="section-head"><div><p className="eyebrow">{t("CURRENT POSITION")}</p><h2>{t("Current accounts")}</h2><p>{data.exchangeRates ? `${t("Daily rates")}: ${data.exchangeRates.valuationDate}${data.exchangeRates.stale ? ` · ${t("using latest available")}` : ""}` : t("Daily exchange rates have not loaded yet.")}</p></div></div>
      {missingConversions.length > 0 && <p className="form-note" role="status">{t("Some foreign balances are temporarily excluded because a daily exchange rate is unavailable.")}</p>}
      <div className="account-management-list">
        {data.accounts.map((account) => {
          const editing = editingAccountId === account.id;
          const confirmingArchive = accountToArchive === account.id;
          const statements = data.cardStatements.filter((statement) => statement.cardId === account.id);
          const utilization = cardUtilization(account.balance, account.creditLimit);
          return <article className="account-management-card" key={account.id}>
            <div className="account-management-summary">
              <div className="grow"><strong>{account.name}</strong><span>{t(account.kind)} · {t(account.visibility === "private" ? "Private" : "Shared")} · {account.currency}</span></div>
              <div className="account-balance-copy"><strong>{formatMoney(account.balance, account.currency, localeFor(language))}</strong>{account.currency !== household.currency && <small>{account.reportingBalance === null ? t("Rate unavailable") : `≈ ${formatMoney(account.reportingBalance, household.currency, localeFor(language))}`}</small>}</div>
              <div className="account-row-actions"><button className="text-button" type="button" onClick={() => onEdit(account.id)} disabled={pending}>{t("Edit")}</button><button className="danger-text-button" type="button" onClick={() => onRequestArchive(account.id)} disabled={pending}><Trash aria-hidden="true" />{t("Remove")}</button></div>
            </div>
            {account.kind === "card" && <div className="card-account-snapshot">
              <div><span>{t("Current card balance")}</span><strong>{formatMoney(Math.max(0, -account.balance), account.currency, localeFor(language))}</strong></div>
              <div><span>{t("Utilization")}</span><strong>{utilization === null ? t("Not available") : `${Math.round(utilization)}%`}</strong></div>
              <div><span>{t("Open statement")}</span><strong>{formatMoney(account.statementBalance ?? 0, account.currency, localeFor(language))}</strong></div>
              {utilization !== null && <div className="card-utilization-track" role="img" aria-label={`${t("Utilization")} ${Math.round(utilization)}%`}><i style={{ width: `${Math.min(100, utilization)}%` }} /></div>}
            </div>}
            {account.creditLimit !== null && <p className="account-card-detail">{t("Limit")}: {formatMoney(account.creditLimit, account.currency, localeFor(language))}{account.closingDay ? ` · ${t("closing day")} ${account.closingDay}` : ""}{account.dueDay ? ` · ${t("due day")} ${account.dueDay}` : ""}</p>}
            {editing && <form className="account-edit-form" onSubmit={(event) => onUpdate(account.id, event)}>
              <label>{t("Name")}<input name="name" defaultValue={account.name} required maxLength={80} /></label>
              <SelectField name="visibility" label={t("Visibility")} defaultValue={account.visibility} closeLabel={t("Close")} sheetTitle={t("Choose who can see it")} options={visibilityOptions} required />
              {account.kind === "card" && <><label>{t("Card limit (optional)")}<input name="creditLimit" type="number" min="0" step="any" defaultValue={account.creditLimit ?? ""} /></label><SelectField name="paymentAccountId" label={t("Payment account")} defaultValue={account.paymentAccountId ?? ""} closeLabel={t("Close")} sheetTitle={t("Choose the payment account")} options={paymentOptions.filter((option) => option.value !== account.id)} /><label>{t("Closing day (card)")}<input name="closingDay" type="number" min="1" max="31" defaultValue={account.closingDay ?? ""} /></label><label>{t("Due day (card)")}<input name="dueDay" type="number" min="1" max="31" defaultValue={account.dueDay ?? ""} /></label></>}
              <div className="account-edit-actions"><button className="submit-button" disabled={pending}>{t("Save changes")}</button><button className="text-button" type="button" onClick={onCancelEdit}>{t("Cancel")}</button></div>
            </form>}
            {confirmingArchive && <div className="account-archive-confirm" role="alert"><div><strong>{t("Remove this account from active views?")}</strong><p>{t("Laundry preserves its transaction history. The balance must be zero and no active plan may still use it.")}</p></div><div><button className="danger-button" type="button" onClick={() => onArchive(account.id)} disabled={pending}>{t("Archive account")}</button><button className="text-button" type="button" onClick={onCancelArchive}>{t("Cancel")}</button></div></div>}
            {account.kind === "card" && <section className="card-statement-workspace" aria-label={`${t("Statements")} ${account.name}`}>
              <form className="card-statement-form" onSubmit={(event) => onCreateStatement(account.id, event)}>
                <div><strong>{t("Record statement")}</strong><span>{t("Copy the dates and total from your bank statement.")}</span></div>
                <label>{t("Period start")}<input name="periodStart" type="date" defaultValue={`${data.asOf.slice(0, 7)}-01`} required /></label>
                <label>{t("Closing date")}<input name="closingOn" type="date" defaultValue={data.asOf} required /></label>
                <label>{t("Due date")}<input name="dueOn" type="date" defaultValue={defaultDueDate.toISOString().slice(0, 10)} required /></label>
                <label>{t("Statement balance")}<input name="statementBalance" type="number" min="0.01" step="any" inputMode="decimal" required /></label>
                <button className="text-button" disabled={pending}>{t("Save statement")}</button>
              </form>
              {statements.length > 0 && <div className="card-statement-list">{statements.map((statement) => {
                const remaining = statementRemaining(statement.statementBalance, statement.paidAmount);
                const state = statement.status === "open" && statement.dueOn < data.asOf ? "overdue" : statement.status;
                return <article className={`card-statement-row ${state}`} key={statement.id}>
                  <div className="grow"><span className="statement-status">{t(state === "overdue" ? "Overdue" : state === "paid" ? "Paid" : "Open")}</span><strong>{t("Due")} {statement.dueOn}</strong><small>{t("Closed")} {statement.closingOn} · {t(statement.visibility === "private" ? "Private" : "Shared")}</small></div>
                  <div className="statement-balance"><strong>{formatMoney(remaining, statement.currency, localeFor(language))}</strong><small>{t("of")} {formatMoney(statement.statementBalance, statement.currency, localeFor(language))}</small></div>
                  {statement.status === "open" && account.paymentAccountId && <form className="statement-payment-form" onSubmit={(event) => onPayStatement(statement.id, event)}><label>{t("Payment")}<input name="amount" type="number" min="0.01" max={remaining} step="any" inputMode="decimal" defaultValue={remaining} required /></label><label>{t("Date")}<input name="paidOn" type="date" defaultValue={data.asOf} required /></label><button className="submit-button" disabled={pending}>{t("Pay statement")}</button></form>}
                  {statement.status === "open" && !account.paymentAccountId && <p className="statement-warning"><WarningCircle aria-hidden="true" />{t("Choose a payment account before paying this statement.")}</p>}
                </article>;
              })}</div>}
            </section>}
          </article>;
        })}
      </div>
    </section>
    <section className="wide-card reconciliation-workspace" id="reconciliation-workspace">
      <div className="section-head"><div><p className="eyebrow">{t("ACCOUNT RECONCILIATION")}</p><h2>{t("Match a statement to the ledger")}</h2><p>{t("Laundry compares the statement ending balance with every posted ledger entry through that date.")}</p></div><span className="reconciliation-mark" aria-hidden="true"><ArrowsLeftRight weight="duotone" /></span></div>
      <form className="form-grid reconciliation-form" onSubmit={onReconcile}>
        <SelectField name="accountId" label={t("Account")} value={reconciliationAccountId} onValueChange={setReconciliationAccountId} closeLabel={t("Close")} sheetTitle={t("Choose the account to reconcile")} options={data.accounts.map((account) => ({ value: account.id, label: account.name, meta: `${account.kind} · ${account.currency}` }))} required disabled={!data.accounts.length} />
        <label>{t("Statement period start")}<input name="periodStart" type="date" defaultValue={`${data.asOf.slice(0, 7)}-01`} required /></label>
        <label>{t("Statement ending date")}<input name="endingOn" type="date" max={data.asOf} defaultValue={data.asOf} required /></label>
        <label>{t("Statement ending balance")}<input name="statementBalance" type="number" step="any" inputMode="decimal" required /><small>{data.accounts.find((account) => account.id === reconciliationAccountId)?.currency ?? household.currency}</small></label>
        <label className="full reconciliation-adjustment"><input name="createAdjustment" value="true" type="checkbox" /><span><strong>{t("Post a balancing adjustment when there is a difference")}</strong><small>{t("The adjustment will appear as a normal auditable ledger movement. Leave this off to record the discrepancy without changing the balance.")}</small></span></label>
        <label className="full">{t("Note")}<input name="note" maxLength={1000} placeholder={t("Optional statement or reconciliation note")} /></label>
        <button className="submit-button" disabled={pending || !data.accounts.length}>{t("Reconcile account")}</button>
      </form>
      <div className="reconciliation-history">
        {data.reconciliations.length ? data.reconciliations.map((item) => <article className={`reconciliation-row ${item.status}`} key={item.id}>
          <span className="reconciliation-state" aria-hidden="true">{item.status === "balanced" ? <CheckCircle weight="duotone" /> : <WarningCircle weight="duotone" />}</span>
          <div className="grow"><span>{t(item.status)}</span><strong>{item.account}</strong><small>{item.periodStart} — {item.endingOn} · {item.matchedEntryCount} {t("matched entries")}</small>{item.note && <small>{item.note}</small>}</div>
          <div className="reconciliation-values"><span>{t("Statement")} <strong>{formatMoney(item.statementBalance, item.currency, localeFor(language))}</strong></span><span>{t("Ledger")} <strong>{formatMoney(item.ledgerBalance, item.currency, localeFor(language))}</strong></span><span className={Math.abs(item.discrepancy) >= 0.005 ? "has-difference" : ""}>{t("Difference")} <strong>{formatMoney(item.discrepancy, item.currency, localeFor(language))}</strong></span></div>
        </article>) : <EmptyState icon={ArrowsLeftRight} title={t("No reconciliations yet")} body={t("Use a bank or card statement to verify that Laundry matches the real account balance.")} />}
      </div>
    </section>
  </section>;
}

type SettingsPanelProps = {
  data: DashboardData;
  language: AppLanguage;
  pending: boolean;
  signingOut: boolean;
  expenseToRemove: string | null;
  onLanguage: (event: FormEvent<HTMLFormElement>) => void;
  onCreateCategory: (event: FormEvent<HTMLFormElement>) => void;
  onInvite: (event: FormEvent<HTMLFormElement>) => void;
  onSignOut: () => void;
  onRequestRemove: (transactionId: string) => void;
  onCancelRemove: () => void;
  onRemove: (transactionId: string) => void;
  onNavigate: (tab: DashboardTab) => void;
};

function SettingsPanel({ data, language, pending, signingOut, expenseToRemove, onLanguage, onCreateCategory, onInvite, onSignOut, onRequestRemove, onCancelRemove, onRemove, onNavigate }: SettingsPanelProps) {
  const t = (copy: string) => translate(language, copy);
  return <section className="settings-page">
    <section className="settings-lead dashboard-panel">
      <span className="settings-lead-icon" aria-hidden="true"><GlobeHemisphereWest weight="duotone" /></span>
      <div><p className="eyebrow">{language === "es" ? "PREFERENCIAS PERSONALES" : "PERSONAL PREFERENCES"}</p><h2>{t("Language & region")}</h2><p>{t("Choose the language used across your Laundry workspace.")}</p></div>
      <form className="language-form" onSubmit={onLanguage}><label htmlFor="profile-language">{t("Language & region")}</label><select id="profile-language" name="language" defaultValue={language}><option value="en">{t("English")}</option><option value="es">{t("Spanish")}</option></select><button className="submit-button" disabled={pending}>{t("Save language")}</button></form>
    </section>

    <section className="settings-shortcuts" aria-labelledby="workspace-shortcuts-title"><div><p className="eyebrow">{language === "es" ? "MÁS HERRAMIENTAS" : "MORE WORKSPACE"}</p><h2 id="workspace-shortcuts-title">{t("Workspace shortcuts")}</h2></div><div>{([ ["accounts", Wallet, "Open accounts"], ["reports", ChartLineUp, "Open reports"], ["assistant", ChatCircleDots, "Open assistant"] ] as const).map(([target, Icon, label]) => <button type="button" key={target} onClick={() => onNavigate(target)}><Icon aria-hidden="true" weight="duotone" /><span>{t(label)}</span><CaretRight aria-hidden="true" /></button>)}</div></section>

    <section className="dashboard-panel expense-manager" id="expense-management">
      <div className="panel-heading"><div><p className="eyebrow">{language === "es" ? "CREADOS POR TI" : "CREATED BY YOU"}</p><h2>{t("Your expenses")}</h2><p>{t("Only expenses created by your account appear here.")}</p></div><span className="expense-count">{data.ownedExpenses.length}</span></div>
      {data.ownedExpenses.length ? <div className="expense-list">{data.ownedExpenses.map((expense) => <article className="expense-record" key={expense.id}><span className="expense-record-icon" aria-hidden="true"><Receipt weight="duotone" /></span><div className="expense-record-copy"><strong>{expense.payee ?? expense.category ?? t("Expense")}</strong><span>{new Intl.DateTimeFormat(localeFor(language), { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${expense.occurredOn}T12:00:00Z`))} · {expense.account}</span><small>{expense.category ?? (language === "es" ? "Sin categoría" : "Uncategorized")} · {t(expense.visibility === "private" ? "Private" : "Shared")}</small></div><strong className="expense-record-amount">−{money(expense.amount, expense.currency)}</strong>{expenseToRemove === expense.id ? <div className="expense-confirm" role="group" aria-label={language === "es" ? "Confirmar eliminación" : "Confirm removal"}><span>{language === "es" ? "¿Quitar este gasto de los saldos activos?" : "Remove this expense from active balances?"}</span><button type="button" onClick={onCancelRemove}>{t("Cancel")}</button><button className="confirm-remove" type="button" disabled={pending} onClick={() => onRemove(expense.id)}>{language === "es" ? "Sí, eliminar" : "Yes, remove"}</button></div> : <button className="expense-remove" type="button" onClick={() => onRequestRemove(expense.id)}><Trash aria-hidden="true" /><span>{t("Remove")}</span></button>}</article>)}</div> : <div className="settings-empty"><Receipt aria-hidden="true" weight="duotone" /><p>{t("No expenses created by you yet.")}</p></div>}
      <p className="settings-audit-note">{language === "es" ? "Eliminar anula el gasto y actualiza tus saldos. Laundry conserva un registro de auditoría para proteger la integridad del libro." : "Removing voids the expense and updates your balances. Laundry keeps an audit record to protect ledger integrity."}</p>
    </section>

    <div className="settings-grid">
      <section className="dashboard-panel settings-category-panel"><div className="panel-heading"><div><p className="eyebrow">{language === "es" ? "ORGANIZACIÓN" : "ORGANIZATION"}</p><h2>{t("Categories")}</h2></div></div><form className="form-grid" onSubmit={onCreateCategory}><label>{t("Name")}<input name="name" required maxLength={80} autoComplete="off" /></label><label>{t("Type")}<select name="kind" autoComplete="off"><option value="expense">{t("Expense")}</option><option value="income">{t("Income")}</option></select></label><label>{t("Color")}<input name="color" type="color" defaultValue="#79dfa9" /></label><button className="submit-button" disabled={pending}>{t("Create Category")}</button></form><div className="category-cloud">{data.categories.map((category) => <span key={category.id}><i style={{ backgroundColor: category.color ?? "#819696" }} />{category.name}<small>{t(category.kind === "expense" ? "Expense" : "Income")}</small></span>)}</div></section>
      <section className="dashboard-panel settings-invite-panel"><div className="panel-heading"><div><p className="eyebrow">{language === "es" ? "HOGAR COMPARTIDO" : "SHARED HOUSEHOLD"}</p><h2>{t("Invite Household Member")}</h2><p>{language === "es" ? "Las invitaciones vencen en 7 días." : "Invitations expire after 7 days."}</p></div></div><form className="form-grid" onSubmit={onInvite}><label>{t("Email")}<input name="email" type="email" inputMode="email" autoComplete="email" spellCheck={false} required maxLength={254} placeholder="member@example.com…" /></label><button className="submit-button" disabled={pending}>{t("Send Invitation")}</button></form></section>
    </div>

    <InstallAppCard language={language} />
    <section className="dashboard-panel session-card"><div><p className="eyebrow">{language === "es" ? "CUENTA" : "ACCOUNT"}</p><h2>{t("Session & privacy")}</h2><p>{t("Sign out on this device without ending sessions on your other devices.")}</p></div><button className="settings-signout" type="button" onClick={onSignOut} disabled={signingOut}><SignOut aria-hidden="true" />{signingOut ? t("Signing Out…") : t("Sign Out")}</button></section>
  </section>;
}

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

function InstallAppCard({ language }: { language: AppLanguage }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installedByEvent, setInstalledByEvent] = useState(false);
  const installedByDisplayMode = useSyncExternalStore(
    (onStoreChange) => {
      const query = window.matchMedia("(display-mode: standalone)");
      query.addEventListener("change", onStoreChange);
      return () => query.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia("(display-mode: standalone)").matches,
    () => false,
  );
  const installed = installedByEvent || installedByDisplayMode;

  useEffect(() => {
    const capturePrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const markInstalled = () => { setInstalledByEvent(true); setInstallPrompt(null); };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", capturePrompt); window.removeEventListener("appinstalled", markInstalled); };
  }, []);

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstalledByEvent(true);
    setInstallPrompt(null);
  }

  return <section className="wide-card install-card"><span className="install-glyph" aria-hidden="true"><DeviceMobile weight="duotone" /></span><div className="grow"><p className="eyebrow">{language === "es" ? "APP INSTALABLE" : "INSTALLABLE APP"}</p><h2>{language === "es" ? "Lleva Laundry en este dispositivo" : "Keep Laundry on This Device"}</h2><p className="muted" aria-live="polite">{installed ? language === "es" ? "Laundry está funcionando como una app instalada." : "Laundry is running as an installed app." : installPrompt ? language === "es" ? "Instala una versión independiente desde este navegador." : "Install a focused, standalone version from this browser." : language === "es" ? "Usa el menú del navegador y elige Instalar aplicación o Añadir a la pantalla de inicio." : "Use your browser menu and choose Install App or Add to Home Screen."}</p></div>{installPrompt && !installed && <button className="add-button" type="button" onClick={install}><DownloadSimple aria-hidden="true" />{language === "es" ? "Instalar Laundry" : "Install Laundry"}</button>}</section>;
}

function OverviewPanel({ data, netWorth, moneyIn, moneyOut, onNavigate, onOpenReminders, urgentReminderCount, language }: { data: DashboardData; netWorth: number; moneyIn: number; moneyOut: number; onNavigate: (tab: DashboardTab) => void; onOpenReminders: () => void; urgentReminderCount: number; language: AppLanguage }) {
  const household = data.household!;
  const t = (copy: string) => translate(language, copy);
  const netWorthDisplay = moneyParts(netWorth, household.currency);
  const projectedOccurrences = data.recurringOccurrences.filter((item) => item.status === "projected");
  const upcoming = projectedOccurrences.reduce((sum, item) => item.currency === household.currency ? sum + item.amount : sum, 0);
  const monthlyFlow = moneyIn - moneyOut;
  return <>
    <MobileOverview data={data} language={language} onNavigate={onNavigate} onOpenReminders={onOpenReminders} urgentReminderCount={urgentReminderCount} />
    <div className="overview-grid desktop-overview">
    <section className="balance-stage" aria-labelledby="net-worth-title"><div className="balance-copy"><div className="balance-kicker"><span aria-hidden="true" /><p>{t("LIVE LEDGER POSITION")}</p></div><h2 id="net-worth-title">{t("Net Worth")}</h2><p className="balance-value"><span>{netWorthDisplay.currency}</span><strong>{netWorthDisplay.amount}</strong></p><p className="balance-caption">{language === "es" ? `En ${data.accounts.length} cuenta${data.accounts.length === 1 ? "" : "s"} activa${data.accounts.length === 1 ? "" : "s"}, calculado con movimientos registrados.` : `Across ${data.accounts.length} active account${data.accounts.length === 1 ? "" : "s"}, calculated from posted entries.`}</p><button className="stage-action" type="button" onClick={() => onNavigate("accounts")}><span>{t(data.accounts.length ? "Explore Accounts" : "Add Your First Account")}</span><CaretRight aria-hidden="true" /></button></div><div className="balance-orbit" aria-hidden="true"><div className="orbit-halo orbit-halo-outer" /><div className="orbit-halo orbit-halo-inner" /><div className="orbit-node orbit-node-one"><Bank weight="fill" /></div><div className="orbit-node orbit-node-two"><CreditCard weight="fill" /></div><div className="orbit-node orbit-node-three"><Receipt weight="fill" /></div><div className="orbit-core"><span>{household.currency}</span><strong>{data.accounts.length}</strong><small>{language === "es" ? "CUENTAS" : "ACCOUNTS"}</small></div></div><div className="stage-foot"><span><i aria-hidden="true" /> {t("Posted Ledger")}</span><span>{t("Updated Now")}</span></div></section>
    <section className="signal-strip" aria-label={language === "es" ? "Señales de flujo de caja" : "Cash Flow Signals"}><SignalCard icon={ArrowUpRight} label={t("Money In")} value={money(moneyIn, household.currency)} detail={t("Posted Income")} tone="positive" /><SignalCard icon={ArrowDownRight} label={t("Money Out")} value={money(moneyOut, household.currency)} detail={t("Posted Expenses")} tone="negative" /><SignalCard icon={CalendarDots} label={t("Coming Up")} value={money(upcoming, household.currency)} detail={`${projectedOccurrences.length} ${t("projected")}`} tone="future" /></section>
    <section className="dashboard-panel accounts-panel"><div className="panel-heading"><div><p className="eyebrow">{t("YOUR MONEY MAP")}</p><h2>{t("Accounts")}</h2></div><button className="panel-link" type="button" onClick={() => onNavigate("accounts")}>{t("View All")} <CaretRight aria-hidden="true" /></button></div>{data.accounts.length ? <div className="account-stack">{data.accounts.slice(0, 4).map((account, index) => <div className="account-visual" key={account.id}><span className={`account-glyph account-glyph-${index % 3}`} aria-hidden="true">{account.kind === "card" ? <CreditCard weight="duotone" /> : account.kind === "cash" ? <Wallet weight="duotone" /> : <Bank weight="duotone" />}</span><div className="grow"><strong>{account.name}</strong><span>{t(account.kind)} · {t(account.visibility)}</span></div><div className="account-balance"><strong>{money(account.balance, account.currency)}</strong><small>{account.currency}</small></div></div>)}</div> : <EmptyState icon={Wallet} title={t("No Accounts Yet")} body={t("Create your first bank, cash, savings, card, or loan account to bring this dashboard to life.")} action={t("Add Account")} onAction={() => onNavigate("accounts")} />}</section>
    <section className="dashboard-panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">{t("LATEST MOVEMENTS")}</p><h2>{t("Recent Activity")}</h2></div><button className="panel-link" type="button" onClick={() => onNavigate("activity")}>{t("Open Ledger")} <CaretRight aria-hidden="true" /></button></div>{data.transactions.length ? <div className="activity-stack">{data.transactions.slice(0, 5).map((transaction) => <TransactionLine key={transaction.id} transaction={transaction} language={language} />)}</div> : <EmptyState icon={Receipt} title={t("A Quiet Ledger")} body={t("Your first posted income, expense, transfer, or adjustment will appear here.")} action={t("Post Transaction")} onAction={() => onNavigate("activity")} />}</section>
    <section className="dashboard-panel pulse-panel"><div className="panel-heading"><div><p className="eyebrow">{t("MONTHLY PULSE")}</p><h2>{t("Cash Flow")}</h2></div><span className={monthlyFlow >= 0 ? "flow-badge positive" : "flow-badge negative"}>{t(monthlyFlow >= 0 ? "Surplus" : "Deficit")}</span></div><p className="pulse-value">{money(Math.abs(monthlyFlow), household.currency)}</p><p className="pulse-caption">{t(monthlyFlow >= 0 ? "More came in than went out across the activity currently loaded." : "Spending is ahead of income across the activity currently loaded.")}</p><div className="pulse-track" aria-hidden="true"><i style={{ width: `${moneyIn + moneyOut > 0 ? Math.min(100, moneyIn / (moneyIn + moneyOut) * 100) : 50}%` }} /></div><div className="pulse-legend"><span>{t("Income")}</span><span>{t("Expenses")}</span></div></section>
    <section className="dashboard-panel upcoming-panel"><div className="panel-heading"><div><p className="eyebrow">{t("NEXT IN ORBIT")}</p><h2>{t("Upcoming")}</h2></div><button className="panel-link" type="button" onClick={() => onNavigate("plans")}>{t("Manage Plans")} <CaretRight aria-hidden="true" /></button></div>{projectedOccurrences.length ? projectedOccurrences.slice(0, 3).map((item) => <div className="upcoming-row" key={item.id}><span className="upcoming-date"><strong>{new Intl.DateTimeFormat(localeFor(language), { day: "2-digit", timeZone: "UTC" }).format(new Date(`${item.dueOn}T12:00:00Z`))}</strong><small>{new Intl.DateTimeFormat(localeFor(language), { month: "short", timeZone: "UTC" }).format(new Date(`${item.dueOn}T12:00:00Z`))}</small></span><div className="grow"><strong>{item.name}</strong><span>{t(item.kind)} · {t("projected")}</span></div><strong>{money(item.amount, item.currency)}</strong></div>) : <EmptyState icon={CalendarDots} title={t("Nothing Scheduled")} body={t("Add a recurring bill, subscription, or income to see what is coming next.")} action={t("Create a Plan")} onAction={() => onNavigate("plans")} />}</section>
    </div>
  </>;
}

function SignalCard({ icon: Icon, label, value, detail, tone }: { icon: typeof House; label: string; value: string; detail: string; tone: "positive" | "negative" | "future" }) { return <article className={`signal-card ${tone}`}><span className="signal-icon" aria-hidden="true"><Icon weight="bold" /></span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>; }
function EmptyState({ icon: Icon, title, body, action, onAction }: { icon: typeof House; title: string; body: string; action?: string; onAction?: () => void }) { return <div className="empty-state"><span aria-hidden="true"><Icon weight="duotone" /></span><div><strong>{title}</strong><p>{body}</p></div>{action && onAction && <button type="button" onClick={onAction}>{action}<CaretRight aria-hidden="true" /></button>}</div>; }
function TransactionLine({ transaction, language = "en" }: { transaction: DashboardData["transactions"][number]; language?: AppLanguage }) { const t = (copy: string) => translate(language, copy); return <div className="transaction-row"><div className="grow"><strong>{transaction.payee ?? transaction.category ?? t(transaction.kind)}</strong><span>{transaction.occurredOn} · {transaction.category ?? t("Uncategorized")} · {t(transaction.visibility)}</span></div><strong className={transaction.kind === "income" ? "positive" : ""}>{transaction.kind === "income" ? "+" : "−"}{money(transaction.amount, transaction.currency)}</strong></div>; }

type PlansWorkspaceProps = {
  data: DashboardData;
  household: NonNullable<DashboardData["household"]>;
  language: AppLanguage;
  pending: boolean;
  onCreateGoal: (event: FormEvent<HTMLFormElement>) => void;
  onAllocateGoal: (goalId: string, event: FormEvent<HTMLFormElement>) => void;
  onCreateDebt: (event: FormEvent<HTMLFormElement>) => void;
  onPayDebt: (debtId: string, visibility: "private" | "shared", event: FormEvent<HTMLFormElement>) => void;
  onCreateBudget: (event: FormEvent<HTMLFormElement>) => void;
  onCreateEnvelope: (budgetId: string, event: FormEvent<HTMLFormElement>) => void;
  onRolloverBudget: (budgetId: string, event: FormEvent<HTMLFormElement>) => void;
  onCreateRecurring: (event: FormEvent<HTMLFormElement>) => void;
  onConfirmOccurrence: (item: DashboardData["recurringOccurrences"][number]) => void;
  onSkipOccurrence: (occurrenceId: string) => void;
};

function GoalPlanCard({ goal, allocations, asOf, language, pending, onAllocate }: { goal: DashboardData["goals"][number]; allocations: DashboardData["goalAllocations"]; asOf: string; language: AppLanguage; pending: boolean; onAllocate: (goalId: string, event: FormEvent<HTMLFormElement>) => void }) {
  const t = (copy: string) => translate(language, copy);
  const goalAllocations = allocations.filter((allocation) => allocation.goalId === goal.id);
  const forecast = forecastGoal({ target: goal.target, current: goal.current, targetDate: goal.targetDate, asOf, allocations: goalAllocations });
  const percent = goal.target ? Math.min(100, goal.current / goal.target * 100) : 0;
  const statusLabel = t(forecast.status === "complete" ? "Complete" : forecast.status === "on-track" ? "On track" : forecast.status === "behind" ? "Behind pace" : forecast.status === "no-target-date" ? "Steady pace" : "Needs a contribution");
  const longDate = (value: string) => new Intl.DateTimeFormat(localeFor(language), { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));

  return <article className="goal-plan-card">
    <div className="goal-plan-heading"><div><span className={`goal-status ${forecast.status}`}>{statusLabel}</span><h3>{goal.name}</h3><p>{t(goal.visibility === "private" ? "Private" : "Shared")}{goal.targetDate ? ` · ${t("Target")} ${longDate(goal.targetDate)}` : ""}</p></div><strong>{money(goal.current, goal.currency)} <small>{t("of")} {money(goal.target, goal.currency)}</small></strong></div>
    <div className="goal-progress" role="progressbar" aria-label={`${goal.name}: ${Math.round(percent)}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><i style={{ width: `${percent}%` }} /></div>
    <div className="goal-forecast-grid"><span><small>{t("Remaining")}</small><strong>{money(forecast.remaining, goal.currency)}</strong></span><span><small>{t("Recent monthly pace")}</small><strong>{money(forecast.averageMonthly, goal.currency)}</strong></span><span><small>{t("Needed each month")}</small><strong>{forecast.requiredMonthly === null ? t("No target date") : money(forecast.requiredMonthly, goal.currency)}</strong></span><span><small>{t("Projected finish")}</small><strong>{forecast.forecastDate ? longDate(forecast.forecastDate) : t("Not enough history")}</strong></span></div>
    <p className={`goal-forecast-note ${forecast.status}`}>{t(forecast.status === "complete" ? "This goal has reached its recorded target." : forecast.status === "on-track" ? "Your recent contribution pace reaches the goal by its target date." : forecast.status === "behind" ? "Your recent pace finishes after the target date; compare it with the needed monthly amount." : forecast.status === "no-target-date" ? "Laundry can project a finish date, but no target date is set." : "Record a contribution to establish a real monthly pace.")}</p>
    <details className="goal-history"><summary>{t("Allocation history")}<span>{goalAllocations.length}</span></summary>{goalAllocations.length ? <div>{goalAllocations.slice(0, 8).map((allocation) => <p key={allocation.id}><time>{longDate(allocation.allocatedOn)}</time><span>{allocation.note || t("Goal contribution")}</span><strong>+{money(allocation.amount, goal.currency)}</strong></p>)}</div> : <p className="goal-history-empty">{t("No contributions recorded yet.")}</p>}</details>
    <form className="inline-operation goal-allocation-form" onSubmit={(event) => onAllocate(goal.id, event)}><label>{t("Allocate")}<input name="amount" required min="0.01" inputMode="decimal" placeholder="0.00" /></label><label>{t("Date")}<input name="allocatedOn" type="date" defaultValue={asOf} required /></label><label className="grow">{t("Note")}<input name="note" maxLength={500} placeholder={t("Optional allocation note")} /></label><button className="text-button" disabled={pending}>{t("Add allocation")}</button></form>
  </article>;
}

function BudgetPlanCard({ budget, previousBudget, asOf, language, pending, onEnvelope, onRollover }: { budget: DashboardData["budgets"][number]; previousBudget: DashboardData["budgets"][number] | null; asOf: string; language: AppLanguage; pending: boolean; onEnvelope: (budgetId: string, event: FormEvent<HTMLFormElement>) => void; onRollover: (budgetId: string, event: FormEvent<HTMLFormElement>) => void }) {
  const t = (copy: string) => translate(language, copy);
  const [decision, setDecision] = useState<BudgetRolloverDecision>(budget.rolloverDecision ?? "carry_surplus");
  const effectiveLimit = budget.amount;
  const remaining = effectiveLimit - budget.spent;
  const usage = effectiveLimit > 0 ? budget.spent / effectiveLimit * 100 : budget.spent > 0 ? 100 : 0;
  const comparison = compareBudgetSpend(budget.spent, previousBudget?.spent ?? null);
  const rolloverPreview = budgetRolloverAmount(effectiveLimit, budget.spent, decision);
  const targetMonth = nextBudgetMonth(budget.month);
  const closed = budget.month.slice(0, 7) < asOf.slice(0, 7);
  const monthLabel = (value: string) => new Intl.DateTimeFormat(localeFor(language), { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 7)}-01T12:00:00Z`));
  const comparisonLabel = comparison.difference === null
    ? t("No previous month")
    : `${comparison.difference > 0 ? "+" : ""}${money(comparison.difference, budget.currency)}${comparison.percentage === null ? "" : ` · ${comparison.percentage > 0 ? "+" : ""}${comparison.percentage}%`}`;

  return <article className="budget-plan-card">
    <div className="budget-plan-heading"><div><span className={`budget-status ${remaining < 0 ? "over" : closed ? "closed" : "active"}`}>{t(remaining < 0 ? "Over budget" : closed ? "Month closed" : "Active month")}</span><h3>{budget.category ?? t("Overall")}</h3><p>{monthLabel(budget.month)} · {t(budget.visibility === "private" ? "Private" : "Shared")}</p></div><div className="budget-primary-value"><small>{t("Spent")}</small><strong>{money(budget.spent, budget.currency)}</strong><span>{t("of")} {money(effectiveLimit, budget.currency)}</span></div></div>
    <div className={`budget-progress ${remaining < 0 ? "over" : ""}`} role="progressbar" aria-label={`${budget.category ?? t("Overall")}: ${Math.round(usage)}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(usage))}><i style={{ width: `${Math.min(100, usage)}%` }} /></div>
    <div className="budget-comparison-grid"><span><small>{t("Base limit")}</small><strong>{money(budget.baseAmount, budget.currency)}</strong></span><span><small>{t("Rolled in")}</small><strong className={budget.rolloverAmount < 0 ? "negative" : ""}>{budget.rolloverAmount > 0 ? "+" : ""}{money(budget.rolloverAmount, budget.currency)}</strong></span><span><small>{t("Remaining")}</small><strong className={remaining < 0 ? "negative" : ""}>{money(remaining, budget.currency)}</strong></span><span><small>{t("Versus previous month")}</small><strong className={(comparison.difference ?? 0) > 0 ? "negative" : ""}>{comparisonLabel}</strong></span></div>
    {budget.envelopes.length > 0 && <div className="envelope-list budget-envelope-list">{budget.envelopes.map((envelope) => <span key={envelope.id}>{envelope.name}<strong>{money(envelope.amount, budget.currency)}</strong></span>)}</div>}
    <form className="inline-operation budget-envelope-form" onSubmit={(event) => onEnvelope(budget.id, event)}><label className="grow">{t("Envelope name")}<input name="name" required maxLength={80} placeholder={t("e.g. groceries")} /></label><label>{t("Allocation")}<input name="amount" required min="0" inputMode="decimal" defaultValue="0" /></label><button className="text-button" disabled={pending}>{t("Add envelope")}</button></form>
    {closed ? <form className="budget-rollover" onSubmit={(event) => onRollover(budget.id, event)}><div><p className="eyebrow">{t("MONTH-END DECISION")}</p><h4>{t("Prepare the next month")}</h4><p>{targetMonth ? `${monthLabel(targetMonth)} · ` : ""}{t("This updates planning limits only; it never changes account balances.")}</p></div><SelectField name="decision" label={t("Rollover rule")} value={decision} onValueChange={(value) => setDecision(value as BudgetRolloverDecision)} closeLabel={t("Close")} sheetTitle={t("Choose what moves forward")} options={[{ value: "reset", label: t("Start fresh"), meta: t("Move nothing to the next month") }, { value: "carry_surplus", label: t("Keep unused money"), meta: t("Carry only a positive remaining balance") }, { value: "carry_balance", label: t("Carry the full balance"), meta: t("Carry surplus or overspending") }]} required /><div className="rollover-preview"><span>{t("Moves forward")}</span><strong className={rolloverPreview < 0 ? "negative" : ""}>{money(rolloverPreview, budget.currency)}</strong><small>{budget.rolloverDecision ? t("Updating the existing decision") : t("Creates the next monthly budget if needed")}</small></div><button className="submit-button" disabled={pending}>{t(budget.rolloverDecision ? "Update rollover" : "Save and prepare next month")}</button></form> : <p className="budget-open-note"><CalendarDots aria-hidden="true" />{t("Rollover becomes available after this month closes.")}</p>}
  </article>;
}

function DebtPayoffLab({ debts, reportingCurrency, asOf, language }: { debts: DashboardData["debts"]; reportingCurrency: string; asOf: string; language: AppLanguage }) {
  const t = (copy: string) => translate(language, copy);
  const [extraPayment, setExtraPayment] = useState("0");
  const [selectedStrategy, setSelectedStrategy] = useState<DebtStrategy>("avalanche");
  const [showFullSchedule, setShowFullSchedule] = useState(false);
  const extra = Number(extraPayment);
  const payoffDebts = useMemo(() => debts
    .filter((debt) => debt.direction === "payable" && debt.balance > 0 && debt.reportingBalance !== null)
    .map((debt) => {
      const conversionRate = debt.balance > 0 ? (debt.reportingBalance ?? 0) / debt.balance : 0;
      return { id: debt.id, name: debt.creditor, balance: debt.reportingBalance ?? 0, annualRate: debt.rate ?? 0, minimumPayment: (debt.minimum ?? 0) * conversionRate };
    }), [debts]);
  const snowball = useMemo(() => projectDebtStrategy(payoffDebts, "snowball", Number.isFinite(extra) ? extra : 0), [payoffDebts, extra]);
  const avalanche = useMemo(() => projectDebtStrategy(payoffDebts, "avalanche", Number.isFinite(extra) ? extra : 0), [payoffDebts, extra]);
  const activeProjection = selectedStrategy === "snowball" ? snowball : avalanche;
  const recommended: DebtStrategy = avalanche.months !== null && (snowball.months === null || avalanche.totalInterest <= snowball.totalInterest) ? "avalanche" : "snowball";
  const payoffLabel = (months: number | null) => months === null
    ? t("Increase the monthly budget")
    : months === 0
      ? t("No payable debts")
      : `${months} ${t(months === 1 ? "month" : "months")}`;
  const scheduleDate = (monthOffset: number) => {
    const date = new Date(`${asOf}T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + monthOffset);
    return new Intl.DateTimeFormat(localeFor(language), { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  };

  if (!payoffDebts.length) return <section className="payoff-lab payoff-lab-empty"><div><p className="eyebrow">{t("PAYOFF LAB")}</p><h3>{t("Compare payoff strategies")}</h3><p>{t("Add a payable debt with a known exchange rate to compare snowball and avalanche plans.")}</p></div></section>;

  return <section className="payoff-lab" aria-labelledby="payoff-lab-title">
    <div className="payoff-lab-heading"><div><p className="eyebrow">{t("PAYOFF LAB")}</p><h3 id="payoff-lab-title">{t("Compare payoff strategies")}</h3><p>{t("Laundry keeps one fixed monthly budget and redirects freed minimums to the next balance.")}</p></div><label>{t("Extra each month")}<span><b>{reportingCurrency}</b><input type="number" min="0" step="any" inputMode="decimal" value={extraPayment} onChange={(event) => setExtraPayment(event.target.value)} aria-describedby="payoff-budget-note" /></span><small id="payoff-budget-note">{t("Added on top of all recorded minimums")}</small></label></div>
    <div className="payoff-comparison">
      {([snowball, avalanche] as const).map((projection) => <button type="button" className={`payoff-strategy ${selectedStrategy === projection.strategy ? "selected" : ""}`} aria-pressed={selectedStrategy === projection.strategy} onClick={() => setSelectedStrategy(projection.strategy)} key={projection.strategy}>
        <span><strong>{t(projection.strategy === "snowball" ? "Snowball" : "Avalanche")}</strong>{recommended === projection.strategy && <i>{t("Lowest projected interest")}</i>}</span>
        <b>{payoffLabel(projection.months)}</b>
        <small>{t("Projected interest")} · {money(projection.totalInterest, reportingCurrency)}</small>
      </button>)}
    </div>
    <div className="payoff-summary"><span><small>{t("Monthly debt budget")}</small><strong>{money(activeProjection.monthlyBudget, reportingCurrency)}</strong></span><span><small>{t("Projected interest")}</small><strong>{money(activeProjection.totalInterest, reportingCurrency)}</strong></span><span><small>{t("Debt-free estimate")}</small><strong>{payoffLabel(activeProjection.months)}</strong></span></div>
    <div className="payoff-schedule"><div className="payoff-schedule-heading"><div><p className="eyebrow">{showFullSchedule ? t("FULL SCHEDULE") : t("FIRST 12 MONTHS")}</p><h4>{t(selectedStrategy === "snowball" ? "Snowball schedule" : "Avalanche schedule")}</h4></div><div><span>{t("All values in")} {reportingCurrency}</span>{activeProjection.months !== null && activeProjection.schedule.length > 12 && <button type="button" className="text-button" onClick={() => setShowFullSchedule((current) => !current)}>{t(showFullSchedule ? "Show first 12 months" : "Show full schedule")}</button>}</div></div>
      {activeProjection.months === null && <p className="payoff-warning"><WarningCircle aria-hidden="true" />{t(activeProjection.monthlyBudget <= 0 ? "Add minimum payments or an extra monthly amount to build a payoff schedule." : "The current monthly budget does not clear every balance; increase it to produce a completion date.")}</p>}
      {activeProjection.schedule.length > 0 && <div className="payoff-schedule-list">{(showFullSchedule && activeProjection.months !== null ? activeProjection.schedule : activeProjection.schedule.slice(0, 12)).map((row) => <article key={row.month}><time>{scheduleDate(row.month - 1)}</time><span><small>{t("Focus")}</small><strong>{row.focusName}</strong></span><span><small>{t("Payment")}</small><strong>{money(row.payment, reportingCurrency)}</strong></span><span><small>{t("Interest")}</small><strong>{money(row.interest, reportingCurrency)}</strong></span><span><small>{t("Remaining")}</small><strong>{money(row.closingBalance, reportingCurrency)}</strong></span></article>)}</div>}
    </div>
  </section>;
}

function PlansWorkspace({ data, household, pending, onCreateGoal, onAllocateGoal, onCreateDebt, onPayDebt, onCreateBudget, onCreateEnvelope, onRolloverBudget, onCreateRecurring, onConfirmOccurrence, onSkipOccurrence, language }: PlansWorkspaceProps) {
  const today = data.asOf;
  const t = (copy: string) => translate(language, copy);
  const [debtDirection, setDebtDirection] = useState<"payable" | "receivable">("payable");
  const [recurringKind, setRecurringKind] = useState<"bill" | "subscription" | "income">("bill");
  const month = `${today.slice(0, 7)}-01`;
  const expenseCategories = data.categories.filter((category) => category.kind === "expense");
  const recurringCategories = data.categories.filter((category) => category.kind === (recurringKind === "income" ? "income" : "expense"));
  const currencyOptions = buildCurrencyOptions(localeFor(language), [household.currency, ...data.accounts.map((account) => account.currency), ...data.goals.map((goal) => goal.currency), ...data.debts.map((debt) => debt.currency), ...data.budgets.map((budget) => budget.currency), ...data.recurring.map((item) => item.currency)]);
  return <section className="plans-page">
    <section className="wide-card"><div className="section-head"><div><p className="eyebrow">{t("SAVINGS")}</p><h2>{t("Goals and allocations")}</h2><p>{t("Allocations reserve progress; they do not alter your account balance.")}</p></div></div>
      <form className="form-grid" onSubmit={onCreateGoal}><label>{t("Name")}<input name="name" required maxLength={100} /></label><label>{t("Target")}<input name="targetAmount" inputMode="decimal" required /></label><SelectField name="currency" label={t("Currency")} defaultValue={household.currency} closeLabel={t("Close")} sheetTitle={t("Choose a currency")} options={currencyOptions} required /><label>{t("Target date")}<input name="targetDate" type="date" /></label><label>{t("Visibility")}<select name="visibility" defaultValue="shared"><option value="shared">{t("Shared")}</option><option value="private">{t("Private")}</option></select></label><button className="submit-button" disabled={pending}>{t("Create goal")}</button></form>
      <div className="goal-plan-list">{data.goals.map((goal) => <GoalPlanCard key={goal.id} goal={goal} allocations={data.goalAllocations} asOf={today} language={language} pending={pending} onAllocate={onAllocateGoal} />)}</div>
    </section>
    <section className="wide-card"><div className="section-head"><div><p className="eyebrow">{t("DEBT & RECEIVABLES")}</p><h2>{t("Money owed")}</h2><p>{t("Track both money you owe and money other people owe you. Payments and collections post to the ledger.")}</p></div></div>
      <form className="form-grid" onSubmit={onCreateDebt}>
        <SelectField name="direction" label={t("Direction")} value={debtDirection} onValueChange={(value) => setDebtDirection(value as "payable" | "receivable")} closeLabel={t("Close")} sheetTitle={t("Who owes the money?")} options={[{ value: "payable", label: t("I owe money"), meta: t("A person, bank, or lender must be paid") }, { value: "receivable", label: t("Someone owes me"), meta: t("Track money you expect to collect") }]} required />
        <label>{debtDirection === "payable" ? t("Creditor") : t("Person or organization")}<input name="creditor" required maxLength={120} /></label>
        <label>{t("Outstanding balance")}<input name="balance" type="number" min="0.01" step="any" inputMode="decimal" required /></label>
        <SelectField name="currency" label={t("Currency")} defaultValue={household.currency} closeLabel={t("Close")} sheetTitle={t("Choose a currency")} options={currencyOptions} required />
        <label>APR %<input name="rate" type="number" min="0" max="100" step="any" inputMode="decimal" /></label>
        <label>{debtDirection === "payable" ? t("Minimum payment") : t("Expected collection")}<input name="minimum" type="number" min="0" step="any" inputMode="decimal" /></label>
        <label>{t("Due day")}<input name="dueDay" type="number" min="1" max="31" /></label>
        <SelectField name="accountId" label={debtDirection === "payable" ? t("Linked liability account") : t("Linked receivable account")} defaultValue="" closeLabel={t("Close")} sheetTitle={t("Choose an optional ledger account")} options={[{ value: "", label: t("None") }, ...data.accounts.map((account) => ({ value: account.id, label: account.name, meta: account.currency }))]} />
        <SelectField name="visibility" label={t("Visibility")} defaultValue="shared" closeLabel={t("Close")} sheetTitle={t("Choose who can see it")} options={[{ value: "shared", label: t("Shared") }, { value: "private", label: t("Private") }]} required />
        <button className="submit-button" disabled={pending}>{debtDirection === "payable" ? t("Create debt") : t("Create receivable")}</button>
      </form>
      <DebtPayoffLab debts={data.debts} reportingCurrency={household.currency} asOf={today} language={language} />
      <div className="debt-direction-list">{data.debts.map((debt) => {
        const payoffMonths = debtPayoffMonths(debt.balance, debt.rate ?? 0, debt.minimum ?? 0);
        const matchingAccounts = data.accounts.filter((account) => account.currency === debt.currency && account.id !== debt.accountId);
        return <article className="plan-operation" key={debt.id}><div className="due-row"><div className="grow"><span className={`debt-direction-badge ${debt.direction}`}>{debt.direction === "payable" ? t("I owe") : t("Owed to me")}</span><strong>{debt.creditor}</strong><span>{debt.rate ?? 0}% APR · {debt.direction === "payable" ? t("minimum") : t("expected")} {money(debt.minimum ?? 0, debt.currency)}{debt.dueDay ? ` · ${t("due day")} ${debt.dueDay}` : ""}</span></div><strong>{money(debt.balance, debt.currency)}</strong></div>{debt.minimum ? <p className="payoff-note">{payoffMonths ? (language === "es" ? `${debt.direction === "payable" ? "Pago" : "Cobro"} estimado: ${payoffMonths} mes${payoffMonths === 1 ? "" : "es"}.` : `Estimated ${debt.direction === "payable" ? "payoff" : "collection"}: ${payoffMonths} month${payoffMonths === 1 ? "" : "s"}.`) : t("The current amount will not reduce this balance; increase it.")}</p> : null}<form className="inline-operation" onSubmit={(event) => onPayDebt(debt.id, debt.visibility, event)}><label>{debt.direction === "payable" ? t("Pay from") : t("Deposit into")}<select name="accountId" required>{matchingAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label><label>{debt.direction === "payable" ? t("Payment") : t("Collection")}<input name="amount" type="number" step="any" required min="0.01" max={debt.balance} inputMode="decimal" placeholder="0.00" /></label><label>{t("Date")}<input name="paidOn" type="date" defaultValue={today} required /></label><label>{t("Visibility")}<select name="visibility" defaultValue={debt.visibility} disabled={debt.visibility === "private"}><option value="shared">{t("Shared")}</option><option value="private">{t("Private")}</option></select></label><label className="grow">{t("Note")}<input name="note" maxLength={500} placeholder={t("Optional payment note")} /></label><button className="text-button" disabled={pending || !matchingAccounts.length}>{debt.direction === "payable" ? t("Record payment") : t("Record collection")}</button></form></article>;
      })}</div>
    </section>
    <section className="wide-card"><div className="section-head"><div><p className="eyebrow">{t("SPENDING PLAN")}</p><h2>{t("Budgets and envelopes")}</h2><p>{t("Actual spending is derived from posted expenses in the same currency and month.")}</p></div></div>
      <form className="form-grid" onSubmit={onCreateBudget}><label>{t("Category")}<select name="categoryId"><option value="">{t("Overall")}</option>{expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>{t("Month")}<input name="month" type="date" defaultValue={month} required /></label><label>{t("Limit")}<input name="amount" inputMode="decimal" required /></label><label>{t("Envelope allocation")}<input name="envelope" inputMode="decimal" defaultValue="0" /></label><SelectField name="currency" label={t("Currency")} defaultValue={household.currency} closeLabel={t("Close")} sheetTitle={t("Choose a currency")} options={currencyOptions} required /><label>{t("Visibility")}<select name="visibility" defaultValue="shared"><option value="shared">{t("Shared")}</option><option value="private">{t("Private")}</option></select></label><button className="submit-button" disabled={pending}>{t("Create budget")}</button></form>
      <div className="budget-plan-list">{data.budgets.map((budget) => { const previousBudget = data.budgets.find((candidate) => candidate.id !== budget.id && candidate.categoryId === budget.categoryId && candidate.currency === budget.currency && candidate.visibility === budget.visibility && nextBudgetMonth(candidate.month) === budget.month) ?? null; return <BudgetPlanCard key={budget.id} budget={budget} previousBudget={previousBudget} asOf={today} language={language} pending={pending} onEnvelope={onCreateEnvelope} onRollover={onRolloverBudget} />; })}</div>
    </section>
    <section className="wide-card"><div className="section-head"><div><p className="eyebrow">{t("CASH FLOW")}</p><h2>{t("Recurring bills and subscriptions")}</h2><p>{t("Projected items do not affect balances until you explicitly confirm them.")}</p></div></div>
      <form className="form-grid" onSubmit={onCreateRecurring}><label>{t("Name")}<input name="name" required maxLength={120} /></label><SelectField name="ruleKind" label={t("Type")} value={recurringKind} onValueChange={(value) => setRecurringKind(value as "bill" | "subscription" | "income")} closeLabel={t("Close")} sheetTitle={t("Choose the recurring type")} options={[{ value: "bill", label: t("Bill") }, { value: "subscription", label: t("Subscription") }, { value: "income", label: t("Income") }]} required /><label>{t("Account")}<select name="accountId" required>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label><label>{t("Category")}<select name="categoryId"><option value="">{t("Uncategorized")}</option>{recurringCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>{t("Amount")}<input name="amount" type="number" min="0.01" step="any" inputMode="decimal" required /></label><label>{t("Provider")}<input name="provider" maxLength={120} /></label><label>{t("Service reference")}<input name="serviceReference" maxLength={120} /></label><label>{t("Billing period")}<input name="billingPeriod" maxLength={80} placeholder={t("e.g. monthly service")} /></label><label>{t("Cadence")}<select name="cadence" defaultValue="monthly"><option value="weekly">{t("Weekly")}</option><option value="monthly">{t("Monthly")}</option><option value="quarterly">{t("Quarterly")}</option><option value="yearly">{t("Yearly")}</option></select></label><label>{t("First due date")}<input name="nextDueOn" type="date" required /></label><label>{t("Visibility")}<select name="visibility" defaultValue="shared"><option value="shared">{t("Shared")}</option><option value="private">{t("Private")}</option></select></label><button className="submit-button" disabled={pending || !data.accounts.length}>{t("Create recurring rule")}</button></form>
      <section className="obligation-calendar" aria-labelledby="obligation-calendar-title"><div className="obligation-calendar-heading"><div><p className="eyebrow">{t("DUE CALENDAR")}</p><h3 id="obligation-calendar-title">{t("Scheduled obligations")}</h3></div><span>{data.recurringOccurrences.filter((item) => item.status === "projected").length} {t("open")}</span></div>
        {data.recurringOccurrences.length ? <div className="obligation-list">{data.recurringOccurrences.map((item) => {
          const state = obligationState(item.dueOn, today, item.status);
          return <article className={`obligation-row ${state}`} key={item.id}><span className="obligation-date"><strong>{new Intl.DateTimeFormat(localeFor(language), { day: "2-digit", timeZone: "UTC" }).format(new Date(`${item.dueOn}T12:00:00Z`))}</strong><small>{new Intl.DateTimeFormat(localeFor(language), { month: "short", timeZone: "UTC" }).format(new Date(`${item.dueOn}T12:00:00Z`))}</small></span><span className="obligation-icon" aria-hidden="true">{state === "confirmed" ? <CheckCircle weight="duotone" /> : state === "overdue" ? <WarningCircle weight="duotone" /> : <CalendarDots weight="duotone" />}</span><div className="grow"><span className="obligation-status">{t(state === "due-today" ? "Due today" : state)}</span><strong>{item.name}</strong><small>{item.provider ? `${item.provider} · ` : ""}{t(item.kind)} · {t(item.visibility === "private" ? "Private" : "Shared")}</small></div><strong className="obligation-amount">{money(item.amount, item.currency)}</strong>{item.status === "projected" && <div className="obligation-actions"><button type="button" className="submit-button" disabled={pending} onClick={() => onConfirmOccurrence(item)}>{t(item.kind === "income" ? "Confirm received" : "Confirm paid")}</button><button type="button" className="text-button" disabled={pending} onClick={() => onSkipOccurrence(item.id)}>{t("Skip")}</button></div>}</article>;
        })}</div> : <EmptyState icon={CalendarDots} title={t("Nothing Scheduled")} body={t("Create a recurring rule to build the next four months of your calendar.")} />}
      </section>
    </section>
  </section>;
}
