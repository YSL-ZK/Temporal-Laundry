"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AirplaneTilt, CalendarDots, CheckCircle, FirstAid, ForkKnife, GasPump, Sparkle } from "@phosphor-icons/react";
import type { DashboardData } from "../lib/dashboard";
import { localeFor, translate, type AppLanguage } from "../lib/i18n";
import type { CategoryWorkflowMetadata } from "../lib/validation";
import { postCategoryWorkflowTransaction, uploadReceipt } from "./actions/finance";
import { SelectField } from "./select-field";

type WorkflowType = CategoryWorkflowMetadata["categoryWorkflow"];
type Props = { data: DashboardData; language: AppLanguage };

const WORKFLOWS = [
  { type: "bills", label: "Bills", description: "Provider, billing period, deadline", icon: CalendarDots },
  { type: "transport", label: "Transport", description: "Vehicle, fuel, route, or fare", icon: GasPump },
  { type: "dining", label: "Dining", description: "Venue, participants, split, tip, and tax", icon: ForkKnife },
  { type: "health", label: "Health", description: "Care provider, patient, insurance, and claim", icon: FirstAid },
  { type: "travel", label: "Travel", description: "Trip, reservation, itinerary, and budget", icon: AirplaneTilt },
] as const;

const optionalText = (form: FormData, key: string) => String(form.get(key) ?? "").trim() || undefined;
const optionalNumber = (form: FormData, key: string) => {
  const raw = String(form.get(key) ?? "").trim();
  return raw === "" ? undefined : raw;
};

