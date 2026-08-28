"use client";

import { FormEvent, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, ArrowsLeftRight, Bank, CalendarDots, CaretRight, ChartDonut, ChartLineUp, ChatCircleDots, CreditCard, DeviceMobile, DownloadSimple, GearSix, House, Plus, Receipt, SignOut, ShoppingCart, Target, Wallet } from "@phosphor-icons/react";
import type { DashboardData } from "../lib/dashboard";
import { debtPayoffMonths } from "../lib/finance";
import { createClient } from "../lib/supabase/client";
import { addShoppingItem, allocateGoal, checkoutShoppingList, confirmRecurringRule, createAccount, createBudget, createBudgetEnvelope, createCategory, createDebt, createGoal, createHouseholdInvitation, createRecurringRule, createShoppingList, postTransaction, recordDebtPayment, uploadReceipt } from "./actions/finance";
import FinanceAssistant from "./finance-assistant";

const currencyFormatter = (currency: string) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency,
  currencyDisplay: "code",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const money = (amount: number, currency: string) => currencyFormatter(currency).format(amount);
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
type CheckoutLine = { selected: boolean; quantity: string; actualPrice: string; discount: string; taxRate: string; fixedTax: string; categoryId: string };
type CheckoutAdjustments = { discount: string; shipping: string; tip: string };
const numeric = (value: string | number | undefined | null) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };

