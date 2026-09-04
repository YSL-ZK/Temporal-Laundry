"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calculator, NotePencil, Plus, Rows, Trash, X } from "@phosphor-icons/react";
import type { DashboardData } from "../lib/dashboard";
import { formula } from "../lib/finance";
import { translate, type AppLanguage } from "../lib/i18n";
import type { CustomTemplateMetadata } from "../lib/validation";
import { deleteCategoryTemplate, postTemplateTransaction, saveCategoryTemplate, uploadReceipt } from "./actions/finance";
import { SelectField } from "./select-field";

type Props = { data: DashboardData; language: AppLanguage };
type Template = DashboardData["templates"][number];
type FieldType = Template["fields"][number]["type"];
type BuilderField = { id: string; key: string; label: string; type: FieldType; required: boolean; options: string; defaultValue: string; formula: string; amountPrefill: boolean };
type TemplateValue = string | number | boolean | string[];

const FIELD_TYPES: Array<{ value: FieldType; label: string }> = [
  { value: "text", label: "Text" }, { value: "number", label: "Number" }, { value: "currency", label: "Currency amount" },
  { value: "date", label: "Date" }, { value: "checkbox", label: "Checkbox" }, { value: "select", label: "Single select" },
  { value: "multiselect", label: "Multi-select" }, { value: "list", label: "List items" }, { value: "formula", label: "Formula" },
];
const newField = (index: number): BuilderField => ({ id: crypto.randomUUID(), key: `field_${index + 1}`, label: "", type: "text", required: false, options: "", defaultValue: "", formula: "", amountPrefill: false });
const optional = (form: FormData, key: string) => String(form.get(key) ?? "").trim() || undefined;

function builderFields(template?: Template): BuilderField[] {
  return template?.fields.map((field) => ({
    id: field.id, key: field.key, label: field.label, type: field.type, required: field.required,
    options: field.options.join(", "), defaultValue: Array.isArray(field.defaultValue) ? field.defaultValue.join(", ") : String(field.defaultValue ?? ""),
    formula: field.formula ?? "", amountPrefill: field.amountPrefill,
  })) ?? [newField(0)];
}

function initialTemplateValues(template: Template) {
  return Object.fromEntries(template.fields.flatMap((field) => {
    if (field.type === "formula") return [];
    if (field.defaultValue !== null) return [[field.key, field.defaultValue]];
    if (field.type === "checkbox") return [[field.key, false]];
    if (field.type === "multiselect" || field.type === "list") return [[field.key, []]];
    return [[field.key, ""]];
  })) as Record<string, TemplateValue>;
}