export function CategoryWorkflowWorkspace({ data, language }: Props) {
  const household = data.household;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [workflow, setWorkflow] = useState<WorkflowType>("bills");
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [payeeId, setPayeeId] = useState("");
  const [visibility, setVisibility] = useState<"private" | "shared">(data.accounts[0]?.visibility ?? "shared");
  const [message, setMessage] = useState("");
  const t = (copy: string) => translate(language, copy);
  const activeAccount = data.accounts.find((account) => account.id === accountId);
  const workflowDefinition = WORKFLOWS.find((item) => item.type === workflow) ?? WORKFLOWS[0];
  const WorkflowIcon = workflowDefinition.icon;
  const expenseCategories = data.categories.filter((category) => category.kind === "expense");
  const categoryOptions = expenseCategories.map((category) => ({ value: category.id, label: category.name, meta: t("Expense category") }));
  const accountOptions = data.accounts.map((account) => ({ value: account.id, label: account.name, meta: `${account.kind} · ${account.currency}` }));
  const visibilityOptions = activeAccount?.visibility === "private"
    ? [{ value: "private", label: t("Private"), meta: t("Required for a private account") }]
    : [{ value: "shared", label: t("Shared"), meta: t("Visible to household members") }, { value: "private", label: t("Private"), meta: t("Visible only to you") }];
  const likelyCategoryId = useMemo(() => {
    const names: Record<WorkflowType, string[]> = {
      bills: ["bill", "factura", "subscription", "suscrip"],
      transport: ["transport", "transporte"],
      dining: ["dining", "restaurant", "restaurante", "comida"],
      health: ["health", "salud"],
      travel: ["travel", "viaje"],
    };
    return expenseCategories.find((category) => names[workflow].some((term) => category.name.toLowerCase().includes(term)))?.id ?? "";
  }, [expenseCategories, workflow]);
  const effectiveCategoryId = categoryId || likelyCategoryId;
  const selectedCategory = expenseCategories.find((category) => category.id === effectiveCategoryId);

  if (!household) return null;
  const activeHousehold = household;

  function changeWorkflow(nextWorkflow: WorkflowType) {
    setWorkflow(nextWorkflow);
    const names: Record<WorkflowType, string[]> = {
      bills: ["bill", "factura", "subscription", "suscrip"],
      transport: ["transport", "transporte"],
      dining: ["dining", "restaurant", "restaurante", "comida"],
      health: ["health", "salud"],
      travel: ["travel", "viaje"],
    };
    setCategoryId(expenseCategories.find((category) => names[nextWorkflow].some((term) => category.name.toLowerCase().includes(term)))?.id ?? "");
    setMessage("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const receipt = fields.get("receipt");
    const common = {
      householdId: activeHousehold.id,
      accountId,
      categoryId: effectiveCategoryId,
      payeeId: payeeId || undefined,
      tagIds: fields.getAll("tagIds").map(String),
      amount: fields.get("amount"),
      currency: activeAccount?.currency,
      occurredOn: fields.get("occurredOn"),
      payee: optionalText(fields, "payee"),
      note: optionalText(fields, "note"),
      visibility,
    };
    const details = workflow === "bills" ? {
      provider: fields.get("provider"),
      serviceReference: optionalText(fields, "serviceReference"),
      billingPeriod: optionalText(fields, "billingPeriod"),
      dueOn: fields.get("dueOn"),
      recurringRuleId: optionalText(fields, "recurringRuleId"),
    } : workflow === "transport" ? {
      vehicleOrRoute: fields.get("vehicleOrRoute"),
      distance: optionalNumber(fields, "distance"),
      odometer: optionalNumber(fields, "odometer"),
      fuelQuantity: optionalNumber(fields, "fuelQuantity"),
      fare: optionalNumber(fields, "fare"),
      tripNotes: optionalText(fields, "tripNotes"),
    } : workflow === "dining" ? {
      venue: fields.get("venue"),
      participants: String(fields.get("participants") ?? "").split(",").map((participant) => participant.trim()).filter(Boolean),
      splitAmount: optionalNumber(fields, "splitAmount"),
      tip: optionalNumber(fields, "tip") ?? 0,
      tax: optionalNumber(fields, "tax") ?? 0,
    } : workflow === "health" ? {
      provider: fields.get("provider"),
      service: fields.get("service"),
      patient: optionalText(fields, "patient"),
      reimbursementStatus: fields.get("reimbursementStatus"),
      claimReference: optionalText(fields, "claimReference"),
    } : {
      trip: fields.get("trip"),
      reservationOrVendor: optionalText(fields, "reservationOrVendor"),
      itineraryOn: fields.get("itineraryOn"),
      localCurrency: fields.get("localCurrency"),
      tripBudget: optionalNumber(fields, "tripBudget"),
    };
    setMessage("");
    startTransition(async () => {
      const result = await postCategoryWorkflowTransaction({ ...common, workflow, details });
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
      form.reset();
      setMessage(t("Workflow expense posted."));
      router.refresh();
    });
  }

  return <section className="wide-card category-workflow-studio" id="category-workflows">
    <div className="section-head workflow-studio-heading">
      <div><p className="eyebrow">{t("CATEGORY WORKFLOWS")}</p><h2>{t("Keep the story behind the expense")}</h2><p>{t("Choose a guided capture. Laundry posts one reviewed expense and keeps the useful context with its audit record.")}</p></div>
      <span className="workflow-studio-mark" aria-hidden="true"><Sparkle weight="duotone" /></span>
    </div>
    <div className="workflow-studio-layout">
      <nav className="workflow-rail" aria-label={t("Expense workflow")}>
        {WORKFLOWS.map(({ type, label, description, icon: Icon }) => <button key={type} type="button" className={workflow === type ? "active" : ""} onClick={() => changeWorkflow(type)} aria-pressed={workflow === type}>
          <span><Icon weight="duotone" aria-hidden="true" /></span><span><strong>{t(label)}</strong><small>{t(description)}</small></span><CheckCircle weight={workflow === type ? "fill" : "regular"} aria-hidden="true" />
        </button>)}
      </nav>
      <form className="workflow-form" onSubmit={submit} key={workflow}>
        <header><span><WorkflowIcon weight="duotone" aria-hidden="true" /></span><div><p className="eyebrow">{t(`${workflowDefinition.label.toUpperCase()} CAPTURE`)}</p><h3>{t(workflowDefinition.label)}</h3><p>{t(workflowDefinition.description)}</p></div></header>
        <fieldset className="workflow-fields"><legend>{t("Context")}</legend><WorkflowFields workflow={workflow} data={data} language={language} /></fieldset>
        <fieldset className="workflow-fields workflow-ledger-fields"><legend>{t("Ledger review")}</legend>
          <SelectField name="accountId" label={t("Paying account")} closeLabel={t("Close")} value={accountId} onValueChange={(nextId) => { const next = data.accounts.find((account) => account.id === nextId); setAccountId(nextId); if (next) setVisibility(next.visibility); }} sheetTitle={t("Choose the paying account")} options={accountOptions} required />
          <SelectField name="categoryId" label={t("Category")} closeLabel={t("Close")} value={effectiveCategoryId} onValueChange={setCategoryId} sheetTitle={t("Choose an expense category")} options={categoryOptions} required />
          <label>{t("Reviewed total")}<input name="amount" type="number" inputMode="decimal" min="0.01" step="any" required /></label>
          <div className="read-only-field"><span>{t("Currency")}</span><strong>{activeAccount?.currency ?? activeHousehold.currency}</strong><small>{t("Set by the selected account. Laundry applies the stored daily exchange rate automatically.")}</small></div>
          <label>{t("Transaction date")}<input name="occurredOn" type="date" defaultValue={data.asOf} required /></label>
          <SelectField name="visibility" label={t("Visibility")} closeLabel={t("Close")} value={visibility} onValueChange={(next) => setVisibility(next as "private" | "shared")} sheetTitle={t("Choose who can see it")} options={visibilityOptions} />
          <SelectField name="payeeId" label={t("Saved payee")} closeLabel={t("Close")} value={payeeId} onValueChange={setPayeeId} sheetTitle={t("Choose a payee")} options={[{ value: "", label: t("No saved payee") }, ...data.payees.map((payee) => ({ value: payee.id, label: payee.name }))]} />
          {!payeeId && <label>{t("Payee name (optional)")}<input name="payee" maxLength={120} /></label>}
          <label className="full">{t("Note")}<textarea name="note" maxLength={2000} rows={3} /></label>
          {data.tags.length > 0 && <fieldset className="tag-picker full"><legend>{t("Tags")}</legend><div>{data.tags.map((tag) => <label className="tag-choice" key={tag.id}><input type="checkbox" name="tagIds" value={tag.id} /><i style={{ backgroundColor: tag.color }} aria-hidden="true" />{tag.name}</label>)}</div></fieldset>}
          <label className="full receipt-upload-field">{t("Receipt (optional)")}<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /><small>{t("JPG, PNG, WebP, or PDF up to 10 MB. Laundry verifies the file contents before saving it.")}</small></label>
        </fieldset>
        <div className="workflow-review"><div><small>{t("READY TO POST")}</small><strong>{selectedCategory?.name ?? t("Choose a category")}</strong><span>{activeAccount ? `${activeAccount.name} · ${activeAccount.currency}` : t("Choose an account")}</span></div><button className="submit-button" disabled={pending || !activeAccount || !effectiveCategoryId}>{pending ? t("Posting…") : t("Post guided expense")}</button></div>
        {message && <p className="form-message" role="status">{message}</p>}
      </form>
    </div>
  </section>;
}

function WorkflowFields({ workflow, data, language }: { workflow: WorkflowType; data: DashboardData; language: AppLanguage }) {
  const t = (copy: string) => translate(language, copy);
  if (workflow === "bills") return <>
    <label>{t("Provider")}<input name="provider" required maxLength={120} /></label>
    <label>{t("Service or account reference")}<input name="serviceReference" maxLength={120} /></label>
    <label>{t("Billing period")}<input name="billingPeriod" maxLength={80} placeholder={t("e.g. September 2026")} /></label>
    <label>{t("Due date")}<input name="dueOn" type="date" defaultValue={data.asOf} required /></label>
    <SelectField name="recurringRuleId" label={t("Recurring plan (optional)")} closeLabel={t("Close")} sheetTitle={t("Link a recurring plan")} options={[{ value: "", label: t("No recurring plan") }, ...data.recurring.filter((rule) => rule.kind === "bill" || rule.kind === "subscription").map((rule) => ({ value: rule.id, label: rule.name, meta: `${rule.currency} · ${rule.nextDueOn}` }))]} />
  </>;
  if (workflow === "transport") return <>
    <label>{t("Vehicle or route")}<input name="vehicleOrRoute" required maxLength={120} placeholder={t("e.g. Metro line 1 or family car")} /></label>
    <label>{t("Distance")}<input name="distance" type="number" inputMode="decimal" min="0" step="any" /></label>
    <label>{t("Odometer")}<input name="odometer" type="number" inputMode="decimal" min="0" step="any" /></label>
    <label>{t("Fuel quantity")}<input name="fuelQuantity" type="number" inputMode="decimal" min="0" step="any" /></label>
    <label>{t("Fare")}<input name="fare" type="number" inputMode="decimal" min="0" step="any" /></label>
    <label className="full">{t("Trip notes")}<textarea name="tripNotes" maxLength={1000} rows={3} /></label>
  </>;
  if (workflow === "dining") return <>
    <label>{t("Venue")}<input name="venue" required maxLength={120} /></label>
    <label>{t("Participants")}<input name="participants" maxLength={800} placeholder={t("Separate names with commas")} /></label>
    <label>{t("Your split")}<input name="splitAmount" type="number" inputMode="decimal" min="0" step="any" /></label>
    <label>{t("Tip")}<input name="tip" type="number" inputMode="decimal" min="0" step="any" defaultValue="0" /></label>
    <label>{t("Tax")}<input name="tax" type="number" inputMode="decimal" min="0" step="any" defaultValue="0" /></label>
  </>;
  if (workflow === "health") return <>
    <label>{t("Provider")}<input name="provider" required maxLength={120} /></label>
    <label>{t("Service")}<input name="service" required maxLength={160} /></label>
    <label>{t("Patient")}<input name="patient" maxLength={120} /></label>
    <SelectField name="reimbursementStatus" label={t("Insurance or reimbursement")} closeLabel={t("Close")} defaultValue="not_applicable" sheetTitle={t("Choose reimbursement status")} options={[{ value: "not_applicable", label: t("Not applicable") }, { value: "pending", label: t("Pending") }, { value: "submitted", label: t("Submitted") }, { value: "reimbursed", label: t("Reimbursed") }, { value: "denied", label: t("Denied") }]} />
    <label>{t("Claim reference")}<input name="claimReference" maxLength={120} /></label>
  </>;
  return <>
    <label>{t("Trip")}<input name="trip" required maxLength={120} /></label>
    <label>{t("Reservation or vendor")}<input name="reservationOrVendor" maxLength={160} /></label>
    <label>{t("Itinerary date")}<input name="itineraryOn" type="date" defaultValue={data.asOf} required /></label>
    <SelectField name="localCurrency" label={t("Local currency")} closeLabel={t("Close")} defaultValue={data.household?.currency ?? "COP"} sheetTitle={t("Choose the local currency")} options={["COP", "USD", "EUR"].map((currency) => ({ value: currency, label: currency }))} required />
    <label>{t("Trip budget")}<input name="tripBudget" type="number" inputMode="decimal" min="0" step="any" /></label>
  </>;
}

export function WorkflowRecordDetails({ workflow, language, currency }: { workflow: CategoryWorkflowMetadata; language: AppLanguage; currency: string }) {
  const t = (copy: string) => translate(language, copy);
  const locale = localeFor(language);
  const rows: Array<[string, string]> = [];
  const money = (value: number) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  if (workflow.categoryWorkflow === "bills") { const details = workflow.details; rows.push(["Provider", details.provider], ["Service or account reference", details.serviceReference ?? "—"], ["Billing period", details.billingPeriod ?? "—"], ["Due date", details.dueOn]); }
  if (workflow.categoryWorkflow === "transport") { const details = workflow.details; rows.push(["Vehicle or route", details.vehicleOrRoute], ["Distance", details.distance?.toLocaleString(locale) ?? "—"], ["Odometer", details.odometer?.toLocaleString(locale) ?? "—"], ["Fuel quantity", details.fuelQuantity?.toLocaleString(locale) ?? "—"], ["Fare", details.fare === undefined ? "—" : money(details.fare)], ["Trip notes", details.tripNotes ?? "—"]); }
  if (workflow.categoryWorkflow === "dining") { const details = workflow.details; rows.push(["Venue", details.venue], ["Participants", details.participants.join(", ") || "—"], ["Your split", details.splitAmount === undefined ? "—" : money(details.splitAmount)], ["Tip", money(details.tip)], ["Tax", money(details.tax)]); }
  if (workflow.categoryWorkflow === "health") { const details = workflow.details; rows.push(["Provider", details.provider], ["Service", details.service], ["Patient", details.patient ?? "—"], ["Insurance or reimbursement", t(details.reimbursementStatus)], ["Claim reference", details.claimReference ?? "—"]); }
  if (workflow.categoryWorkflow === "travel") { const details = workflow.details; rows.push(["Trip", details.trip], ["Reservation or vendor", details.reservationOrVendor ?? "—"], ["Itinerary date", details.itineraryOn], ["Local currency", details.localCurrency], ["Trip budget", details.tripBudget === undefined ? "—" : new Intl.NumberFormat(locale, { style: "currency", currency: details.localCurrency }).format(details.tripBudget)]); }
  return <section className="transaction-workflow-record"><div><small>{t("GUIDED CATEGORY RECORD")}</small><strong>{t(WORKFLOWS.find((item) => item.type === workflow.categoryWorkflow)?.label ?? workflow.categoryWorkflow)}</strong></div><dl>{rows.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl></section>;
}