export default function DashboardClient({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [message, setMessage] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [pending, startTransition] = useTransition();
  const [checkoutList, setCheckoutList] = useState<string | null>(null);
  const [checkoutDraft, setCheckoutDraft] = useState<Record<string, CheckoutLine>>({});
  const [checkoutAdjustments, setCheckoutAdjustments] = useState<Record<string, CheckoutAdjustments>>({});
  const household = data.household!;
  const netWorth = data.accounts.reduce((sum, account) => sum + (account.currency === household.currency ? account.balance : 0), 0);
  const moneyOut = data.transactions.filter((item) => item.kind === "expense").reduce((sum, item) => sum + item.amount, 0);
  const moneyIn = data.transactions.filter((item) => item.kind === "income").reduce((sum, item) => sum + item.amount, 0);
  const expenseCategories = data.categories.filter((category) => category.kind === "expense");
  const defaultShoppingCategory = expenseCategories.find((category) => category.name.toLowerCase() === "shopping")?.id ?? expenseCategories[0]?.id ?? "";
  const complete = (result: { error?: string }) => { setMessage(result.error ?? "Saved."); if (!result.error) router.refresh(); };
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

  async function signOut() {
    setSigningOut(true);
    setMessage("");
    const { error } = await createClient().auth.signOut({ scope: "local" });
    if (error) { setMessage("Sign out failed. Check your connection and try again."); setSigningOut(false); return; }
    router.replace("/login");
    router.refresh();
  }

  function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    startTransition(async () => complete(await createAccount({ householdId: household.id, name: form.get("name"), kind: form.get("kind"), currency: form.get("currency"), openingBalance: form.get("openingBalance") || 0, visibility: form.get("visibility"), creditLimit: form.get("creditLimit") || undefined, paymentAccountId: form.get("paymentAccountId") || undefined, closingDay: form.get("closingDay") || undefined, dueDay: form.get("dueDay") || undefined })));
  }
  function submitTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const kind = String(form.get("kind"));
    startTransition(async () => complete(await postTransaction({ householdId: household.id, accountId: form.get("accountId"), transferAccountId: kind === "transfer" ? form.get("transferAccountId") : undefined, categoryId: form.get("categoryId") || undefined, kind, amount: form.get("amount"), currency: form.get("currency"), reportingExchangeRate: form.get("rate") || 1, occurredOn: form.get("occurredOn"), payee: form.get("payee") || undefined, note: form.get("note") || undefined, visibility: form.get("visibility"), items: [] })));
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
  function submitDebt(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await createDebt({ householdId: household.id, creditor: form.get("creditor"), balance: form.get("balance"), currency: form.get("currency"), interestRate: form.get("rate") || undefined, minimumPayment: form.get("minimum") || undefined, dueDay: form.get("dueDay") || undefined, accountId: form.get("accountId") || undefined, visibility: form.get("visibility") }))); }
  function submitBudget(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await createBudget({ householdId: household.id, categoryId: form.get("categoryId") || undefined, month: form.get("month"), amount: form.get("amount"), envelopeAmount: form.get("envelope") || 0, currency: form.get("currency"), visibility: form.get("visibility") }))); }
  function submitRecurring(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await createRecurringRule({ householdId: household.id, accountId: form.get("accountId"), categoryId: form.get("categoryId") || undefined, name: form.get("name"), amount: form.get("amount"), currency: form.get("currency"), cadence: form.get("cadence"), nextDueOn: form.get("nextDueOn"), ruleKind: form.get("ruleKind"), visibility: form.get("visibility") }))); }
  function submitGoalAllocation(goalId: string, event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await allocateGoal({ goalId, amount: form.get("amount"), allocatedOn: form.get("allocatedOn"), note: form.get("note") || undefined }))); }
  function submitDebtPayment(debtId: string, visibility: "private" | "shared", event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await recordDebtPayment({ debtId, accountId: form.get("accountId"), amount: form.get("amount"), paidOn: form.get("paidOn"), visibility: form.get("visibility") || visibility, note: form.get("note") || undefined }))); }
  function submitBudgetEnvelope(budgetId: string, event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => complete(await createBudgetEnvelope({ budgetId, name: form.get("name"), amount: form.get("amount") || 0 }))); }
  function confirmRecurring(item: DashboardData["recurring"][number]) { startTransition(async () => complete(await confirmRecurringRule({ ruleId: item.id, paidOn: data.asOf }))); }

  return <div className="ledger-app">
    <a className="skip-link" href="#main-content">Skip to Main Content</a>
    <aside className="app-rail">
      <div className="rail-brand"><span className="rail-brand-mark" aria-hidden="true">L</span><span><strong translate="no">Laundry</strong><small>Household Finance</small></span></div>
      <button className="rail-household" type="button" onClick={() => setTab("settings")}><span className="household-orb" aria-hidden="true"><ChartDonut weight="duotone" /></span><span className="rail-household-copy"><small>ACTIVE HOUSEHOLD</small><strong>{household.name}</strong></span><CaretRight aria-hidden="true" /></button>
      <nav className="rail-nav" aria-label="Finance Workspace">{NAV_ITEMS.map(({ id, label, icon: Icon }) => <button className={tab === id ? "rail-link active" : "rail-link"} type="button" onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} key={id}><Icon aria-hidden="true" weight={tab === id ? "fill" : "regular"} /><span>{label}</span>{id === "plans" && data.recurring.length > 0 && <small>{data.recurring.length}</small>}</button>)}</nav>
      <div className="rail-bottom"><div className="rail-profile"><span className="profile-avatar" aria-hidden="true">{data.userName.slice(0, 2).toUpperCase()}</span><span className="profile-copy"><strong>{data.userName}</strong><small>Signed In</small></span></div><button className="signout-button" type="button" onClick={signOut} disabled={signingOut} aria-label={signingOut ? "Signing out" : "Sign out"}><SignOut aria-hidden="true" /><span>{signingOut ? "Signing Out…" : "Sign Out"}</span></button></div>
    </aside>
    <main className="content dashboard-surface" id="main-content">
    <header className="workspace-header"><div><p className="eyebrow">{viewMeta[tab].eyebrow}</p><h1>{viewMeta[tab].title}</h1><p className="workspace-date">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${data.asOf}T12:00:00Z`))} · Welcome, {data.userName}.</p></div><button className="primary-action" type="button" onClick={() => setTab("activity")}><Plus aria-hidden="true" weight="bold" /><span>Post Transaction</span></button></header>
    {message && <p className="workspace-message" role="status" aria-live="polite">{message}</p>}
    {tab === "overview" && <OverviewPanel data={data} netWorth={netWorth} moneyIn={moneyIn} moneyOut={moneyOut} onNavigate={setTab} />}
    {tab === "accounts" && <section className="stack-page"><section className="wide-card"><h2>Add account or card</h2><form className="form-grid" onSubmit={submitAccount}><label>Name<input name="name" required maxLength={80} /></label><label>Type<select name="kind" defaultValue="bank"><option value="bank">Bank</option><option value="cash">Cash</option><option value="savings">Savings</option><option value="card">Credit card</option><option value="loan">Loan</option></select></label><label>Currency<input name="currency" defaultValue={household.currency} maxLength={3} required /></label><label>Opening balance<input name="openingBalance" inputMode="decimal" defaultValue="0" /></label><label>Visibility<select name="visibility" defaultValue="shared"><option value="shared">Shared</option><option value="private">Private</option></select></label><label>Card limit (optional)<input name="creditLimit" inputMode="decimal" /></label><label>Closing day (card)<input name="closingDay" type="number" min="1" max="31" /></label><label>Due day (card)<input name="dueDay" type="number" min="1" max="31" /></label><button className="submit-button" disabled={pending}>Create account</button></form></section><section className="wide-card"><h2>Current accounts</h2>{data.accounts.map((account) => <div className="account-row large" key={account.id}><div className="grow"><strong>{account.name}</strong><span>{account.kind} · {account.visibility}</span></div>{account.creditLimit && <span>{money(Math.abs(account.balance), account.currency)} / {money(account.creditLimit, account.currency)}</span>}<strong>{money(account.balance, account.currency)}</strong></div>)}</section></section>}
    {tab === "activity" && <section className="stack-page"><section className="wide-card"><h2>Post ledger transaction</h2><form className="form-grid" onSubmit={submitTransaction}><label>Type<select name="kind" defaultValue="expense"><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option><option value="adjustment">Adjustment</option></select></label><label>Account<select name="accountId" required>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Transfer destination<select name="transferAccountId"><option value="">Not a transfer</option>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Category<select name="categoryId"><option value="">No category</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.kind}: {category.name}</option>)}</select></label><label>Amount<input name="amount" required inputMode="decimal" /></label><label>Currency<input name="currency" defaultValue={household.currency} maxLength={3} required /></label><label>Reporting FX rate<input name="rate" defaultValue="1" inputMode="decimal" required /></label><label>Date<input name="occurredOn" defaultValue={data.asOf} type="date" required /></label><label>Payee<input name="payee" maxLength={120} /></label><label>Note<input name="note" maxLength={2000} /></label><label>Visibility<select name="visibility" defaultValue="shared"><option value="shared">Shared</option><option value="private">Private</option></select></label><button className="submit-button" disabled={pending}>Post transaction</button></form></section><section className="wide-card"><h2>Ledger activity</h2>{data.transactions.map((transaction) => <TransactionLine key={transaction.id} transaction={transaction} />)}</section></section>}
    {tab === "plans" && <PlansWorkspace data={data} household={household} pending={pending} onCreateGoal={submitGoal} onAllocateGoal={submitGoalAllocation} onCreateDebt={submitDebt} onPayDebt={submitDebtPayment} onCreateBudget={submitBudget} onCreateEnvelope={submitBudgetEnvelope} onCreateRecurring={submitRecurring} onConfirmRecurring={confirmRecurring} />}
    {tab === "shopping" && <section className="stack-page"><section className="wide-card"><h2>Create shopping list</h2><form className="form-grid" onSubmit={submitList}><label>List name<input name="name" required maxLength={100} /></label><label>Currency<input name="currency" defaultValue={household.currency} maxLength={3} required /></label><label>Visibility<select name="visibility" defaultValue="shared"><option value="shared">Shared</option><option value="private">Private</option></select></label><label>Tax rate %<input name="taxRate" defaultValue={household.taxRate} inputMode="decimal" /></label><button className="submit-button" disabled={pending}>Create list</button></form></section>{data.shoppingLists.map((list) => { const preview = checkoutPreview(list); const adjustment = checkoutAdjustments[list.id] ?? { discount: String(list.discount), shipping: String(list.shipping), tip: String(list.tip) }; return <section className="wide-card shopping-workspace" key={list.id}><div className="section-head"><div><p className="eyebrow">{list.visibility} LIST</p><h2>{list.name}</h2><p>{list.items.length} open item{list.items.length === 1 ? "" : "s"} · tax default {list.taxRate}%</p></div><button className="add-button" type="button" disabled={!list.items.length || !data.accounts.length || !expenseCategories.length} onClick={() => openCheckout(list)}>Go shopping</button></div><div className="shopping-lines">{list.items.length ? list.items.map((item) => <div className="shopping-item" key={item.id}><div className="grow"><strong>{item.name}</strong><span>{item.quantity} × {money(item.actualPrice ?? item.estimatedPrice, list.currency)}{item.taxRate !== null ? ` · ${item.taxRate}% tax` : ""}</span></div><strong>{money(item.quantity * (item.actualPrice ?? item.estimatedPrice), list.currency)}</strong></div>) : <p className="muted">Nothing left on this list. Add the next item below.</p>}</div><form className="shopping-add-form" onSubmit={(event) => submitShoppingItem(list.id, event)}><label>Item<input name="name" required maxLength={160} placeholder="e.g. Coffee" /></label><label>Qty<input name="quantity" type="number" min="0.001" step="0.001" defaultValue="1" required /></label><label>Estimated price<input name="estimatedPrice" inputMode="decimal" defaultValue="0" required /></label><label>Category<select name="categoryId" defaultValue={defaultShoppingCategory}>{expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Tax %<input name="taxRate" inputMode="decimal" placeholder={`${list.taxRate}`} /></label><button type="submit" className="text-button" disabled={pending}>Add item</button></form>{checkoutList === list.id && <form className="checkout-review" onSubmit={(event) => submitCheckout(list, event)}><div className="checkout-heading"><div><p className="eyebrow">TRIP REVIEW</p><h3>Confirm what you bought</h3></div><button type="button" className="text-button" onClick={() => setCheckoutList(null)}>Cancel</button></div><fieldset className="checkout-items"><legend>Items</legend>{list.items.map((item) => { const draft = checkoutDraft[item.id] ?? { selected: false, quantity: String(item.quantity), actualPrice: String(item.actualPrice ?? item.estimatedPrice), discount: "0", taxRate: String(item.taxRate ?? list.taxRate), fixedTax: "", categoryId: item.categoryId ?? defaultShoppingCategory }; return <div className="checkout-item-line" key={item.id}><label className="item-select"><input type="checkbox" checked={draft.selected} onChange={(event) => updateCheckoutLine(item.id, "selected", event.target.checked)} /><span>{item.name}</span></label><label>Qty<input disabled={!draft.selected} type="number" min="0.001" step="0.001" value={draft.quantity} onChange={(event) => updateCheckoutLine(item.id, "quantity", event.target.value)} /></label><label>Actual price<input disabled={!draft.selected} inputMode="decimal" value={draft.actualPrice} onChange={(event) => updateCheckoutLine(item.id, "actualPrice", event.target.value)} /></label><label>Item discount<input disabled={!draft.selected} inputMode="decimal" value={draft.discount} onChange={(event) => updateCheckoutLine(item.id, "discount", event.target.value)} /></label><label>Tax %<input disabled={!draft.selected || draft.fixedTax !== ""} inputMode="decimal" value={draft.taxRate} onChange={(event) => updateCheckoutLine(item.id, "taxRate", event.target.value)} /></label><label>Fixed tax<input disabled={!draft.selected} inputMode="decimal" value={draft.fixedTax} onChange={(event) => updateCheckoutLine(item.id, "fixedTax", event.target.value)} /></label><label>Category<select disabled={!draft.selected} value={draft.categoryId} onChange={(event) => updateCheckoutLine(item.id, "categoryId", event.target.value)}>{expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div>; })}</fieldset><div className="checkout-adjustments"><label>List discount<input inputMode="decimal" value={adjustment.discount} onChange={(event) => updateCheckoutAdjustment(list.id, "discount", event.target.value)} /></label><label>Shipping<input inputMode="decimal" value={adjustment.shipping} onChange={(event) => updateCheckoutAdjustment(list.id, "shipping", event.target.value)} /></label><label>Tip<input inputMode="decimal" value={adjustment.tip} onChange={(event) => updateCheckoutAdjustment(list.id, "tip", event.target.value)} /></label></div><div className="checkout-meta"><label>Paying account<select name="accountId" required>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label><label>Overall category<select name="categoryId" defaultValue={defaultShoppingCategory} required>{expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Date<input name="occurredOn" type="date" defaultValue={data.asOf} required /></label><label>Visibility<select name="visibility" defaultValue={list.visibility}><option value="shared">Shared</option><option value="private">Private</option></select></label><label>Receipt (optional)<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></label><label className="full">Note<input name="note" maxLength={2000} placeholder="Optional store or trip note" /></label></div><div className="checkout-total" aria-live="polite"><span>{preview.count} selected · subtotal {money(preview.subtotal, list.currency)} · tax {money(preview.tax, list.currency)}</span><strong>{money(preview.total, list.currency)}</strong></div><button className="submit-button" disabled={pending || preview.count === 0 || preview.total <= 0}>Post itemized expense</button><p className="form-note">The total is recalculated securely on the server. Purchased lines are retained on the transaction; only unbought items remain on this list.</p></form>}</section>; })}</section>}
    {tab === "reports" && <ReportsPanel data={data} netWorth={netWorth} />}
    {tab === "assistant" && <FinanceAssistant data={data} />}
    {tab === "settings" && <section className="stack-page"><InstallAppCard /><section className="wide-card"><h2>Categories</h2><form className="form-grid" onSubmit={submitCategory}><label>Name<input name="name" required maxLength={80} autoComplete="off" /></label><label>Type<select name="kind" autoComplete="off"><option value="expense">Expense</option><option value="income">Income</option></select></label><label>Color<input name="color" type="color" defaultValue="#79dfa9" /></label><button className="submit-button" disabled={pending}>Create Category</button></form>{data.categories.map((category) => <p key={category.id}>{category.kind}: {category.name}</p>)}</section><section className="wide-card"><h2>Invite Household Member</h2><p className="muted">Invitations expire after 7 days. Production email delivery needs a verified domain and SMTP service.</p><form className="form-grid" onSubmit={submitInvite}><label>Email<input name="email" type="email" inputMode="email" autoComplete="email" spellCheck={false} required maxLength={254} placeholder="member@example.com…" /></label><button className="submit-button" disabled={pending}>Send Invitation</button></form></section></section>}
  </main></div>;
}

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

function InstallAppCard() {
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

  return <section className="wide-card install-card"><span className="install-glyph" aria-hidden="true"><DeviceMobile weight="duotone" /></span><div className="grow"><p className="eyebrow">INSTALLABLE APP</p><h2>Keep Laundry on This Device</h2><p className="muted" aria-live="polite">{installed ? "Laundry is running as an installed app." : installPrompt ? "Install a focused, standalone version from this browser." : "Use your browser menu and choose Install App or Add to Home Screen."}</p></div>{installPrompt && !installed && <button className="add-button" type="button" onClick={install}><DownloadSimple aria-hidden="true" />Install Laundry</button>}</section>;
}

function ReportsPanel({ data, netWorth }: { data: DashboardData; netWorth: number }) {
  const currency = data.household!.currency;
  const anchor = new Date(`${data.asOf}T12:00:00Z`);
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - (5 - index), 1));
    return { key: date.toISOString().slice(0, 7), label: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date), income: 0, expense: 0 };
  });
  const monthMap = new Map(months.map((month) => [month.key, month]));
  const categoryTotals = new Map<string, number>();
  for (const transaction of data.reportTransactions) {
    const reportingAmount = transaction.amount * (transaction.reportingExchangeRate || 1);
    const month = monthMap.get(transaction.occurredOn.slice(0, 7));
    if (month) month[transaction.kind] += reportingAmount;
    if (transaction.kind === "expense") categoryTotals.set(transaction.category ?? "Uncategorized", (categoryTotals.get(transaction.category ?? "Uncategorized") ?? 0) + reportingAmount);
  }
  const totalIncome = months.reduce((sum, month) => sum + month.income, 0);
  const totalExpense = months.reduce((sum, month) => sum + month.expense, 0);
  const maxMonthValue = Math.max(1, ...months.flatMap((month) => [month.income, month.expense]));
  const categories = [...categoryTotals.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6);
  const maxCategory = Math.max(1, ...categories.map(([, amount]) => amount));

  return <section className="reports-page">
    <section className="report-hero"><div><p className="eyebrow">6-MONTH REPORTING WINDOW</p><h2>{money(totalIncome - totalExpense, currency)}</h2><p>{totalIncome >= totalExpense ? "Net positive cash flow" : "Net negative cash flow"} after transaction-date currency conversion.</p></div><a className="report-export" href="/export/transactions"><DownloadSimple aria-hidden="true" weight="bold" />Export Transactions</a></section>
    <div className="report-grid">
      <section className="dashboard-panel report-flow"><div className="panel-heading"><div><p className="eyebrow">CASH FLOW</p><h2>Income & Expenses</h2></div><span className={totalIncome >= totalExpense ? "flow-badge positive" : "flow-badge negative"}>{money(Math.abs(totalIncome - totalExpense), currency)}</span></div><div className="flow-chart" role="list" aria-label="Six month income and expense comparison">{months.map((month) => <div className="flow-month" role="listitem" key={month.key}><div className="flow-bars" role="img" aria-label={`${month.label}: income ${money(month.income, currency)}, expenses ${money(month.expense, currency)}`}><i aria-hidden="true" className="income-bar" style={{ height: `${Math.max(3, month.income / maxMonthValue * 100)}%` }} /><i aria-hidden="true" className="expense-bar" style={{ height: `${Math.max(3, month.expense / maxMonthValue * 100)}%` }} /></div><strong>{month.label}</strong><span>{money(month.income - month.expense, currency)}</span></div>)}</div><div className="report-legend"><span><i aria-hidden="true" className="income-dot" />Income {money(totalIncome, currency)}</span><span><i aria-hidden="true" className="expense-dot" />Expenses {money(totalExpense, currency)}</span></div></section>
      <section className="dashboard-panel report-categories"><div className="panel-heading"><div><p className="eyebrow">SPENDING MIX</p><h2>Top Categories</h2></div></div>{categories.length ? <div className="category-report-list">{categories.map(([category, amount]) => <div className="category-report-row" key={category}><div><strong>{category}</strong><span>{money(amount, currency)}</span></div><div aria-hidden="true" className="category-report-track"><i style={{ width: `${amount / maxCategory * 100}%` }} /></div></div>)}</div> : <EmptyState icon={ChartLineUp} title="No Expenses Yet" body="Posted expenses will build your category report here." />}</section>
      <section className="dashboard-panel report-position"><div className="panel-heading"><div><p className="eyebrow">CURRENT POSITION</p><h2>Ledger Snapshot</h2></div></div><div className="position-value"><strong>{money(netWorth, currency)}</strong><span>Net worth in reporting-currency accounts</span></div><div className="position-facts"><span><strong>{data.accounts.length}</strong> active accounts</span><span><strong>{data.reportTransactions.length}</strong> reportable entries</span><span><strong>{data.budgets.length}</strong> budgets</span><span><strong>{data.goals.length}</strong> goals</span></div></section>
    </div>
  </section>;
}

function OverviewPanel({ data, netWorth, moneyIn, moneyOut, onNavigate }: { data: DashboardData; netWorth: number; moneyIn: number; moneyOut: number; onNavigate: (tab: DashboardTab) => void }) {
  const household = data.household!;
  const netWorthDisplay = moneyParts(netWorth, household.currency);
  const upcoming = data.recurring.reduce((sum, item) => item.currency === household.currency ? sum + item.amount : sum, 0);
  const monthlyFlow = moneyIn - moneyOut;
  return <div className="overview-grid">
    <section className="balance-stage" aria-labelledby="net-worth-title"><div className="balance-copy"><div className="balance-kicker"><span aria-hidden="true" /><p>LIVE LEDGER POSITION</p></div><h2 id="net-worth-title">Net Worth</h2><p className="balance-value"><span>{netWorthDisplay.currency}</span><strong>{netWorthDisplay.amount}</strong></p><p className="balance-caption">Across {data.accounts.length} active account{data.accounts.length === 1 ? "" : "s"}, calculated from posted entries.</p><button className="stage-action" type="button" onClick={() => onNavigate("accounts")}><span>{data.accounts.length ? "Explore Accounts" : "Add Your First Account"}</span><CaretRight aria-hidden="true" /></button></div><div className="balance-orbit" aria-hidden="true"><div className="orbit-halo orbit-halo-outer" /><div className="orbit-halo orbit-halo-inner" /><div className="orbit-node orbit-node-one"><Bank weight="fill" /></div><div className="orbit-node orbit-node-two"><CreditCard weight="fill" /></div><div className="orbit-node orbit-node-three"><Receipt weight="fill" /></div><div className="orbit-core"><span>{household.currency}</span><strong>{data.accounts.length}</strong><small>ACCOUNTS</small></div></div><div className="stage-foot"><span><i aria-hidden="true" /> Posted Ledger</span><span>Updated Now</span></div></section>
    <section className="signal-strip" aria-label="Cash Flow Signals"><SignalCard icon={ArrowUpRight} label="Money In" value={money(moneyIn, household.currency)} detail="Posted Income" tone="positive" /><SignalCard icon={ArrowDownRight} label="Money Out" value={money(moneyOut, household.currency)} detail="Posted Expenses" tone="negative" /><SignalCard icon={CalendarDots} label="Coming Up" value={money(upcoming, household.currency)} detail={`${data.recurring.length} Projected`} tone="future" /></section>
    <section className="dashboard-panel accounts-panel"><div className="panel-heading"><div><p className="eyebrow">YOUR MONEY MAP</p><h2>Accounts</h2></div><button className="panel-link" type="button" onClick={() => onNavigate("accounts")}>View All <CaretRight aria-hidden="true" /></button></div>{data.accounts.length ? <div className="account-stack">{data.accounts.slice(0, 4).map((account, index) => <div className="account-visual" key={account.id}><span className={`account-glyph account-glyph-${index % 3}`} aria-hidden="true">{account.kind === "card" ? <CreditCard weight="duotone" /> : account.kind === "cash" ? <Wallet weight="duotone" /> : <Bank weight="duotone" />}</span><div className="grow"><strong>{account.name}</strong><span>{account.kind} · {account.visibility}</span></div><div className="account-balance"><strong>{money(account.balance, account.currency)}</strong><small>{account.currency}</small></div></div>)}</div> : <EmptyState icon={Wallet} title="No Accounts Yet" body="Create your first bank, cash, savings, card, or loan account to bring this dashboard to life." action="Add Account" onAction={() => onNavigate("accounts")} />}</section>
    <section className="dashboard-panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">LATEST MOVEMENTS</p><h2>Recent Activity</h2></div><button className="panel-link" type="button" onClick={() => onNavigate("activity")}>Open Ledger <CaretRight aria-hidden="true" /></button></div>{data.transactions.length ? <div className="activity-stack">{data.transactions.slice(0, 5).map((transaction) => <TransactionLine key={transaction.id} transaction={transaction} />)}</div> : <EmptyState icon={Receipt} title="A Quiet Ledger" body="Your first posted income, expense, transfer, or adjustment will appear here." action="Post Transaction" onAction={() => onNavigate("activity")} />}</section>
    <section className="dashboard-panel pulse-panel"><div className="panel-heading"><div><p className="eyebrow">MONTHLY PULSE</p><h2>Cash Flow</h2></div><span className={monthlyFlow >= 0 ? "flow-badge positive" : "flow-badge negative"}>{monthlyFlow >= 0 ? "Surplus" : "Deficit"}</span></div><p className="pulse-value">{money(Math.abs(monthlyFlow), household.currency)}</p><p className="pulse-caption">{monthlyFlow >= 0 ? "More came in than went out across the activity currently loaded." : "Spending is ahead of income across the activity currently loaded."}</p><div className="pulse-track" aria-hidden="true"><i style={{ width: `${moneyIn + moneyOut > 0 ? Math.min(100, moneyIn / (moneyIn + moneyOut) * 100) : 50}%` }} /></div><div className="pulse-legend"><span>Income</span><span>Expenses</span></div></section>
    <section className="dashboard-panel upcoming-panel"><div className="panel-heading"><div><p className="eyebrow">NEXT IN ORBIT</p><h2>Upcoming</h2></div><button className="panel-link" type="button" onClick={() => onNavigate("plans")}>Manage Plans <CaretRight aria-hidden="true" /></button></div>{data.recurring.length ? data.recurring.slice(0, 3).map((item) => <div className="upcoming-row" key={item.id}><span className="upcoming-date"><strong>{new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(new Date(`${item.nextDueOn}T12:00:00`))}</strong><small>{new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(`${item.nextDueOn}T12:00:00`))}</small></span><div className="grow"><strong>{item.name}</strong><span>{item.kind} · projected</span></div><strong>{money(item.amount, item.currency)}</strong></div>) : <EmptyState icon={CalendarDots} title="Nothing Scheduled" body="Add a recurring bill, subscription, or income to see what is coming next." action="Create a Plan" onAction={() => onNavigate("plans")} />}</section>
  </div>;
}

function SignalCard({ icon: Icon, label, value, detail, tone }: { icon: typeof House; label: string; value: string; detail: string; tone: "positive" | "negative" | "future" }) { return <article className={`signal-card ${tone}`}><span className="signal-icon" aria-hidden="true"><Icon weight="bold" /></span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>; }
function EmptyState({ icon: Icon, title, body, action, onAction }: { icon: typeof House; title: string; body: string; action?: string; onAction?: () => void }) { return <div className="empty-state"><span aria-hidden="true"><Icon weight="duotone" /></span><div><strong>{title}</strong><p>{body}</p></div>{action && onAction && <button type="button" onClick={onAction}>{action}<CaretRight aria-hidden="true" /></button>}</div>; }
function TransactionLine({ transaction }: { transaction: DashboardData["transactions"][number] }) { return <div className="transaction-row"><div className="grow"><strong>{transaction.payee ?? transaction.category ?? transaction.kind}</strong><span>{transaction.occurredOn} · {transaction.category ?? "Uncategorized"} · {transaction.visibility}</span></div><strong className={transaction.kind === "income" ? "positive" : ""}>{transaction.kind === "income" ? "+" : "−"}{money(transaction.amount, transaction.currency)}</strong></div>; }

type PlansWorkspaceProps = {
  data: DashboardData;
  household: NonNullable<DashboardData["household"]>;
  pending: boolean;
  onCreateGoal: (event: FormEvent<HTMLFormElement>) => void;
  onAllocateGoal: (goalId: string, event: FormEvent<HTMLFormElement>) => void;
  onCreateDebt: (event: FormEvent<HTMLFormElement>) => void;
  onPayDebt: (debtId: string, visibility: "private" | "shared", event: FormEvent<HTMLFormElement>) => void;
  onCreateBudget: (event: FormEvent<HTMLFormElement>) => void;
  onCreateEnvelope: (budgetId: string, event: FormEvent<HTMLFormElement>) => void;
  onCreateRecurring: (event: FormEvent<HTMLFormElement>) => void;
  onConfirmRecurring: (item: DashboardData["recurring"][number]) => void;
};

function PlansWorkspace({ data, household, pending, onCreateGoal, onAllocateGoal, onCreateDebt, onPayDebt, onCreateBudget, onCreateEnvelope, onCreateRecurring, onConfirmRecurring }: PlansWorkspaceProps) {
  const today = data.asOf;
  const month = `${today.slice(0, 7)}-01`;
  const expenseCategories = data.categories.filter((category) => category.kind === "expense");
  return <section className="plans-page">
    <section className="wide-card"><div className="section-head"><div><p className="eyebrow">SAVINGS</p><h2>Goals and allocations</h2><p>Allocations reserve progress; they do not alter your account balance.</p></div></div>
      <form className="form-grid" onSubmit={onCreateGoal}><label>Name<input name="name" required maxLength={100} /></label><label>Target<input name="targetAmount" inputMode="decimal" required /></label><label>Currency<input name="currency" defaultValue={household.currency} maxLength={3} required /></label><label>Target date<input name="targetDate" type="date" /></label><label>Visibility<select name="visibility" defaultValue="shared"><option value="shared">Shared</option><option value="private">Private</option></select></label><button className="submit-button" disabled={pending}>Create goal</button></form>
      {data.goals.map((goal) => { const percent = goal.target ? Math.min(100, goal.current / goal.target * 100) : 0; return <article className="plan-operation" key={goal.id}><div className="goal-row"><div className="goal-top"><span>{goal.name}</span><strong>{Math.round(percent)}%</strong></div><div className="progress"><i style={{ width: `${percent}%` }} /></div><small>{money(goal.current, goal.currency)} of {money(goal.target, goal.currency)} {goal.targetDate ? `· target ${goal.targetDate}` : ""} · {goal.visibility}</small></div><form className="inline-operation" onSubmit={(event) => onAllocateGoal(goal.id, event)}><label>Allocate<input name="amount" required min="0.01" inputMode="decimal" placeholder="0.00" /></label><label>Date<input name="allocatedOn" type="date" defaultValue={today} required /></label><label className="grow">Note<input name="note" maxLength={500} placeholder="Optional allocation note" /></label><button className="text-button" disabled={pending}>Add allocation</button></form></article>; })}
    </section>
    <section className="wide-card"><div className="section-head"><div><p className="eyebrow">PAYDOWN</p><h2>Debts</h2><p>Payments post to the ledger and lower the recorded debt balance.</p></div></div>
      <form className="form-grid" onSubmit={onCreateDebt}><label>Creditor<input name="creditor" required maxLength={120} /></label><label>Balance<input name="balance" inputMode="decimal" required /></label><label>Currency<input name="currency" defaultValue={household.currency} maxLength={3} required /></label><label>APR %<input name="rate" inputMode="decimal" /></label><label>Minimum payment<input name="minimum" inputMode="decimal" /></label><label>Due day<input name="dueDay" type="number" min="1" max="31" /></label><label>Linked liability account<select name="accountId"><option value="">None</option>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Visibility<select name="visibility" defaultValue="shared"><option value="shared">Shared</option><option value="private">Private</option></select></label><button className="submit-button" disabled={pending}>Create debt</button></form>
      {data.debts.map((debt) => { const payoffMonths = debtPayoffMonths(debt.balance, debt.rate ?? 0, debt.minimum ?? 0); return <article className="plan-operation" key={debt.id}><div className="due-row"><div className="grow"><strong>{debt.creditor}</strong><span>{debt.rate ?? 0}% APR · min {money(debt.minimum ?? 0, debt.currency)}{debt.dueDay ? ` · due day ${debt.dueDay}` : ""}</span></div><strong>{money(debt.balance, debt.currency)}</strong></div><p className="payoff-note">{payoffMonths ? `At the current minimum, estimated payoff: ${payoffMonths} month${payoffMonths === 1 ? "" : "s"}.` : "The current minimum will not amortize this balance; increase the payment."}</p><form className="inline-operation" onSubmit={(event) => onPayDebt(debt.id, debt.visibility, event)}><label>Pay from<select name="accountId" required>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label><label>Payment<input name="amount" required min="0.01" max={debt.balance} inputMode="decimal" placeholder="0.00" /></label><label>Date<input name="paidOn" type="date" defaultValue={today} required /></label><label>Visibility<select name="visibility" defaultValue={debt.visibility} disabled={debt.visibility === "private"}><option value="shared">Shared</option><option value="private">Private</option></select></label><label className="grow">Note<input name="note" maxLength={500} placeholder="Optional payment note" /></label><button className="text-button" disabled={pending || !data.accounts.length}>Record payment</button></form></article>; })}
    </section>
    <section className="wide-card"><div className="section-head"><div><p className="eyebrow">SPENDING PLAN</p><h2>Budgets and envelopes</h2><p>Actual spending is derived from posted expenses in the same currency and month.</p></div></div>
      <form className="form-grid" onSubmit={onCreateBudget}><label>Category<select name="categoryId"><option value="">Overall</option>{expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Month<input name="month" type="date" defaultValue={month} required /></label><label>Limit<input name="amount" inputMode="decimal" required /></label><label>Envelope allocation<input name="envelope" inputMode="decimal" defaultValue="0" /></label><label>Currency<input name="currency" defaultValue={household.currency} maxLength={3} required /></label><label>Visibility<select name="visibility" defaultValue="shared"><option value="shared">Shared</option><option value="private">Private</option></select></label><button className="submit-button" disabled={pending}>Create budget</button></form>
      {data.budgets.map((budget) => { const usage = budget.amount ? Math.min(100, budget.spent / budget.amount * 100) : 0; return <article className="plan-operation" key={budget.id}><div className="goal-row"><div className="goal-top"><span>{budget.category ?? "Overall"} · {budget.month.slice(0, 7)}</span><strong>{money(budget.spent, budget.currency)} / {money(budget.amount, budget.currency)}</strong></div><div className="progress"><i style={{ width: `${usage}%` }} /></div><small>{Math.round(usage)}% used · envelope {money(budget.envelope, budget.currency)} · {budget.visibility}</small></div>{budget.envelopes.length > 0 && <div className="envelope-list">{budget.envelopes.map((envelope) => <span key={envelope.id}>{envelope.name}: {money(envelope.amount, budget.currency)}</span>)}</div>}<form className="inline-operation" onSubmit={(event) => onCreateEnvelope(budget.id, event)}><label className="grow">Envelope name<input name="name" required maxLength={80} placeholder="e.g. groceries" /></label><label>Allocation<input name="amount" required min="0" inputMode="decimal" defaultValue="0" /></label><button className="text-button" disabled={pending}>Add envelope</button></form></article>; })}
    </section>
    <section className="wide-card"><div className="section-head"><div><p className="eyebrow">CASH FLOW</p><h2>Recurring bills and subscriptions</h2><p>Projected items do not affect balances until you explicitly confirm them.</p></div></div>
      <form className="form-grid" onSubmit={onCreateRecurring}><label>Name<input name="name" required maxLength={120} /></label><label>Type<select name="ruleKind" defaultValue="bill"><option value="bill">Bill</option><option value="subscription">Subscription</option><option value="income">Income</option></select></label><label>Account<select name="accountId" required>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Category<select name="categoryId"><option value="">Uncategorized</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.kind}: {category.name}</option>)}</select></label><label>Amount<input name="amount" inputMode="decimal" required /></label><label>Currency<input name="currency" defaultValue={household.currency} maxLength={3} required /></label><label>Cadence<select name="cadence" defaultValue="monthly"><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label><label>First due date<input name="nextDueOn" type="date" required /></label><label>Visibility<select name="visibility" defaultValue="shared"><option value="shared">Shared</option><option value="private">Private</option></select></label><button className="submit-button" disabled={pending || !data.accounts.length}>Create recurring rule</button></form>
      {data.recurring.map((item) => <div className="due-row recurring-operation" key={item.id}><div className="grow"><strong>{item.name}</strong><span>{item.kind} · {money(item.amount, item.currency)} · due {item.nextDueOn} · projected</span></div><button type="button" className="text-button" disabled={pending} onClick={() => onConfirmRecurring(item)}>Confirm paid today</button></div>)}
    </section>
  </section>;
}
