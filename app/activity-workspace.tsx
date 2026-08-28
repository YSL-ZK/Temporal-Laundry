"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Funnel, MagnifyingGlass, Plus, Storefront, Tag as TagIcon, X } from "@phosphor-icons/react";
import type { DashboardData } from "../lib/dashboard";
import { localeFor, translate, type AppLanguage } from "../lib/i18n";
import { createPayee, createTag, postTransaction, searchTransactions } from "./actions/finance";
import { SelectField } from "./select-field";

type ActivityWorkspaceProps = { data: DashboardData; language: AppLanguage };

const optional = (form: FormData, key: string) => String(form.get(key) ?? "").trim() || undefined;
const COMMON_CURRENCIES = ["COP", "USD", "EUR", "GBP", "CAD", "MXN", "BRL", "ARS", "CLP", "PEN", "JPY", "CNY", "AUD", "CHF"];

export function ActivityWorkspace({ data, language }: ActivityWorkspaceProps) {
  const household = data.household;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState(data.transactions);
  const [message, setMessage] = useState("");
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? "");
  const [transactionCurrency, setTransactionCurrency] = useState(data.accounts[0]?.currency ?? data.household?.currency ?? "USD");
  const t = (copy: string) => translate(language, copy);

  if (!household) return null;
  const activeHousehold = household;
  const accountOptions = data.accounts.map((account) => ({ value: account.id, label: account.name, meta: `${account.kind} · ${account.currency}` }));
  const currencyNames = new Intl.DisplayNames(localeFor(language), { type: "currency" });
  const currencyOptions = [...new Set([activeHousehold.currency, ...data.accounts.map((account) => account.currency), ...COMMON_CURRENCIES])].map((code) => ({ value: code, label: code, meta: currencyNames.of(code) ?? code }));
  const categoryOptions = [
    { value: "", label: t("No category"), group: t("Unassigned") },
    ...data.categories.map((category) => ({ value: category.id, label: category.name, group: t(category.kind === "expense" ? "Expense categories" : "Income categories") })),
  ];
  const visibilityOptions = [{ value: "shared", label: t("Shared"), meta: t("Visible to household members") }, { value: "private", label: t("Private"), meta: t("Visible only to you") }];

  function run(action: () => Promise<{ error?: string }>, success: string, form?: HTMLFormElement) {
    setMessage("");
    startTransition(async () => {
      const result = await action();
      if (result.error) return setMessage(result.error);
      form?.reset();
      setMessage(t(success));
      router.refresh();
    });
  }

  function submitTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const kind = String(fields.get("kind"));
    run(() => postTransaction({
      householdId: activeHousehold.id,
      accountId: fields.get("accountId"),
      transferAccountId: kind === "transfer" ? optional(fields, "transferAccountId") : undefined,
      categoryId: optional(fields, "categoryId"),
      payeeId: optional(fields, "payeeId"),
      tagIds: fields.getAll("tagIds").map(String),
      kind, amount: fields.get("amount"), currency: fields.get("currency"),
      reportingExchangeRate: fields.get("rate"), occurredOn: fields.get("occurredOn"),
      note: optional(fields, "note"), visibility: fields.get("visibility"), items: [],
    }), "Transaction posted.", form);
  }

  function submitPayee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    run(() => createPayee({ householdId: activeHousehold.id, name: fields.get("name") }), "Payee created.", form);
  }

  function submitTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    run(() => createTag({ householdId: activeHousehold.id, name: fields.get("name"), color: fields.get("color") }), "Tag created.", form);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setMessage("");
    startTransition(async () => {
      const result = await searchTransactions({
        householdId: activeHousehold.id,
        query: optional(fields, "query"), kind: optional(fields, "kind"), accountId: optional(fields, "accountId"),
        categoryId: optional(fields, "categoryId"), payeeId: optional(fields, "payeeId"), tagId: optional(fields, "tagId"),
        visibility: optional(fields, "visibility"), status: optional(fields, "status"), dateFrom: optional(fields, "dateFrom"),
        dateTo: optional(fields, "dateTo"), minAmount: optional(fields, "minAmount"), maxAmount: optional(fields, "maxAmount"),
      });
      if (result.error) return setMessage(result.error);
      setResults(result.data ?? []);
      setMessage(`${result.data?.length ?? 0} ${t("movements found")}`);
    });
  }

  return <section className="activity-workspace">
    <section className="wide-card activity-entry" id="transaction-form">
      <div className="section-head"><div><p className="eyebrow">{t("NEW LEDGER ENTRY")}</p><h2>{t("Post ledger transaction")}</h2><p>{t("Record the movement once, then organize it with a payee and reusable tags.")}</p></div><span className="entry-orbit" aria-hidden="true"><Plus weight="bold" /></span></div>
      <form className="form-grid" onSubmit={submitTransaction}>
        <SelectField name="kind" label={t("Type")} closeLabel={t("Close")} defaultValue="expense" sheetTitle={t("Choose the movement type")} options={[{ value: "expense", label: t("Expense"), meta: t("Money leaving an account") }, { value: "income", label: t("Income"), meta: t("Money entering an account") }, { value: "transfer", label: t("Transfer"), meta: t("Move money between accounts") }, { value: "adjustment", label: t("Adjustment"), meta: t("Correct an account balance") }]} />
        <SelectField name="accountId" label={t("Account")} closeLabel={t("Close")} value={accountId} onValueChange={(nextAccountId) => { setAccountId(nextAccountId); const account = data.accounts.find((item) => item.id === nextAccountId); if (account) setTransactionCurrency(account.currency); }} sheetTitle={t("Choose the source account")} options={accountOptions} required disabled={!data.accounts.length} />
        <SelectField name="transferAccountId" label={t("Transfer destination")} closeLabel={t("Close")} sheetTitle={t("Choose the destination account")} options={[{ value: "", label: t("Not a transfer") }, ...accountOptions]} />
        <SelectField name="categoryId" label={t("Category")} closeLabel={t("Close")} sheetTitle={t("Choose a category")} options={categoryOptions} />
        <label>{t("Amount")}<input name="amount" required inputMode="decimal" /></label>
        <SelectField name="currency" label={t("Currency")} closeLabel={t("Close")} value={transactionCurrency} onValueChange={setTransactionCurrency} sheetTitle={t("Choose the transaction currency")} options={currencyOptions} required />
        <label>{t("Exchange rate to")} {activeHousehold.currency}<input name="rate" defaultValue="1" inputMode="decimal" required aria-describedby="fx-rate-help" /><small className="field-help" id="fx-rate-help">{t("How many units of your reporting currency equal one unit of this transaction currency. Leave it at 1 when both currencies match.")}</small></label>
        <label>{t("Date")}<input name="occurredOn" defaultValue={data.asOf} type="date" required /></label>
        <SelectField name="payeeId" label={t("Payee")} closeLabel={t("Close")} sheetTitle={t("Choose a payee")} options={[{ value: "", label: t("No payee") }, ...data.payees.map((payee) => ({ value: payee.id, label: payee.name }))]} />
        <label className="grow">{t("Note")}<input name="note" maxLength={2000} /></label>
        <SelectField name="visibility" label={t("Visibility")} closeLabel={t("Close")} defaultValue="shared" sheetTitle={t("Choose who can see it")} options={visibilityOptions} />
        {data.tags.length > 0 && <fieldset className="tag-picker full"><legend>{t("Tags")}</legend><div>{data.tags.map((tag) => <label className="tag-choice" key={tag.id}><input type="checkbox" name="tagIds" value={tag.id} /><i style={{ backgroundColor: tag.color }} aria-hidden="true" />{tag.name}</label>)}</div></fieldset>}
        <button className="submit-button" disabled={pending || !data.accounts.length}>{pending ? t("Posting…") : t("Post transaction")}</button>
      </form>
    </section>

    <section className="wide-card ledger-organizer">
      <div className="section-head"><div><p className="eyebrow">{t("LEDGER ORGANIZER")}</p><h2>{t("Payees and tags")}</h2><p>{t("Create reusable labels once, then apply them to any movement.")}</p></div></div>
      <div className="organizer-grid">
        <form onSubmit={submitPayee}><span aria-hidden="true"><Storefront weight="duotone" /></span><label>{t("New payee")}<input name="name" required maxLength={120} placeholder={t("e.g. Corner market")} /></label><button className="text-button" disabled={pending}>{t("Add payee")}</button></form>
        <form onSubmit={submitTag}><span aria-hidden="true"><TagIcon weight="duotone" /></span><label>{t("New tag")}<input name="name" required maxLength={40} placeholder={t("e.g. reimbursable")} /></label><label className="color-field">{t("Color")}<input name="color" type="color" defaultValue="#7dd3a7" aria-label={t("Tag color")} /></label><button className="text-button" disabled={pending}>{t("Add tag")}</button></form>
      </div>
    </section>

    <section className="wide-card ledger-lens">
      <div className="section-head"><div><p className="eyebrow">{t("LEDGER LENS")}</p><h2>{t("Search and filter")}</h2><p>{t("Narrow the posted history without changing the ledger itself.")}</p></div><Funnel weight="duotone" aria-hidden="true" /></div>
      <form onSubmit={submitSearch}>
        <label className="search-control"><span className="sr-only">{t("Search ledger")}</span><MagnifyingGlass aria-hidden="true" /><input name="query" maxLength={80} placeholder={t("Search payees, notes, accounts, categories, or tags")} /></label>
        <div className="ledger-filter-grid">
          <label>{t("Type")}<select name="kind"><option value="">{t("All types")}</option><option value="expense">{t("Expense")}</option><option value="income">{t("Income")}</option><option value="transfer">{t("Transfer")}</option><option value="adjustment">{t("Adjustment")}</option></select></label>
          <label>{t("Account")}<select name="accountId"><option value="">{t("All accounts")}</option>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label>{t("Category")}<select name="categoryId"><option value="">{t("All categories")}</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label>{t("Payee")}<select name="payeeId"><option value="">{t("All payees")}</option>{data.payees.map((payee) => <option key={payee.id} value={payee.id}>{payee.name}</option>)}</select></label>
          <label>{t("Tag")}<select name="tagId"><option value="">{t("All tags")}</option>{data.tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
          <label>{t("Visibility")}<select name="visibility"><option value="">{t("Any visibility")}</option><option value="shared">{t("Shared")}</option><option value="private">{t("Private")}</option></select></label>
          <label>{t("Status")}<select name="status"><option value="">{t("Any status")}</option><option value="posted">{t("Posted")}</option><option value="projected">{t("Projected")}</option></select></label>
          <label>{t("From")}<input name="dateFrom" type="date" /></label><label>{t("To")}<input name="dateTo" type="date" /></label>
          <label>{t("Minimum")}<input name="minAmount" inputMode="decimal" /></label><label>{t("Maximum")}<input name="maxAmount" inputMode="decimal" /></label>
        </div>
        <div className="filter-actions"><button className="submit-button" disabled={pending}>{t("Apply filters")}</button><button type="reset" className="text-button" onClick={() => { setResults(data.transactions); setMessage(""); }}><X aria-hidden="true" />{t("Clear")}</button></div>
      </form>
      {message && <p className="form-message" role="status">{message}</p>}
      <div className="ledger-results" aria-live="polite">
        {results.length ? results.map((transaction) => <article className="ledger-result" key={transaction.id}><div className="transaction-mark" data-kind={transaction.kind} aria-hidden="true" /><div className="grow"><strong>{transaction.payee ?? transaction.category ?? t(transaction.kind)}</strong><span>{new Intl.DateTimeFormat(localeFor(language), { dateStyle: "medium" }).format(new Date(`${transaction.occurredOn}T12:00:00`))} · {transaction.account ?? t("Account")} · {transaction.category ?? t("Uncategorized")}</span>{transaction.tags.length > 0 && <div className="transaction-tags">{transaction.tags.map((tag) => <span key={tag.id}><i style={{ backgroundColor: tag.color }} aria-hidden="true" />{tag.name}</span>)}</div>}</div><div className="result-amount"><strong className={transaction.kind === "income" ? "positive" : ""}>{transaction.kind === "income" ? "+" : "−"}{new Intl.NumberFormat(localeFor(language), { style: "currency", currency: transaction.currency, maximumFractionDigits: 0 }).format(transaction.amount)}</strong><small>{t(transaction.status)} · {t(transaction.visibility)}</small></div></article>) : <div className="empty-ledger"><MagnifyingGlass weight="duotone" aria-hidden="true" /><strong>{t("No movements match these filters.")}</strong><p>{t("Clear a filter or widen the date and amount range.")}</p></div>}
      </div>
    </section>
  </section>;
}