export function TemplateWorkflowWorkspace({ data, language }: Props) {
  const household = data.household;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [builder, setBuilder] = useState<BuilderField[]>(() => [newField(0)]);
  const [activeTemplateId, setActiveTemplateId] = useState(data.templates[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, TemplateValue>>(() => data.templates[0] ? initialTemplateValues(data.templates[0]) : {});
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? "");
  const [visibility, setVisibility] = useState<"private" | "shared">(data.accounts[0]?.visibility ?? "shared");
  const [payeeId, setPayeeId] = useState("");
  const [reviewedAmount, setReviewedAmount] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const t = (copy: string) => translate(language, copy);
  const activeTemplate = data.templates.find((template) => template.id === activeTemplateId) ?? null;
  const activeAccount = data.accounts.find((account) => account.id === accountId);
  const computedValues = useMemo(() => {
    if (!activeTemplate) return { values, prefill: null as number | null };
    const next = { ...values };
    const numeric: Record<string, number> = {};
    let prefill: number | null = null;
    for (const field of activeTemplate.fields) {
      const existing = next[field.key];
      if ((field.type === "number" || field.type === "currency") && typeof existing === "number") numeric[field.key] = existing;
      if (field.type === "formula") {
        const result = field.formula ? formula(field.formula, numeric) : null;
        if (result !== null) { next[field.key] = result; numeric[field.key] = result; if (field.amountPrefill) prefill = result; }
      }
    }
    return { values: next, prefill };
  }, [activeTemplate, values]);

  if (!household) return null;
  const activeHousehold = household;
  const accountOptions = data.accounts.map((account) => ({ value: account.id, label: account.name, meta: `${account.kind} · ${account.currency}` }));
  const categoryOptions = data.categories.map((category) => ({ value: category.id, label: category.name, meta: t(category.kind) }));
  const visibilityOptions = activeAccount?.visibility === "private"
    ? [{ value: "private", label: t("Private"), meta: t("Required for a private account") }]
    : [{ value: "shared", label: t("Shared"), meta: t("Visible to household members") }, { value: "private", label: t("Private"), meta: t("Visible only to you") }];

  function updateBuilder(id: string, changes: Partial<BuilderField>) {
    setBuilder((current) => current.map((field) => field.id === id ? { ...field, ...changes } : field));
  }
  function selectTemplate(template: Template) {
    setActiveTemplateId(template.id); setValues(initialTemplateValues(template)); setReviewedAmount(""); setMessage("");
  }
  function editTemplate(template: Template) {
    setEditingTemplate(template); setBuilder(builderFields(template)); setMessage("");
    window.requestAnimationFrame(() => document.getElementById("template-builder")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function resetBuilder(form?: HTMLFormElement) { form?.reset(); setEditingTemplate(null); setBuilder([newField(0)]); }

  function submitTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form);
    setMessage("");
    startTransition(async () => {
      const result = await saveCategoryTemplate({
        templateId: editingTemplate?.id, householdId: activeHousehold.id, categoryId: fields.get("categoryId"),
        visibility: fields.get("visibility"), name: fields.get("name"), icon: optional(fields, "icon"), description: optional(fields, "description"),
        fields: builder.map((field) => ({
          key: field.key.trim(), label: field.label.trim(), type: field.type, required: field.required,
          options: (field.type === "select" || field.type === "multiselect") ? field.options.split(",").map((option) => option.trim()).filter(Boolean) : [],
          defaultValue: field.defaultValue.trim() === "" ? undefined : field.type === "number" || field.type === "currency" ? Number(field.defaultValue) : field.type === "checkbox" ? field.defaultValue === "true" : field.type === "multiselect" || field.type === "list" ? field.defaultValue.split(",").map((item) => item.trim()).filter(Boolean) : field.defaultValue.trim(),
          formula: field.type === "formula" ? field.formula.trim() : undefined, amountPrefill: field.type === "formula" && field.amountPrefill,
        })),
      });
      if (result.error) return setMessage(t(result.error));
      resetBuilder(form); setMessage(t(editingTemplate ? "Template updated." : "Template created.")); router.refresh();
    });
  }

  function removeTemplate(templateId: string) {
    startTransition(async () => {
      const result = await deleteCategoryTemplate({ templateId });
      if (result.error) return setMessage(t(result.error));
      if (activeTemplateId === templateId) { setActiveTemplateId(""); setValues({}); }
      setDeleteId(null); setMessage(t("Template deleted.")); router.refresh();
    });
  }

  function submitTemplateTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!activeTemplate || !activeAccount) return;
    const form = event.currentTarget; const fields = new FormData(form); const receipt = fields.get("receipt");
    setMessage("");
    startTransition(async () => {
      const result = await postTemplateTransaction({
        templateId: activeTemplate.id, accountId: activeAccount.id, payeeId: payeeId || undefined,
        tagIds: fields.getAll("tagIds").map(String), amount: reviewedAmount || computedValues.prefill,
        currency: activeAccount.currency, occurredOn: fields.get("occurredOn"), payee: optional(fields, "payee"), note: optional(fields, "note"),
        visibility, values: computedValues.values,
      });
      if (result.error || !result.data) return setMessage(t(result.error ?? "We couldn't complete that request. Please try again."));
      if (receipt instanceof File && receipt.size > 0) {
        const receiptForm = new FormData(); receiptForm.set("transactionId", result.data.id); receiptForm.set("file", receipt);
        const receiptResult = await uploadReceipt(receiptForm);
        if (receiptResult.error) { setMessage(t("Transaction posted, but the receipt could not be saved.")); router.refresh(); return; }
      }
      form.reset(); setValues(initialTemplateValues(activeTemplate)); setReviewedAmount(""); setMessage(t("Template movement posted.")); router.refresh();
    });
  }

  return <section className="wide-card template-studio" id="template-builder">
    <div className="section-head"><div><p className="eyebrow">{t("CUSTOM CAPTURES")}</p><h2>{t("Build your own finance workflow")}</h2><p>{t("Define reusable fields and safe formulas, then review every amount before it reaches the ledger.")}</p></div><span className="template-studio-mark" aria-hidden="true"><Rows weight="duotone" /></span></div>
    <div className="template-library" aria-label={t("Custom templates")}>
      {data.templates.map((template) => <article key={template.id} className={activeTemplateId === template.id ? "active" : ""}>
        <button type="button" className="template-select" onClick={() => selectTemplate(template)}><span><Calculator weight="duotone" aria-hidden="true" /></span><strong>{template.name}</strong><small>{template.category} · v{template.version} · {t(template.visibility)}</small></button>
        {!template.isBuiltin && <div><button type="button" onClick={() => editTemplate(template)} aria-label={`${t("Edit")} ${template.name}`}><NotePencil aria-hidden="true" /></button><button type="button" onClick={() => setDeleteId(template.id)} aria-label={`${t("Delete")} ${template.name}`}><Trash aria-hidden="true" /></button></div>}
        {deleteId === template.id && <div className="template-delete-confirm" role="alert"><span>{t("Delete this template?")}</span><button type="button" onClick={() => removeTemplate(template.id)} disabled={pending}>{t("Delete")}</button><button type="button" onClick={() => setDeleteId(null)}><X aria-hidden="true" /><span className="sr-only">{t("Cancel")}</span></button></div>}
      </article>)}
      {!data.templates.length && <div className="template-library-empty"><Calculator weight="duotone" aria-hidden="true" /><strong>{t("No custom templates yet")}</strong><span>{t("Create one below to turn repeated details into a guided capture.")}</span></div>}
    </div>

    {activeTemplate && <form className="template-runner" onSubmit={submitTemplateTransaction}>
      <header><div><p className="eyebrow">{t("USE TEMPLATE")}</p><h3>{activeTemplate.name}</h3><p>{activeTemplate.description ?? `${activeTemplate.category} · ${t(activeTemplate.categoryKind)}`}</p></div><span>v{activeTemplate.version}</span></header>
      <div className="template-value-grid">{activeTemplate.fields.map((field) => <TemplateValueField key={field.id} field={field} value={computedValues.values[field.key]} language={language} onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))} />)}</div>
      <fieldset className="template-ledger-review"><legend>{t("Final ledger review")}</legend>
        <SelectField name="accountId" label={t("Account")} closeLabel={t("Close")} value={accountId} onValueChange={(nextId) => { const account = data.accounts.find((item) => item.id === nextId); setAccountId(nextId); if (account) setVisibility(account.visibility); }} sheetTitle={t("Choose the account")} options={accountOptions} required />
        <label>{t("Reviewed amount")}<input name="amount" type="number" inputMode="decimal" min="0.01" step="any" value={reviewedAmount || (computedValues.prefill ?? "")} onChange={(event) => setReviewedAmount(event.target.value)} required /><small>{computedValues.prefill !== null ? t("Formula suggestion—review before posting.") : t("Enter the final amount to post.")}</small></label>
        <div className="read-only-field"><span>{t("Currency")}</span><strong>{activeAccount?.currency ?? activeHousehold.currency}</strong><small>{t("Set by the selected account. Laundry applies the stored daily exchange rate automatically.")}</small></div>
        <label>{t("Date")}<input name="occurredOn" type="date" defaultValue={data.asOf} required /></label>
        <SelectField name="visibility" label={t("Visibility")} closeLabel={t("Close")} value={visibility} onValueChange={(next) => setVisibility(next as "private" | "shared")} sheetTitle={t("Choose who can see it")} options={visibilityOptions} />
        <SelectField name="payeeId" label={t("Payee")} closeLabel={t("Close")} value={payeeId} onValueChange={setPayeeId} sheetTitle={t("Choose a payee")} options={[{ value: "", label: t("No saved payee") }, ...data.payees.map((payee) => ({ value: payee.id, label: payee.name }))]} />
        {!payeeId && <label>{t("Payee name (optional)")}<input name="payee" maxLength={120} /></label>}
        <label className="full">{t("Note")}<textarea name="note" rows={3} maxLength={2000} /></label>
        {data.tags.length > 0 && <fieldset className="tag-picker full"><legend>{t("Tags")}</legend><div>{data.tags.map((tag) => <label className="tag-choice" key={tag.id}><input type="checkbox" name="tagIds" value={tag.id} /><i style={{ backgroundColor: tag.color }} aria-hidden="true" />{tag.name}</label>)}</div></fieldset>}
        <label className="full receipt-upload-field">{t("Receipt (optional)")}<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
      </fieldset>
      <button className="submit-button template-post" disabled={pending || !activeAccount}>{pending ? t("Posting…") : t(`Post ${activeTemplate.categoryKind}`)}</button>
    </form>}

    <form className="template-builder" onSubmit={submitTemplate}>
      <header><div><p className="eyebrow">{t(editingTemplate ? "EDIT TEMPLATE" : "NEW TEMPLATE")}</p><h3>{t(editingTemplate ? "Refine the capture" : "Compose a reusable capture")}</h3></div>{editingTemplate && <button className="text-button" type="button" onClick={() => resetBuilder()}><X aria-hidden="true" />{t("Cancel editing")}</button>}</header>
      <div className="template-basics">
        <label>{t("Template name")}<input name="name" defaultValue={editingTemplate?.name ?? ""} required maxLength={100} /></label>
        <SelectField name="categoryId" label={t("Category")} closeLabel={t("Close")} defaultValue={editingTemplate?.categoryId ?? ""} sheetTitle={t("Choose the template category")} options={categoryOptions} required />
        <SelectField name="visibility" label={t("Visibility")} closeLabel={t("Close")} defaultValue={editingTemplate?.visibility ?? "shared"} sheetTitle={t("Choose who can use it")} options={[{ value: "shared", label: t("Shared") }, { value: "private", label: t("Private") }]} />
        <label>{t("Short icon label (optional)")}<input name="icon" defaultValue={editingTemplate?.icon ?? ""} maxLength={40} /></label>
        <label className="full">{t("Description")}<input name="description" defaultValue={editingTemplate?.description ?? ""} maxLength={500} /></label>
      </div>
      <div className="template-field-list">{builder.map((field, index) => <article key={field.id} className="template-field-card">
        <header><span>{String(index + 1).padStart(2, "0")}</span><strong>{field.label || t("Untitled field")}</strong><button type="button" onClick={() => setBuilder((current) => current.filter((item) => item.id !== field.id))} disabled={builder.length === 1} aria-label={t("Remove field")}><Trash aria-hidden="true" /></button></header>
        <div><label>{t("Field label")}<input value={field.label} onChange={(event) => updateBuilder(field.id, { label: event.target.value })} maxLength={80} required /></label><label>{t("Field key")}<input value={field.key} onChange={(event) => updateBuilder(field.id, { key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} maxLength={40} required /></label><SelectField name={`type-${field.id}`} label={t("Field type")} closeLabel={t("Close")} value={field.type} onValueChange={(type) => updateBuilder(field.id, { type: type as FieldType, options: "", formula: "", amountPrefill: false })} sheetTitle={t("Choose a field type")} options={FIELD_TYPES.map((type) => ({ value: type.value, label: t(type.label) }))} /></div>
        {(field.type === "select" || field.type === "multiselect") && <label>{t("Options")}<input value={field.options} onChange={(event) => updateBuilder(field.id, { options: event.target.value })} placeholder={t("Comma-separated options")} required /></label>}
        {field.type === "formula" ? <div className="formula-builder"><label>{t("Formula expression")}<input value={field.formula} onChange={(event) => updateBuilder(field.id, { formula: event.target.value })} placeholder="round(subtotal + tax, 2)" required /></label><label className="template-check"><input type="checkbox" checked={field.amountPrefill} onChange={(event) => setBuilder((current) => current.map((item) => ({ ...item, amountPrefill: item.id === field.id ? event.target.checked : false })))} /><span><strong>{t("Suggest transaction amount")}</strong><small>{t("The user must still review it.")}</small></span></label></div> : <label>{t("Default value (optional)")}<input value={field.defaultValue} onChange={(event) => updateBuilder(field.id, { defaultValue: event.target.value })} /></label>}
        {field.type !== "formula" && <label className="template-check"><input type="checkbox" checked={field.required} onChange={(event) => updateBuilder(field.id, { required: event.target.checked })} /><span><strong>{t("Required field")}</strong><small>{t("Posting waits until this value is present.")}</small></span></label>}
      </article>)}</div>
      <div className="template-builder-actions"><button className="text-button" type="button" onClick={() => setBuilder((current) => [...current, newField(current.length)])} disabled={builder.length >= 30}><Plus aria-hidden="true" />{t("Add field")}</button><button className="submit-button" disabled={pending}>{pending ? t("Saving…") : t(editingTemplate ? "Save template changes" : "Create template")}</button></div>
    </form>
    {message && <p className="form-message" role="status">{message}</p>}
  </section>;
}

function TemplateValueField({ field, value, language, onChange }: { field: Template["fields"][number]; value: TemplateValue | undefined; language: AppLanguage; onChange: (value: TemplateValue) => void }) {
  const t = (copy: string) => translate(language, copy);
  if (field.type === "formula") return <div className="template-formula-result"><span><Calculator aria-hidden="true" />{field.label}</span><strong>{typeof value === "number" ? value.toLocaleString() : "—"}</strong></div>;
  if (field.type === "checkbox") return <label className="template-check value-check"><input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} /><span><strong>{field.label}</strong><small>{field.required ? t("Required") : t("Optional")}</small></span></label>;
  if (field.type === "select") return <SelectField name={`value-${field.key}`} label={field.label} closeLabel={t("Close")} value={typeof value === "string" ? value : ""} onValueChange={onChange} sheetTitle={`${t("Choose")} ${field.label}`} options={[{ value: "", label: t("Choose an option") }, ...field.options.map((option) => ({ value: option, label: option }))]} required={field.required} />;
  if (field.type === "multiselect") return <fieldset className="template-multi"><legend>{field.label}</legend>{field.options.map((option) => <label key={option}><input type="checkbox" checked={Array.isArray(value) && value.includes(option)} onChange={(event) => { const current = Array.isArray(value) ? value : []; onChange(event.target.checked ? [...current, option] : current.filter((item) => item !== option)); }} /><span>{option}</span></label>)}</fieldset>;
  if (field.type === "list") return <label>{field.label}<textarea value={Array.isArray(value) ? value.join("\n") : ""} onChange={(event) => onChange(event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} rows={4} placeholder={t("One item per line")} required={field.required} /></label>;
  return <label>{field.label}<input type={field.type === "date" ? "date" : field.type === "number" || field.type === "currency" ? "number" : "text"} inputMode={field.type === "number" || field.type === "currency" ? "decimal" : undefined} step={field.type === "number" || field.type === "currency" ? "any" : undefined} value={typeof value === "number" || typeof value === "string" ? value : ""} onChange={(event) => onChange(field.type === "number" || field.type === "currency" ? (event.target.value === "" ? "" : Number(event.target.value)) : event.target.value)} required={field.required} /></label>;
}

export function TemplateRecordDetails({ template, language, currency }: { template: CustomTemplateMetadata; language: AppLanguage; currency: string }) {
  const t = (copy: string) => translate(language, copy);
  const formatted = (field: CustomTemplateMetadata["fields"][number]) => {
    const value = template.values[field.key];
    if (value === undefined) return "—";
    if (typeof value === "boolean") return value ? t("Yes") : t("No");
    if (Array.isArray(value)) return value.join(", ") || "—";
    if (typeof value === "number" && field.type === "currency") return new Intl.NumberFormat(language === "es" ? "es-CO" : "en-US", { style: "currency", currency }).format(value);
    return String(value);
  };
  return <section className="transaction-workflow-record template-record"><div><small>{t("CUSTOM TEMPLATE RECORD")}</small><strong>{template.templateName} · v{template.templateVersion}</strong></div><dl>{template.fields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{formatted(field)}</dd></div>)}</dl></section>;
}
