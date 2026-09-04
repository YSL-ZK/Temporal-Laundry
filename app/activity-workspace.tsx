"use client";

import { FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle, DownloadSimple, Eye, FileText, Funnel, LockKey, MagnifyingGlass, NotePencil, Plus, Receipt, Storefront, Tag as TagIcon, Trash, X } from "@phosphor-icons/react";
import type { DashboardData } from "../lib/dashboard";
import { localeFor, translate, type AppLanguage } from "../lib/i18n";
import { correctTransaction, createPayee, createTag, deleteReceipt, deleteTransactionDraft, postTransaction, postTransactionDraft, reverseTransaction, saveTransactionDraft, searchTransactions, uploadReceipt } from "./actions/finance";
import { formatFileSize } from "../lib/receipts";
import { SelectField } from "./select-field";
import { CategoryWorkflowWorkspace, WorkflowRecordDetails } from "./category-workflows";
import { TemplateRecordDetails, TemplateWorkflowWorkspace } from "./template-workflows";

type ActivityWorkspaceProps = { data: DashboardData; language: AppLanguage };
type TransactionKind = "income" | "expense" | "transfer" | "adjustment";

const optional = (form: FormData, key: string) => String(form.get(key) ?? "").trim() || undefined;

export function ActivityWorkspace({ data, language }: ActivityWorkspaceProps) {
  const household = data.household;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState(data.transactions);
  const [message, setMessage] = useState("");
  const [transactionKind, setTransactionKind] = useState<TransactionKind>("expense");
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? "");
  const [transactionCurrency, setTransactionCurrency] = useState(data.accounts[0]?.currency ?? data.household?.currency ?? "USD");
  const [transactionVisibility, setTransactionVisibility] = useState<"private" | "shared">(data.accounts[0]?.visibility ?? "shared");
  const [transferAccountId, setTransferAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [editingDraft, setEditingDraft] = useState<DashboardData["drafts"][number] | null>(null);
  const [draftToDelete, setDraftToDelete] = useState<string | null>(null);
  const [receiptToRemove, setReceiptToRemove] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<DashboardData["transactions"][number] | null>(null);
  const t = (copy: string) => translate(language, copy);

  if (!household) return null;
  const activeHousehold = household;
  const accountOptions = data.accounts.map((account) => ({ value: account.id, label: account.name, meta: `${account.kind} · ${account.currency}` }));
  const transferAccountOptions = [{ value: "", label: t("Not a transfer") }, ...data.accounts.filter((account) => account.id !== accountId && account.currency === transactionCurrency && (transactionVisibility === "private" || account.visibility === "shared")).map((account) => ({ value: account.id, label: account.name, meta: `${account.kind} · ${account.currency}` }))];
  const availableCategories = transactionKind === "adjustment" ? data.categories : data.categories.filter((category) => category.kind === transactionKind);
  const categoryOptions = [
    { value: "", label: t("No category"), group: t("Unassigned") },
    ...availableCategories.map((category) => ({ value: category.id, label: category.name, group: t(category.kind === "expense" ? "Expense categories" : "Income categories") })),
  ];
  const sourceAccount = data.accounts.find((account) => account.id === accountId);
  const visibilityOptions = sourceAccount?.visibility === "private"
    ? [{ value: "private", label: t("Private"), meta: t("Required for a private account") }]
    : [{ value: "shared", label: t("Shared"), meta: t("Visible to household members") }, { value: "private", label: t("Private"), meta: t("Visible only to you") }];
  const allCategoryOptions = [{ value: "", label: t("All categories") }, ...data.categories.map((category) => ({ value: category.id, label: category.name, meta: t(category.kind) }))];
  const allPayeeOptions = [{ value: "", label: t("All payees") }, ...data.payees.map((payee) => ({ value: payee.id, label: payee.name }))];
  const allTagOptions = [{ value: "", label: t("All tags") }, ...data.tags.map((tag) => ({ value: tag.id, label: tag.name }))];

  function run(action: () => Promise<{ error?: string }>, success: string, form?: HTMLFormElement) {
    setMessage("");
    startTransition(async () => {
      const result = await action();
      if (result.error) return setMessage(t(result.error));
      form?.reset();
      setMessage(t(success));
      router.refresh();
    });
  }

  function resetEntryEditor(form?: HTMLFormElement) {
    const firstAccount = data.accounts[0];
    form?.reset();
    setEditingDraft(null);
    setTransactionKind("expense");
    setAccountId(firstAccount?.id ?? "");
    setTransactionCurrency(firstAccount?.currency ?? activeHousehold.currency);
    setTransactionVisibility(firstAccount?.visibility ?? "shared");
    setTransferAccountId("");
    setCategoryId("");
  }

  function entryPayload(fields: FormData) {
    const kind = String(fields.get("kind"));
    return {
      householdId: activeHousehold.id,
      accountId: fields.get("accountId"),
      transferAccountId: kind === "transfer" ? optional(fields, "transferAccountId") : undefined,
      categoryId: optional(fields, "categoryId"), payeeId: optional(fields, "payeeId"),
      tagIds: fields.getAll("tagIds").map(String), kind, amount: fields.get("amount"),
      currency: fields.get("currency"), occurredOn: fields.get("occurredOn"),
      note: optional(fields, "note"), visibility: fields.get("visibility"),
    };
  }

  function submitTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = editingDraft ? "draft" : submitter?.value ?? "post";
    const receipt = fields.get("receipt");
    setMessage("");
    startTransition(async () => {
      if (intent === "draft") {
        const draftResult = await saveTransactionDraft({ ...entryPayload(fields), draftId: editingDraft?.id });
        if (draftResult.error || !draftResult.data) return setMessage(t(draftResult.error ?? "We couldn't complete that request. Please try again."));
        resetEntryEditor(form);
        setMessage(t(editingDraft ? "Draft updated." : "Draft saved."));
        router.refresh();
        return;
      }
      const result = await postTransaction({ ...entryPayload(fields), items: [] });
      if (result.error || !result.data) return setMessage(t(result.error ?? "We couldn't complete that request. Please try again."));
      if (receipt instanceof File && receipt.size > 0) {
        const receiptForm = new FormData();
        receiptForm.set("transactionId", result.data.id);
        receiptForm.set("file", receipt);
        const receiptResult = await uploadReceipt(receiptForm);
        if (receiptResult.error) {
          setMessage(t("Transaction posted, but the receipt could not be saved."));
          router.refresh();
          return;
        }
      }
      resetEntryEditor(form);
      setMessage(t("Transaction posted."));
      router.refresh();
    });
  }

  function editDraft(draft: DashboardData["drafts"][number]) {
    setEditingDraft(draft);
    setTransactionKind(draft.kind);
    setAccountId(draft.accountId);
    setTransactionCurrency(draft.currency);
    setTransactionVisibility(draft.visibility);
    setTransferAccountId(draft.transferAccountId ?? "");
    setCategoryId(draft.categoryId ?? "");
    window.requestAnimationFrame(() => document.getElementById("transaction-form")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function publishDraft(draftId: string) {
    setMessage("");
    startTransition(async () => {
      const result = await postTransactionDraft({ draftId });
      if (result.error) return setMessage(t(result.error));
      setMessage(t("Draft posted."));
      router.refresh();
    });
  }

  function removeDraft(draftId: string) {
    setMessage("");
    startTransition(async () => {
      const result = await deleteTransactionDraft({ draftId });
      if (result.error) return setMessage(t(result.error));
      if (editingDraft?.id === draftId) resetEntryEditor();
      setDraftToDelete(null);
      setMessage(t("Draft deleted."));
      router.refresh();
    });
  }

  function removeReceipt(receiptId: string) {
    setMessage("");
    startTransition(async () => {
      const result = await deleteReceipt({ receiptId });
      if (result.error) return setMessage(t(result.error));
      setReceiptToRemove(null);
      setMessage(t("Receipt removed."));
      router.refresh();
    });
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
      <div className="section-head"><div><p className="eyebrow">{t(editingDraft ? "EDITING PRIVATE DRAFT" : "NEW LEDGER ENTRY")}</p><h2>{t(editingDraft ? "Review your draft" : "Post ledger transaction")}</h2><p>{t(editingDraft ? "Changes stay outside account balances until you publish this draft." : "Record the movement once, then organize it with a payee and reusable tags.")}</p></div><span className="entry-orbit" aria-hidden="true">{editingDraft ? <NotePencil weight="duotone" /> : <Plus weight="bold" />}</span></div>
      <form className="form-grid" key={editingDraft?.id ?? "new-transaction"} onSubmit={submitTransaction}>
        <SelectField name="kind" label={t("Type")} closeLabel={t("Close")} value={transactionKind} onValueChange={(nextKind) => { setTransactionKind(nextKind as TransactionKind); setCategoryId(""); if (nextKind !== "transfer") setTransferAccountId(""); }} sheetTitle={t("Choose the movement type")} options={[{ value: "expense", label: t("Expense"), meta: t("Money leaving an account") }, { value: "income", label: t("Income"), meta: t("Money entering an account") }, { value: "transfer", label: t("Transfer"), meta: t("Move money between accounts") }, { value: "adjustment", label: t("Adjustment"), meta: t("Correct an account balance") }]} />
        <SelectField name="accountId" label={t("Account")} closeLabel={t("Close")} value={accountId} onValueChange={(nextAccountId) => { setAccountId(nextAccountId); setTransferAccountId(""); const account = data.accounts.find((item) => item.id === nextAccountId); if (account) { setTransactionCurrency(account.currency); setTransactionVisibility(account.visibility); } }} sheetTitle={t("Choose the source account")} options={accountOptions} required disabled={!data.accounts.length} />
        <SelectField name="transferAccountId" label={t("Transfer destination")} closeLabel={t("Close")} value={transferAccountId} onValueChange={setTransferAccountId} sheetTitle={t("Choose the destination account")} options={transferAccountOptions} />
        <SelectField name="categoryId" label={t("Category")} closeLabel={t("Close")} value={categoryId} onValueChange={setCategoryId} sheetTitle={transactionKind === "transfer" ? t("Transfers do not use categories") : t("Choose a category")} options={categoryOptions} disabled={transactionKind === "transfer"} />
        <label>{t("Amount")}<input name="amount" defaultValue={editingDraft?.amount} type="number" min="0.01" step="any" required inputMode="decimal" /></label>
        <div className="read-only-field"><span>{t("Currency")}</span><input type="hidden" name="currency" value={transactionCurrency} /><strong>{transactionCurrency}</strong><small>{t("Set by the selected account. Laundry applies the stored daily exchange rate automatically.")}</small></div>
        <label>{t("Date")}<input name="occurredOn" defaultValue={editingDraft?.occurredOn ?? data.asOf} type="date" required /></label>
        <SelectField name="payeeId" label={t("Payee")} closeLabel={t("Close")} defaultValue={editingDraft?.payeeId ?? ""} sheetTitle={t("Choose a payee")} options={[{ value: "", label: t("No payee") }, ...data.payees.map((payee) => ({ value: payee.id, label: payee.name }))]} />
        <label className="grow">{t("Note")}<input name="note" defaultValue={editingDraft?.note ?? ""} maxLength={2000} /></label>
        <SelectField name="visibility" label={t("Visibility")} closeLabel={t("Close")} value={transactionVisibility} onValueChange={(visibility) => { setTransactionVisibility(visibility as "private" | "shared"); setTransferAccountId(""); }} sheetTitle={t("Choose who can see it")} options={visibilityOptions} />
        {data.tags.length > 0 && <fieldset className="tag-picker full"><legend>{t("Tags")}</legend><div>{data.tags.map((tag) => <label className="tag-choice" key={tag.id}><input type="checkbox" name="tagIds" value={tag.id} defaultChecked={editingDraft?.tagIds.includes(tag.id)} /><i style={{ backgroundColor: tag.color }} aria-hidden="true" />{tag.name}</label>)}</div></fieldset>}
        {!editingDraft && <label className="full receipt-upload-field">{t("Receipt (optional)")}<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /><small>{t("JPG, PNG, WebP, or PDF up to 10 MB. Laundry verifies the file contents before saving it.")}</small></label>}
        <div className="entry-actions full">{editingDraft ? <><button className="submit-button" name="intent" value="draft" disabled={pending || !data.accounts.length}>{pending ? t("Saving…") : t("Save draft changes")}</button><button className="text-button" type="button" onClick={() => resetEntryEditor()} disabled={pending}>{t("Cancel editing")}</button></> : <><button className="submit-button" name="intent" value="post" disabled={pending || !data.accounts.length}>{pending ? t("Posting…") : t("Post transaction")}</button><button className="draft-button" name="intent" value="draft" disabled={pending || !data.accounts.length}><FileText aria-hidden="true" />{t("Save as draft")}</button></>}</div>
      </form>
    </section>

    <CategoryWorkflowWorkspace data={data} language={language} />
    <TemplateWorkflowWorkspace data={data} language={language} />

    <section className="wide-card draft-vault">
      <div className="section-head"><div><p className="eyebrow">{t("PRIVATE DRAFTS")}</p><h2>{t("Finish it when you are ready")}</h2><p>{t("Drafts are visible only to you and never affect balances until they are published.")}</p></div><span className="draft-count">{data.drafts.length}</span></div>
      {data.drafts.length ? <div className="draft-list">{data.drafts.map((draft) => <article className="draft-row" key={draft.id}><span className="draft-mark" data-kind={draft.kind} aria-hidden="true"><FileText weight="duotone" /></span><div className="grow"><strong>{draft.payee ?? draft.category ?? t(draft.kind)}</strong><span>{draft.account}{draft.transferAccount ? ` → ${draft.transferAccount}` : ""} · {new Intl.DateTimeFormat(localeFor(language), { dateStyle: "medium" }).format(new Date(`${draft.occurredOn}T12:00:00`))}</span><small>{t(draft.visibility)} · {t("Updated")} {new Intl.DateTimeFormat(localeFor(language), { dateStyle: "short", timeStyle: "short" }).format(new Date(draft.updatedAt))}</small></div><strong className="draft-amount">{new Intl.NumberFormat(localeFor(language), { style: "currency", currency: draft.currency }).format(draft.amount)}</strong><div className="draft-actions"><button className="text-button" type="button" onClick={() => editDraft(draft)} disabled={pending}><NotePencil aria-hidden="true" />{t("Edit")}</button><button className="submit-button" type="button" onClick={() => publishDraft(draft.id)} disabled={pending}>{t("Post now")}</button><button className="danger-text-button" type="button" onClick={() => setDraftToDelete(draft.id)} disabled={pending}><Trash aria-hidden="true" />{t("Delete")}</button></div>{draftToDelete === draft.id && <div className="draft-delete-confirm" role="alert"><span>{t("Delete this private draft?")}</span><div><button className="danger-button" type="button" onClick={() => removeDraft(draft.id)} disabled={pending}>{t("Delete draft")}</button><button className="text-button" type="button" onClick={() => setDraftToDelete(null)}>{t("Cancel")}</button></div></div>}</article>)}</div> : <div className="empty-ledger draft-empty"><FileText weight="duotone" aria-hidden="true" /><strong>{t("No private drafts")}</strong><p>{t("Use Save as draft when a movement still needs review.")}</p></div>}
    </section>

    <section className="wide-card ledger-organizer">
      <div className="section-head"><div><p className="eyebrow">{t("LEDGER ORGANIZER")}</p><h2>{t("Payees and tags")}</h2><p>{t("Create reusable labels once, then apply them to any movement.")}</p></div></div>
      <div className="organizer-grid">
        <form onSubmit={submitPayee}><span aria-hidden="true"><Storefront weight="duotone" /></span><label>{t("New payee")}<input name="name" required maxLength={120} placeholder={t("e.g. Corner market")} /></label><button className="text-button" disabled={pending}>{t("Add payee")}</button></form>
        <form onSubmit={submitTag}><span aria-hidden="true"><TagIcon weight="duotone" /></span><label>{t("New tag")}<input name="name" required maxLength={40} placeholder={t("e.g. reimbursable")} /></label><label className="color-field">{t("Color")}<input name="color" type="color" defaultValue="#7dd3a7" aria-label={t("Tag color")} /></label><button className="text-button" disabled={pending}>{t("Add tag")}</button></form>
      </div>
    </section>

    <section className="wide-card receipt-vault" id="receipt-vault">
      <div className="section-head"><div><p className="eyebrow">{t("RECEIPT VAULT")}</p><h2>{t("Receipts")}</h2><p>{t("Download the documents attached to movements you can access. Only the uploader can remove a receipt.")}</p></div><span className="receipt-vault-mark" aria-hidden="true"><Receipt weight="duotone" /></span></div>
      {data.receipts.length ? <div className="receipt-list">{data.receipts.map((receipt) => <article className="receipt-row" key={receipt.id}>
        <span className="receipt-file-mark" aria-hidden="true"><Receipt weight="duotone" /></span>
        <div className="grow"><strong>{receipt.filename}</strong><span>{receipt.payee ?? receipt.category ?? t("Movement")} · {receipt.account ?? t("Account")}</span><small>{new Intl.DateTimeFormat(localeFor(language), { dateStyle: "medium" }).format(new Date(`${receipt.occurredOn}T12:00:00`))} · {formatFileSize(receipt.sizeBytes, localeFor(language))} · {t(receipt.visibility)}</small></div>
        <strong className="receipt-amount">{new Intl.NumberFormat(localeFor(language), { style: "currency", currency: receipt.currency }).format(receipt.amount)}</strong>
        <div className="receipt-actions"><a className="text-button" href={`/api/receipts/${receipt.id}`}><DownloadSimple aria-hidden="true" />{t("Download")}</a>{receipt.ownedByUser && <button className="danger-text-button" type="button" onClick={() => setReceiptToRemove(receipt.id)} disabled={pending}><Trash aria-hidden="true" />{t("Remove")}</button>}</div>
        {receiptToRemove === receipt.id && <div className="receipt-delete-confirm" role="alert"><div><strong>{t("Remove this receipt?")}</strong><p>{t("The file will be deleted from private storage. The movement and audit history will remain.")}</p></div><div><button className="danger-button" type="button" onClick={() => removeReceipt(receipt.id)} disabled={pending}>{t("Delete file")}</button><button className="text-button" type="button" onClick={() => setReceiptToRemove(null)}>{t("Cancel")}</button></div></div>}
      </article>)}</div> : <div className="empty-ledger"><Receipt weight="duotone" aria-hidden="true" /><strong>{t("No receipts yet")}</strong><p>{t("Attach one while posting a movement or checking out a shopping list.")}</p></div>}
    </section>

    <section className="wide-card ledger-lens">
      <div className="section-head"><div><p className="eyebrow">{t("LEDGER LENS")}</p><h2>{t("Search and filter")}</h2><p>{t("Narrow the posted history without changing the ledger itself.")}</p></div><Funnel weight="duotone" aria-hidden="true" /></div>
      <form onSubmit={submitSearch}>
        <label className="search-control"><span className="sr-only">{t("Search ledger")}</span><MagnifyingGlass aria-hidden="true" /><input name="query" maxLength={80} placeholder={t("Search payees, notes, accounts, categories, or tags")} /></label>
        <div className="ledger-filter-grid">
          <SelectField name="kind" label={t("Type")} closeLabel={t("Close")} sheetTitle={t("Filter by movement type")} options={[{ value: "", label: t("All types") }, { value: "expense", label: t("Expense") }, { value: "income", label: t("Income") }, { value: "transfer", label: t("Transfer") }, { value: "adjustment", label: t("Adjustment") }]} />
          <SelectField name="accountId" label={t("Account")} closeLabel={t("Close")} sheetTitle={t("Filter by account")} options={[{ value: "", label: t("All accounts") }, ...accountOptions]} />
          <SelectField name="categoryId" label={t("Category")} closeLabel={t("Close")} sheetTitle={t("Filter by category")} options={allCategoryOptions} />
          <SelectField name="payeeId" label={t("Payee")} closeLabel={t("Close")} sheetTitle={t("Filter by payee")} options={allPayeeOptions} />
          <SelectField name="tagId" label={t("Tag")} closeLabel={t("Close")} sheetTitle={t("Filter by tag")} options={allTagOptions} />
          <SelectField name="visibility" label={t("Visibility")} closeLabel={t("Close")} sheetTitle={t("Filter by visibility")} options={[{ value: "", label: t("Any visibility") }, ...visibilityOptions]} />
          <SelectField name="status" label={t("Status")} closeLabel={t("Close")} sheetTitle={t("Filter by status")} options={[{ value: "", label: t("Any status") }, { value: "posted", label: t("Posted") }, { value: "projected", label: t("Projected") }]} />
          <label>{t("From")}<input name="dateFrom" type="date" /></label><label>{t("To")}<input name="dateTo" type="date" /></label>
          <label>{t("Minimum")}<input name="minAmount" inputMode="decimal" /></label><label>{t("Maximum")}<input name="maxAmount" inputMode="decimal" /></label>
        </div>
        <div className="filter-actions"><button className="submit-button" disabled={pending}>{t("Apply filters")}</button><button type="reset" className="text-button" onClick={() => { setResults(data.transactions); setMessage(""); }}><X aria-hidden="true" />{t("Clear")}</button></div>
      </form>
      {message && <p className="form-message" role="status">{message}</p>}
      <div className="ledger-results" aria-live="polite">
        {results.length ? results.map((transaction) => <article className="ledger-result" key={transaction.id}><div className="transaction-mark" data-kind={transaction.kind} aria-hidden="true" /><div className="grow"><strong>{transaction.payee ?? transaction.category ?? t(transaction.kind)}</strong><span>{new Intl.DateTimeFormat(localeFor(language), { dateStyle: "medium" }).format(new Date(`${transaction.occurredOn}T12:00:00`))} · {transaction.account ?? t("Account")} · {transaction.category ?? t("Uncategorized")}</span>{transaction.tags.length > 0 && <div className="transaction-tags">{transaction.tags.map((tag) => <span key={tag.id}><i style={{ backgroundColor: tag.color }} aria-hidden="true" />{tag.name}</span>)}</div>}</div><div className="result-amount"><strong className={transaction.kind === "income" ? "positive" : ""}>{transaction.kind === "income" ? "+" : transaction.kind === "expense" ? "−" : ""}{new Intl.NumberFormat(localeFor(language), { style: "currency", currency: transaction.currency, maximumFractionDigits: 0 }).format(transaction.amount)}</strong><small>{t(transaction.status)} · {t(transaction.visibility)}</small></div><button className="ledger-detail-button" type="button" onClick={() => setSelectedTransaction(transaction)} aria-label={`${t("Open movement details")}: ${transaction.payee ?? transaction.category ?? t(transaction.kind)}`}><Eye aria-hidden="true" /><span>{t("Details")}</span></button></article>) : <div className="empty-ledger"><MagnifyingGlass weight="duotone" aria-hidden="true" /><strong>{t("No movements match these filters.")}</strong><p>{t("Clear a filter or widen the date and amount range.")}</p></div>}
      </div>
    </section>
    {selectedTransaction && <TransactionDetailDialog transaction={selectedTransaction} receipts={data.receipts.filter((receipt) => receipt.transactionId === selectedTransaction.id)} data={data} householdId={activeHousehold.id} reportingCurrency={activeHousehold.currency} language={language} onClose={() => setSelectedTransaction(null)} />}
  </section>;
}

function TransactionDetailDialog({ transaction, receipts, data, householdId, reportingCurrency, language, onClose }: { transaction: DashboardData["transactions"][number]; receipts: DashboardData["receipts"]; data: DashboardData; householdId: string; reportingCurrency: string; language: AppLanguage; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"correct" | "reverse" | null>(null);
  const [message, setMessage] = useState("");
  const [correctionAccountId, setCorrectionAccountId] = useState(transaction.accountId);
  const [correctionPayeeId, setCorrectionPayeeId] = useState(transaction.payeeId ?? "");
  const [correctionVisibility, setCorrectionVisibility] = useState<"private" | "shared">(transaction.visibility);
  const t = (copy: string) => translate(language, copy);
  const locale = localeFor(language);
  const money = (amount: number, currency: string) => new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  const from = transaction.kind === "income" ? t("External source") : transaction.kind === "adjustment" ? t("Ledger adjustment") : transaction.account ?? t("Account");
  const to = transaction.kind === "transfer" ? transaction.transferAccount ?? t("Destination account") : transaction.kind === "expense" ? transaction.payee ?? transaction.category ?? t("Expense") : transaction.account ?? t("Account");
  const prefix = transaction.kind === "income" ? "+" : transaction.kind === "expense" ? "−" : "";
  const correctionAccount = data.accounts.find((account) => account.id === correctionAccountId) ?? data.accounts.find((account) => account.id === transaction.accountId);
  const correctionCategories = transaction.kind === "adjustment" ? data.categories : data.categories.filter((category) => category.kind === transaction.kind);
  const correctionVisibilityOptions = correctionAccount?.visibility === "private"
    ? [{ value: "private", label: t("Private"), meta: t("Required for a private account") }]
    : [{ value: "shared", label: t("Shared"), meta: t("Visible to household members") }, { value: "private", label: t("Private"), meta: t("Visible only to you") }];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (!correctionAccount) return setMessage(t("Choose an active account you can access."));
    setMessage("");
    startTransition(async () => {
      const result = await correctTransaction({
        transactionId: transaction.id,
        householdId,
        accountId: correctionAccount.id,
        categoryId: optional(fields, "categoryId"),
        payeeId: optional(fields, "payeeId"),
        tagIds: fields.getAll("tagIds").map(String),
        amount: fields.get("amount"),
        currency: correctionAccount.currency,
        occurredOn: fields.get("occurredOn"),
        payee: optional(fields, "payee"),
        note: optional(fields, "note"),
        visibility: correctionVisibility,
        reason: fields.get("reason"),
      });
      if (result.error) return setMessage(t(result.error));
      dialogRef.current?.close();
      router.refresh();
    });
  }

  function submitReversal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setMessage("");
    startTransition(async () => {
      const result = await reverseTransaction({ transactionId: transaction.id, reason: fields.get("reason") });
      if (result.error) return setMessage(t(result.error));
      dialogRef.current?.close();
      router.refresh();
    });
  }

  return <dialog ref={dialogRef} className="transaction-detail-dialog" onClose={onClose} onCancel={(event) => { event.preventDefault(); dialogRef.current?.close(); }} onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}>
    <article className="transaction-detail-sheet">
      <header><div><p className="eyebrow">{t("POSTED LEDGER RECORD")}</p><h2>{transaction.payee ?? transaction.category ?? t(transaction.kind)}</h2></div><button className="detail-close" type="button" onClick={() => dialogRef.current?.close()} aria-label={t("Close details")} autoFocus><X aria-hidden="true" /></button></header>
      <section className="transaction-detail-hero" data-kind={transaction.kind}>
        <div><span>{t(transaction.kind)}</span><strong>{prefix}{money(transaction.amount, transaction.currency)}</strong><small>{new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(new Date(`${transaction.occurredOn}T12:00:00`))}</small></div>
        <div className="transaction-state"><span><CheckCircle aria-hidden="true" weight="fill" />{t(transaction.status)}</span><span><LockKey aria-hidden="true" />{t(transaction.visibility)}</span></div>
      </section>
      <section className="money-path" aria-label={t("Money path")}><div><small>{t("From")}</small><strong>{from}</strong></div><ArrowRight aria-hidden="true" /><div><small>{t("To")}</small><strong>{to}</strong></div></section>
      <dl className="transaction-detail-grid">
        <div><dt>{t("Account")}</dt><dd>{transaction.account ?? t("Account")}</dd></div>
        {transaction.transferAccount && <div><dt>{t("Destination account")}</dt><dd>{transaction.transferAccount}</dd></div>}
        <div><dt>{t("Category")}</dt><dd>{transaction.category ?? t("Uncategorized")}</dd></div>
        <div><dt>{t("Payee")}</dt><dd>{transaction.payee ?? t("No payee")}</dd></div>
        <div><dt>{t("Recorded at")}</dt><dd>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(transaction.createdAt))}</dd></div>
        <div><dt>{t("Reference")}</dt><dd className="transaction-reference">{transaction.id}</dd></div>
        {transaction.currency !== reportingCurrency && <><div><dt>{t("Rate to household currency")}</dt><dd>1 {transaction.currency} = {transaction.reportingExchangeRate.toLocaleString(locale, { maximumFractionDigits: 8 })} {reportingCurrency}</dd></div><div><dt>{t("Value in household currency")}</dt><dd>{money(transaction.amount * transaction.reportingExchangeRate, reportingCurrency)}</dd></div></>}
      </dl>
      {transaction.note && <section className="transaction-detail-note"><small>{t("Note")}</small><p>{transaction.note}</p></section>}
      {transaction.workflow && <WorkflowRecordDetails workflow={transaction.workflow} language={language} currency={transaction.currency} />}
      {transaction.customTemplate && <TemplateRecordDetails template={transaction.customTemplate} language={language} currency={transaction.currency} />}
      {transaction.correctionReason && <section className="transaction-detail-correction-note"><small>{t("CORRECTION RECORD")}</small><strong>{t("This movement replaces an earlier posted record.")}</strong><p>{transaction.correctionReason}</p><code>{transaction.correctsTransactionId}</code></section>}
      {transaction.tags.length > 0 && <section className="transaction-detail-tags"><small>{t("Tags")}</small><div>{transaction.tags.map((tag) => <span key={tag.id}><i style={{ backgroundColor: tag.color }} aria-hidden="true" />{tag.name}</span>)}</div></section>}
      {transaction.items.length > 0 && <section className="transaction-detail-items"><div><small>{t("ITEMIZED RECORD")}</small><strong>{transaction.items.length} {t("items")}</strong></div>{transaction.items.map((item) => <div className="transaction-detail-item" key={item.id}><span><strong>{item.name}</strong><small>{item.quantity.toLocaleString(locale)} × {money(item.unitPrice, transaction.currency)}</small></span><strong>{money(Math.max(0, item.quantity * item.unitPrice - item.discount + item.tax), transaction.currency)}</strong></div>)}</section>}
      {receipts.length > 0 && <section className="transaction-detail-receipts"><small>{t("Receipts")}</small>{receipts.map((receipt) => <a href={`/api/receipts/${receipt.id}`} key={receipt.id}><Receipt aria-hidden="true" /><span>{receipt.filename}</span><DownloadSimple aria-hidden="true" /></a>)}</section>}
      {transaction.ownedByUser && <section className="transaction-detail-controls">
        <div><p className="eyebrow">{t("LEDGER CONTROL")}</p><h3>{t("Correct without erasing history")}</h3><p>{t("A correction creates a replacement movement. A reversal removes this movement from balances while preserving its audit record.")}</p></div>
        {transaction.correctable ? <>
          {!mode && <div className="transaction-control-actions"><button className="text-button" type="button" onClick={() => { setMode("correct"); setMessage(""); }}><NotePencil aria-hidden="true" />{t("Correct movement")}</button><button className="danger-text-button" type="button" onClick={() => { setMode("reverse"); setMessage(""); }}><Trash aria-hidden="true" />{t("Reverse movement")}</button></div>}
          {mode === "correct" && <form className="transaction-correction-form" onSubmit={submitCorrection}>
            <SelectField name="accountId" label={t("Account")} closeLabel={t("Close")} value={correctionAccountId} onValueChange={(accountId) => { setCorrectionAccountId(accountId); if (data.accounts.find((account) => account.id === accountId)?.visibility === "private") setCorrectionVisibility("private"); }} sheetTitle={t("Choose the corrected account")} options={data.accounts.map((account) => ({ value: account.id, label: account.name, meta: `${account.kind} · ${account.currency}` }))} required />
            <label>{t("Amount")}<input name="amount" type="number" min="0.01" step="any" inputMode="decimal" defaultValue={transaction.amount} required /></label>
            <div className="read-only-field"><span>{t("Currency")}</span><strong>{correctionAccount?.currency ?? transaction.currency}</strong><small>{t("Set by the selected account. Laundry applies the stored daily exchange rate automatically.")}</small></div>
            <SelectField name="visibility" label={t("Visibility")} closeLabel={t("Close")} value={correctionVisibility} onValueChange={(visibility) => setCorrectionVisibility(visibility as "private" | "shared")} sheetTitle={t("Choose who can see it")} options={correctionVisibilityOptions} />
            <label>{t("Date")}<input name="occurredOn" type="date" defaultValue={transaction.occurredOn} required /></label>
            <SelectField name="categoryId" label={t("Category")} closeLabel={t("Close")} defaultValue={transaction.categoryId ?? ""} sheetTitle={t("Choose the corrected category")} options={[{ value: "", label: t("No category") }, ...correctionCategories.map((category) => ({ value: category.id, label: category.name, meta: t(category.kind) }))]} />
            <SelectField name="payeeId" label={t("Payee")} closeLabel={t("Close")} value={correctionPayeeId} onValueChange={setCorrectionPayeeId} sheetTitle={t("Choose the corrected payee")} options={[{ value: "", label: t("No saved payee") }, ...data.payees.map((payee) => ({ value: payee.id, label: payee.name }))]} />
            {!correctionPayeeId && <label>{t("Payee name (optional)")}<input name="payee" defaultValue={transaction.payee ?? ""} maxLength={120} /></label>}
            <label className="full">{t("Note")}<textarea name="note" defaultValue={transaction.note ?? ""} maxLength={2000} rows={3} /></label>
            {data.tags.length > 0 && <fieldset className="tag-picker full"><legend>{t("Tags")}</legend><div>{data.tags.map((tag) => <label className="tag-choice" key={tag.id}><input type="checkbox" name="tagIds" value={tag.id} defaultChecked={transaction.tags.some((selectedTag) => selectedTag.id === tag.id)} /><i style={{ backgroundColor: tag.color }} aria-hidden="true" />{tag.name}</label>)}</div></fieldset>}
            <label className="full correction-reason">{t("Why are you correcting it?")}<textarea name="reason" minLength={3} maxLength={500} rows={3} required placeholder={t("Explain the change for the audit trail")} /></label>
            <div className="transaction-control-actions full"><button className="submit-button" disabled={pending}>{pending ? t("Saving…") : t("Post correction")}</button><button className="text-button" type="button" onClick={() => { setMode(null); setMessage(""); }} disabled={pending}>{t("Cancel")}</button></div>
          </form>}
          {mode === "reverse" && <form className="transaction-reversal-form" onSubmit={submitReversal}><strong>{t("Reverse this posted movement?")}</strong><p>{t("It will stop affecting balances, but Laundry will keep the original record and your reason.")}</p><label>{t("Reason for reversal")}<textarea name="reason" minLength={3} maxLength={500} rows={3} required placeholder={t("Explain why this movement should no longer affect balances")} /></label><div className="transaction-control-actions"><button className="danger-button" disabled={pending}>{pending ? t("Reversing…") : t("Confirm reversal")}</button><button className="text-button" type="button" onClick={() => { setMode(null); setMessage(""); }} disabled={pending}>{t("Cancel")}</button></div></form>}
        </> : <p className="transaction-control-lock"><LockKey aria-hidden="true" />{t("This movement is controlled by shopping, recurring, debt, card, transfer, or reconciliation history. Correct it from its original workflow.")}</p>}
        {message && <p className="form-message" role="alert">{message}</p>}
      </section>}
      <footer><CheckCircle aria-hidden="true" weight="duotone" /><p><strong>{t("Audited ledger entry")}</strong><span>{t("This record is posted. Future corrections will preserve this original entry and its audit trail.")}</span></p></footer>
    </article>
  </dialog>;
}
