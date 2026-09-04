"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { createAdminClient } from "../../lib/supabase/admin";
import { createClient } from "../../lib/supabase/server";
import type { DashboardData } from "../../lib/dashboard";
import { getDailyExchangeRates } from "../../lib/exchange-rates";
import { currencyRate } from "../../lib/money";
import { formula } from "../../lib/finance";
import { detectReceiptMime, receiptExtension, safeReceiptFilename } from "../../lib/receipts";
import { accountArchiveSchema, accountSchema, accountUpdateSchema, budgetEnvelopeSchema, budgetRolloverSchema, budgetSchema, cardPaymentSchema, cardStatementSchema, categorySchema, categoryTemplateDeleteSchema, categoryTemplateSchema, categoryWorkflowMetadataSchema, categoryWorkflowTransactionSchema, customTemplateMetadataSchema, debtPaymentSchema, debtSchema, goalAllocationSchema, goalSchema, householdSchema, invitationSchema, payeeSchema, profileLanguageSchema, receiptDeletionSchema, reconciliationSchema, recurringOccurrenceConfirmSchema, recurringOccurrenceSkipSchema, recurringSchema, shoppingCheckoutSchema, shoppingItemSchema, shoppingListSchema, tagSchema, templateTransactionSchema, transactionCorrectionSchema, transactionDraftIdSchema, transactionDraftSchema, transactionReversalSchema, transactionSchema, transactionSearchSchema, uuidSchema, voidExpenseSchema } from "../../lib/validation";

type ActionResult<T = void> = { data?: T; error?: string };

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error?.message.toLowerCase().includes("invalid api key")) throw new Error("Supabase browser connection is invalid");
  if (!user) throw new Error("Sign in to continue");
  return { supabase, user };
}

function actionError(error: unknown, validationMessage = "Check the required fields and try again."): { error: string } {
  const diagnostic = typeof error === "object" && error !== null
    ? { name: "name" in error ? String(error.name) : "Error", code: "code" in error ? String(error.code) : undefined }
    : { name: "Error" };
  console.error("finance action failed", diagnostic);
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message).toLowerCase() : "";
  if (error instanceof ZodError) return { error: validationMessage };
  if (message.includes("invalid api key") || message.includes("server-side finance operations") || message.includes("supabase browser connection")) {
    return { error: "This deployment is not connected to Supabase correctly. Its administrator must add a valid server secret in Vercel and redeploy." };
  }
  if (message.includes("category access denied")) return { error: "Choose a category that matches the movement type." };
  if (message.includes("invalid transaction values")) return { error: "Enter a positive amount, a valid currency, exchange rate, and date." };
  if (message.includes("source account access denied")) return { error: "Choose an account you are allowed to use." };
  if (message.includes("account balance must be zero")) return { error: "Move or adjust the remaining balance to zero before removing this account." };
  if (message.includes("account still has active links")) return { error: "Remove this account from active cards, debts, and recurring plans before archiving it." };
  if (message.includes("daily exchange rate unavailable")) return { error: "Today's exchange rate is unavailable. Try again shortly." };
  if (message.includes("currencies must match")) return { error: "The debt, movement, and selected account must use the same currency." };
  if (message.includes("budget rollover access denied")) return { error: "Only a closed, accessible budget can be rolled into its next month." };
  if (message.includes("budget rollover limit reached")) return { error: "Too many budget changes. Wait a minute and try again." };
  if (message.includes("draft change limit") || message.includes("draft limit reached")) return { error: "Too many draft changes. Wait a minute or remove an older draft." };
  if (message.includes("draft access denied") || message.includes("draft source account") || message.includes("draft transfer account")) return { error: "This draft is no longer available with the selected accounts." };
  if (message.includes("invalid transaction draft")) return { error: "Check the draft amount, account, date, currency, and visibility." };
  if (message.includes("only unreconciled manual movements")) return { error: "This movement belongs to another workflow or reconciliation and must be corrected there." };
  if (message.includes("correction reason") || message.includes("reversal reason")) return { error: "Explain the correction in at least 3 characters." };
  if (message.includes("transaction correction limit")) return { error: "Too many corrections. Wait a minute and try again." };
  if (message.includes("category workflow")) return { error: "Review the required details for this category workflow." };
  if (message.includes("category template mutation limit")) return { error: "Too many template changes. Wait a minute and try again." };
  if (message.includes("category template access denied")) return { error: "This template is no longer available to you." };
  if (message.includes("template field") || message.includes("template value")) return { error: "Review the template fields, options, and required values." };
  if (message.includes("source account must match") || message.includes("transfer account must match")) return { error: "The account, currency, and private/shared scope must match." };
  if (message.includes("account mutation limit")) return { error: "Too many account changes. Wait a minute and try again." };
  if (message.includes("card payment account is not configured")) return { error: "Choose a payment account in the card settings first." };
  if (message.includes("matching household, currency, and visibility") || message.includes("card payment account access denied")) return { error: "Choose a payment account with the same household, currency, and visibility as the card." };
  if (message.includes("card payment exceeds")) return { error: "The payment is larger than the remaining statement or current card balance." };
  if (message.includes("card statement") || message.includes("card access denied")) return { error: "Check the card, statement dates, balance, and payment account." };
  if (message.includes("shared recurring items require a shared account")) return { error: "Shared recurring items must use a shared account." };
  if (message.includes("recurring occurrence is not available")) return { error: "This obligation was already confirmed or skipped. Refresh and try again." };
  if (message.includes("invalid receipt") || message.includes("receipt type")) return { error: "Choose a valid JPG, PNG, WebP, or PDF receipt up to 10 MB." };
  if (message.includes("receipt upload limit") || message.includes("receipt limit reached")) return { error: "Too many receipts were added. Wait a minute or remove an existing receipt." };
  if (message.includes("receipt deletion access denied")) return { error: "Only the person who uploaded this receipt can remove it." };
  if (message.includes("already reconciled")) return { error: "This account already has a reconciliation for that statement date." };
  if (message.includes("reconciliation account access denied")) return { error: "Choose an active account you are allowed to reconcile." };
  if (message.includes("invalid reconciliation")) return { error: "Check the statement period, ending balance, and date." };
  return { error: "We couldn't complete that request. Please try again." };
}

type TransactionQueryRow = {
  id: string; owner_id: string; occurred_on: string; created_at: string; kind: string; status: string; amount: unknown; currency: string;
  reporting_exchange_rate: unknown; account_id: string; transfer_account_id: string | null; category_id: string | null;
  visibility: "private" | "shared"; payee: string | null; payee_id: string | null; note: string | null;
  categories: { name: string } | Array<{ name: string }> | null;
  accounts: { name: string } | Array<{ name: string }> | null;
  transfer_accounts: { name: string } | Array<{ name: string }> | null;
  transaction_tags: Array<{ tags: { id: string; name: string; color: string | null } | Array<{ id: string; name: string; color: string | null }> | null }>;
  transaction_items: Array<{ id: string; name: string; quantity: unknown; unit_price: unknown; discount: unknown; tax: unknown }>;
  metadata: Record<string, unknown> | null; shopping_list_id: string | null;
  corrects_transaction_id: string | null; correction_reason: string | null;
};

function mapTransaction(row: TransactionQueryRow, userId: string): DashboardData["transactions"][number] {
  const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
  const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
  const transferAccount = Array.isArray(row.transfer_accounts) ? row.transfer_accounts[0] : row.transfer_accounts;
  const tags = (row.transaction_tags ?? []).flatMap((link) => {
    const tag = Array.isArray(link.tags) ? link.tags[0] : link.tags;
    return tag ? [{ id: tag.id, name: tag.name, color: tag.color ?? "#7dd3a7" }] : [];
  });
  return {
    id: row.id, occurredOn: row.occurred_on, createdAt: row.created_at, kind: row.kind, status: row.status,
    amount: Number(row.amount ?? 0), currency: row.currency, reportingExchangeRate: Number(row.reporting_exchange_rate ?? 1),
    accountId: row.account_id, account: account?.name ?? null,
    transferAccountId: row.transfer_account_id, transferAccount: transferAccount?.name ?? null,
    categoryId: row.category_id, category: category?.name ?? null,
    payeeId: row.payee_id, payee: row.payee, note: row.note, visibility: row.visibility,
    ownedByUser: row.owner_id === userId,
    correctable: row.owner_id === userId && row.kind !== "transfer" && row.shopping_list_id === null && Object.keys(row.metadata ?? {}).length === 0 && (row.transaction_items ?? []).length === 0,
    correctsTransactionId: row.corrects_transaction_id, correctionReason: row.correction_reason, tags,
    workflow: categoryWorkflowMetadataSchema.safeParse(row.metadata).data ?? null,
    customTemplate: customTemplateMetadataSchema.safeParse(row.metadata).data ?? null,
    items: (row.transaction_items ?? []).map((item) => ({ id: item.id, name: item.name, quantity: Number(item.quantity ?? 0), unitPrice: Number(item.unit_price ?? 0), discount: Number(item.discount ?? 0), tax: Number(item.tax ?? 0) })),
  };
}

export async function createHousehold(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = householdSchema.parse(input);
    const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("create_household", {
      actor_id: user.id, household_name: value.name, household_currency: value.currency, household_tax_rate: value.taxRate,
    });
    if (error || !data) throw error ?? new Error("Household was not created");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function createAccount(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = accountSchema.parse(input);
    const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("create_finance_account", {
      actor_id: user.id, target_household: value.householdId, account_name: value.name,
      account_kind: value.kind, account_currency: value.currency,
      account_opening_balance: value.openingBalance, account_visibility: value.visibility,
      card_credit_limit: value.creditLimit ?? null, card_payment_account: value.paymentAccountId ?? null,
      card_closing_day: value.closingDay ?? null, card_due_day: value.dueDay ?? null,
    });
    if (error || !data) throw error ?? new Error("Account was not created");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function updateAccount(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = accountUpdateSchema.parse(input);
    const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("update_finance_account", {
      actor_id: user.id, target_account: value.accountId, account_name: value.name,
      account_visibility: value.visibility, card_credit_limit: value.creditLimit ?? null,
      card_payment_account: value.paymentAccountId ?? null, card_closing_day: value.closingDay ?? null,
      card_due_day: value.dueDay ?? null,
    });
    if (error || !data) throw error ?? new Error("Account was not updated");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function archiveAccount(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = accountArchiveSchema.parse(input);
    const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("archive_finance_account", {
      actor_id: user.id, target_account: value.accountId,
    });
    if (error || !data) throw error ?? new Error("Account was not archived");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function postTransaction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = transactionSchema.parse(input);
    const { supabase, user } = await authenticatedClient();
    const [{ data: household }, { data: source }, { data: target }] = await Promise.all([
      supabase.from("households").select("reporting_currency").eq("id", value.householdId).single(),
      supabase.from("accounts").select("currency").eq("id", value.accountId).eq("household_id", value.householdId).is("archived_at", null).single(),
      value.transferAccountId
        ? supabase.from("accounts").select("currency").eq("id", value.transferAccountId).eq("household_id", value.householdId).is("archived_at", null).single()
        : Promise.resolve({ data: null }),
    ]);
    if (!household || !source) throw new Error("Source account access denied");
    if (source.currency !== value.currency) throw new Error("Movement and account currencies must match");
    if (value.kind === "transfer" && (!target || target.currency !== source.currency)) {
      throw new Error("Transfer account currencies must match");
    }
    const rates = source.currency === household.reporting_currency ? null : await getDailyExchangeRates(value.occurredOn);
    const reportingRate = source.currency === household.reporting_currency
      ? 1
      : rates ? currencyRate(source.currency, household.reporting_currency, rates.copPerUnit) : null;
    if (reportingRate === null) throw new Error("Daily exchange rate unavailable");
    const { data, error } = await createAdminClient().rpc("post_organized_transaction", {
      actor_id: user.id, target_household: value.householdId, source_account: value.accountId, target_account: value.transferAccountId ?? null,
      target_category: value.categoryId ?? null, target_payee: value.payeeId ?? null, target_tags: value.tagIds,
      transaction_kind: value.kind, transaction_amount: value.amount,
      transaction_currency: value.currency, transaction_rate: reportingRate, transaction_date: value.occurredOn,
      transaction_visibility: value.visibility, transaction_payee: value.payee ?? null, transaction_note: value.note ?? null,
      transaction_items: value.items.map((item) => ({ categoryId: item.categoryId ?? null, name: item.name, quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount, tax: item.tax })),
    });
    if (error || !data) throw error ?? new Error("Transaction was not posted");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error, "Check the amount, currency, exchange rate, date, and required fields."); }
}

export async function postCategoryWorkflowTransaction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = categoryWorkflowTransactionSchema.parse(input);
    const { supabase, user } = await authenticatedClient();
    const [{ data: household }, { data: source }] = await Promise.all([
      supabase.from("households").select("reporting_currency").eq("id", value.householdId).single(),
      supabase.from("accounts").select("currency").eq("id", value.accountId).eq("household_id", value.householdId).is("archived_at", null).single(),
    ]);
    if (!household || !source) throw new Error("Source account access denied");
    if (source.currency !== value.currency) throw new Error("Movement and account currencies must match");
    const rates = source.currency === household.reporting_currency ? null : await getDailyExchangeRates(value.occurredOn);
    const reportingRate = source.currency === household.reporting_currency
      ? 1
      : rates ? currencyRate(source.currency, household.reporting_currency, rates.copPerUnit) : null;
    if (reportingRate === null) throw new Error("Daily exchange rate unavailable");
    const { data, error } = await createAdminClient().rpc("post_category_workflow_transaction", {
      actor_id: user.id,
      target_household: value.householdId,
      source_account: value.accountId,
      target_category: value.categoryId,
      target_payee: value.payeeId ?? null,
      target_tags: value.tagIds,
      transaction_amount: value.amount,
      transaction_currency: value.currency,
      transaction_rate: reportingRate,
      transaction_date: value.occurredOn,
      transaction_visibility: value.visibility,
      transaction_payee: value.payee ?? null,
      transaction_note: value.note ?? null,
      workflow_type: value.workflow,
      workflow_payload: value.details,
    });
    if (error || !data) throw error ?? new Error("Category workflow was not posted");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) {
    return actionError(error, "Review the required details for this category workflow.");
  }
}

export async function saveCategoryTemplate(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = categoryTemplateSchema.parse(input);
    const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("save_category_template", {
      actor_id: user.id,
      target_template: value.templateId ?? null,
      target_household: value.householdId,
      target_category: value.categoryId,
      template_visibility: value.visibility,
      template_name: value.name,
      template_icon: value.icon ?? null,
      template_description: value.description ?? null,
      template_fields: value.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        options: field.options,
        defaultValue: field.defaultValue,
        formula: field.formula,
        amountPrefill: field.amountPrefill,
      })),
    });
    if (error || !data) throw error ?? new Error("Category template was not saved");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error, "Review the template name, category, fields, options, and formulas."); }
}

export async function deleteCategoryTemplate(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = categoryTemplateDeleteSchema.parse(input);
    const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("delete_category_template", { actor_id: user.id, target_template: value.templateId });
    if (error || !data) throw error ?? new Error("Category template was not deleted");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function postTemplateTransaction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = templateTransactionSchema.parse(input);
    const { supabase, user } = await authenticatedClient();
    const [{ data: template }, { data: source }] = await Promise.all([
      supabase.from("category_templates").select("id,household_id,category_id,template_fields(key,label,field_type,required,options,formula,sort_order,default_value,amount_prefill)").eq("id", value.templateId).single(),
      supabase.from("accounts").select("currency").eq("id", value.accountId).is("archived_at", null).single(),
    ]);
    if (!template || !source) throw new Error("Category template access denied");
    if (source.currency !== value.currency) throw new Error("Movement and account currencies must match");
    const fields = [...(template.template_fields ?? [])].sort((left, right) => left.sort_order - right.sort_order);
    const normalizedValues: Record<string, string | number | boolean | string[]> = {};
    const numericValues: Record<string, number> = {};
    for (const field of fields) {
      let fieldValue = value.values[field.key] ?? field.default_value ?? undefined;
      if (field.field_type === "formula") {
        const result = field.formula ? formula(field.formula, numericValues) : null;
        if (result === null) throw new Error("Invalid template formula");
        fieldValue = result;
      }
      if (field.required && (fieldValue === undefined || fieldValue === "" || (Array.isArray(fieldValue) && fieldValue.length === 0))) throw new Error("Required template value missing");
      if (fieldValue === undefined || fieldValue === null || fieldValue === "") continue;
      if (field.field_type === "number" || field.field_type === "currency" || field.field_type === "formula") {
        if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) throw new Error("Invalid numeric template value");
        numericValues[field.key] = fieldValue;
      }
      normalizedValues[field.key] = fieldValue as string | number | boolean | string[];
    }
    const { data: household } = await supabase.from("households").select("reporting_currency").eq("id", template.household_id).single();
    if (!household) throw new Error("Household access denied");
    const rates = source.currency === household.reporting_currency ? null : await getDailyExchangeRates(value.occurredOn);
    const reportingRate = source.currency === household.reporting_currency ? 1 : rates ? currencyRate(source.currency, household.reporting_currency, rates.copPerUnit) : null;
    if (reportingRate === null) throw new Error("Daily exchange rate unavailable");
    const { data, error } = await createAdminClient().rpc("post_template_transaction", {
      actor_id: user.id, target_template: value.templateId, source_account: value.accountId,
      target_payee: value.payeeId ?? null, target_tags: value.tagIds,
      transaction_amount: value.amount, transaction_currency: value.currency,
      transaction_rate: reportingRate, transaction_date: value.occurredOn,
      transaction_visibility: value.visibility, transaction_payee: value.payee ?? null,
      transaction_note: value.note ?? null, template_values: normalizedValues,
    });
    if (error || !data) throw error ?? new Error("Template transaction was not posted");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error, "Review the required template values and the final amount."); }
}

export async function saveTransactionDraft(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = transactionDraftSchema.parse(input);
    const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("save_transaction_draft", {
      actor_id: user.id, target_draft: value.draftId ?? null, target_household: value.householdId,
      source_account: value.accountId, target_account: value.transferAccountId ?? null,
      target_category: value.categoryId ?? null, target_payee: value.payeeId ?? null, target_tags: value.tagIds,
      transaction_kind: value.kind, transaction_amount: value.amount, transaction_currency: value.currency,
      transaction_date: value.occurredOn, transaction_visibility: value.visibility,
      transaction_payee: value.payee ?? null, transaction_note: value.note ?? null,
    });
    if (error || !data) throw error ?? new Error("Draft was not saved");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error, "Check the draft amount, account, date, currency, and visibility."); }
}

export async function deleteTransactionDraft(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = transactionDraftIdSchema.parse(input);
    const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("delete_transaction_draft", { actor_id: user.id, target_draft: value.draftId });
    if (error || !data) throw error ?? new Error("Draft was not deleted");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function postTransactionDraft(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = transactionDraftIdSchema.parse(input);
    const { supabase, user } = await authenticatedClient();
    const { data: draft } = await supabase.from("transaction_drafts").select("id,household_id,currency,occurred_on").eq("id", value.draftId).single();
    if (!draft) throw new Error("Draft access denied");
    const { data: household } = await supabase.from("households").select("reporting_currency").eq("id", draft.household_id).single();
    if (!household) throw new Error("Household access denied");
    const rates = draft.currency === household.reporting_currency ? null : await getDailyExchangeRates(draft.occurred_on);
    const reportingRate = draft.currency === household.reporting_currency ? 1 : rates ? currencyRate(draft.currency, household.reporting_currency, rates.copPerUnit) : null;
    if (reportingRate === null) throw new Error("Daily exchange rate unavailable");
    const { data, error } = await createAdminClient().rpc("post_transaction_draft", { actor_id: user.id, target_draft: value.draftId, transaction_rate: reportingRate });
    if (error || !data) throw error ?? new Error("Draft was not posted");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function correctTransaction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = transactionCorrectionSchema.parse(input);
    const { supabase, user } = await authenticatedClient();
    const [{ data: household }, { data: source }] = await Promise.all([
      supabase.from("households").select("reporting_currency").eq("id", value.householdId).single(),
      supabase.from("accounts").select("currency").eq("id", value.accountId).eq("household_id", value.householdId).is("archived_at", null).single(),
    ]);
    if (!household || !source) throw new Error("Source account access denied");
    if (source.currency !== value.currency) throw new Error("Movement and account currencies must match");
    const rates = source.currency === household.reporting_currency ? null : await getDailyExchangeRates(value.occurredOn);
    const reportingRate = source.currency === household.reporting_currency ? 1 : rates ? currencyRate(source.currency, household.reporting_currency, rates.copPerUnit) : null;
    if (reportingRate === null) throw new Error("Daily exchange rate unavailable");
    const { data, error } = await createAdminClient().rpc("correct_owned_transaction", {
      actor_id: user.id, target_transaction: value.transactionId, source_account: value.accountId,
      target_category: value.categoryId ?? null, target_payee: value.payeeId ?? null, target_tags: value.tagIds,
      transaction_amount: value.amount, transaction_currency: value.currency, transaction_rate: reportingRate,
      transaction_date: value.occurredOn, transaction_visibility: value.visibility,
      transaction_payee: value.payee ?? null, transaction_note: value.note ?? null, correction_reason: value.reason,
    });
    if (error || !data) throw error ?? new Error("Transaction was not corrected");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error, "Check the corrected movement and explain why it changed."); }
}

export async function reverseTransaction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = transactionReversalSchema.parse(input);
    const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("reverse_owned_transaction", { actor_id: user.id, target_transaction: value.transactionId, reversal_reason: value.reason });
    if (error || !data) throw error ?? new Error("Transaction was not reversed");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error, "Explain why this movement should be reversed."); }
}

export async function createPayee(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = payeeSchema.parse(input);
    const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("create_payee", { actor_id: user.id, target_household: value.householdId, payee_name: value.name });
    if (error || !data) throw error ?? new Error("Payee was not created");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function createTag(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = tagSchema.parse(input);
    const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("create_tag", { actor_id: user.id, target_household: value.householdId, tag_name: value.name, tag_color: value.color });
    if (error || !data) throw error ?? new Error("Tag was not created");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function searchTransactions(input: unknown): Promise<ActionResult<DashboardData["transactions"]>> {
  try {
    const value = transactionSearchSchema.parse(input);
    const { supabase, user } = await authenticatedClient();
    const { data: membership, error: membershipError } = await supabase.from("household_members").select("household_id").eq("household_id", value.householdId).maybeSingle();
    if (membershipError || !membership) throw membershipError ?? new Error("Household access denied");

    let allowedIds: string[] | null = null;
    if (value.query) {
      const { data: matches, error: searchError } = await supabase.rpc("search_transaction_ids", { target_household: value.householdId, search_query: value.query });
      if (searchError) throw searchError;
      allowedIds = (matches ?? []).map((match: { transaction_id: string }) => match.transaction_id);
    }
    if (value.tagId) {
      const { data: tagLinks, error: tagError } = await supabase.from("transaction_tags").select("transaction_id").eq("tag_id", value.tagId).limit(500);
      if (tagError) throw tagError;
      const taggedIds = new Set((tagLinks ?? []).map((link) => link.transaction_id));
      allowedIds = allowedIds === null ? [...taggedIds] : allowedIds.filter((id) => taggedIds.has(id));
    }
    if (allowedIds?.length === 0) return { data: [] };

    let query = supabase.from("transactions")
      .select("id,owner_id,occurred_on,created_at,kind,status,amount,currency,reporting_exchange_rate,account_id,transfer_account_id,category_id,visibility,payee,payee_id,note,metadata,shopping_list_id,corrects_transaction_id,correction_reason,categories(name),accounts!transactions_account_id_fkey(name),transfer_accounts:accounts!transactions_transfer_account_id_fkey(name),transaction_tags(tags(id,name,color)),transaction_items(id,name,quantity,unit_price,discount,tax)")
      .eq("household_id", value.householdId).is("voided_at", null);
    if (allowedIds) query = query.in("id", allowedIds);
    if (value.kind) query = query.eq("kind", value.kind);
    if (value.accountId) query = query.eq("account_id", value.accountId);
    if (value.categoryId) query = query.eq("category_id", value.categoryId);
    if (value.payeeId) query = query.eq("payee_id", value.payeeId);
    if (value.visibility) query = query.eq("visibility", value.visibility);
    if (value.status) query = query.eq("status", value.status);
    if (value.dateFrom) query = query.gte("occurred_on", value.dateFrom);
    if (value.dateTo) query = query.lte("occurred_on", value.dateTo);
    if (value.minAmount !== undefined) query = query.gte("amount", value.minAmount);
    if (value.maxAmount !== undefined) query = query.lte("amount", value.maxAmount);
    const { data, error } = await query.order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return { data: (data ?? []).map((row) => mapTransaction(row as TransactionQueryRow, user.id)) };
  } catch (error) { return actionError(error); }
}

export async function createShoppingList(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = shoppingListSchema.parse(input);
    const { supabase, user } = await authenticatedClient();
    const { data, error } = await supabase.from("shopping_lists").insert({
      household_id: value.householdId, owner_id: user.id, visibility: value.visibility, name: value.name,
      currency: value.currency, default_tax_rate: value.defaultTaxRate,
    }).select("id").single();
    if (error || !data) throw error ?? new Error("List was not created");
    revalidatePath("/");
    return { data };
  } catch (error) { return actionError(error); }
}

export async function addShoppingItem(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = shoppingItemSchema.parse(input);
    const { supabase } = await authenticatedClient();
    const { data: list, error: listError } = await supabase.from("shopping_lists").select("id,household_id").eq("id", value.listId).single();
    if (listError || !list) throw listError ?? new Error("Shopping list was not found");
    if (value.categoryId) {
      const { data: category, error: categoryError } = await supabase.from("categories").select("id").eq("id", value.categoryId).eq("household_id", list.household_id).eq("kind", "expense").single();
      if (categoryError || !category) throw categoryError ?? new Error("Category was not found");
    }
    const { data, error } = await supabase.from("shopping_items").insert({
      list_id: value.listId, category_id: value.categoryId ?? null, name: value.name, quantity: value.quantity,
      estimated_price: value.estimatedPrice, tax_rate: value.taxRate ?? null, fixed_tax: value.fixedTax ?? null,
    }).select("id").single();
    if (error || !data) throw error ?? new Error("Shopping item was not added");
    revalidatePath("/");
    return { data };
  } catch (error) { return actionError(error); }
}

export async function checkoutShoppingList(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = shoppingCheckoutSchema.parse(input);
    const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("checkout_shopping_list", {
      actor_id: user.id, target_list: value.listId, source_account: value.accountId, target_category: value.categoryId,
      transaction_date: value.occurredOn, transaction_visibility: value.visibility,
      selected_items: value.items.map((item) => ({ id: item.id, categoryId: item.categoryId ?? null, quantity: item.quantity,
        actualPrice: item.actualPrice, discount: item.discount, taxRate: item.taxRate ?? null, fixedTax: item.fixedTax ?? null })),
      list_discount: value.discount, list_shipping: value.shipping, list_tip: value.tip, transaction_note: value.note ?? null,
    });
    if (error || !data) throw error ?? new Error("Shopping checkout was not posted");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function createCategory(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = categorySchema.parse(input); const { supabase } = await authenticatedClient();
    const { data, error } = await supabase.from("categories").insert({ household_id: value.householdId, name: value.name, kind: value.kind, color: value.color ?? null }).select("id").single();
    if (error || !data) throw error ?? new Error("Category was not created"); revalidatePath("/"); return { data };
  } catch (error) { return actionError(error); }
}

export async function createGoal(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = goalSchema.parse(input); const { supabase, user } = await authenticatedClient();
    const { data, error } = await supabase.from("goals").insert({ household_id: value.householdId, owner_id: user.id, visibility: value.visibility, name: value.name, target_amount: value.targetAmount, currency: value.currency, target_date: value.targetDate ?? null }).select("id").single();
    if (error || !data) throw error ?? new Error("Goal was not created"); revalidatePath("/"); return { data };
  } catch (error) { return actionError(error); }
}

export async function createDebt(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = debtSchema.parse(input); const { supabase, user } = await authenticatedClient();
    const { data, error } = await supabase.from("debts").insert({ household_id: value.householdId, owner_id: user.id, visibility: value.visibility, creditor: value.creditor, direction: value.direction, balance: value.balance, currency: value.currency, interest_rate: value.interestRate ?? null, minimum_payment: value.minimumPayment ?? null, due_day: value.dueDay ?? null, account_id: value.accountId ?? null }).select("id").single();
    if (error || !data) throw error ?? new Error("Debt was not created"); revalidatePath("/"); return { data };
  } catch (error) { return actionError(error); }
}

export async function createBudget(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = budgetSchema.parse(input); const { supabase, user } = await authenticatedClient();
    const { data, error } = await supabase.from("budgets").insert({ household_id: value.householdId, owner_id: user.id, visibility: value.visibility, category_id: value.categoryId ?? null, month: value.month, amount: value.amount, envelope_amount: value.envelopeAmount, currency: value.currency }).select("id").single();
    if (error || !data) throw error ?? new Error("Budget was not created"); revalidatePath("/"); return { data };
  } catch (error) { return actionError(error); }
}

export async function createRecurringRule(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = recurringSchema.parse(input); const { supabase, user } = await authenticatedClient();
    const { data: account, error: accountError } = await supabase.from("accounts").select("currency,visibility").eq("id", value.accountId).eq("household_id", value.householdId).is("archived_at", null).single();
    if (accountError || !account) throw accountError ?? new Error("Recurring account access denied");
    if (value.visibility === "shared" && account.visibility !== "shared") throw new Error("Shared recurring items require a shared account");
    if (value.categoryId) {
      const expectedKind = value.ruleKind === "income" ? "income" : "expense";
      const { data: category, error: categoryError } = await supabase.from("categories").select("id").eq("id", value.categoryId).eq("household_id", value.householdId).eq("kind", expectedKind).single();
      if (categoryError || !category) throw categoryError ?? new Error("Recurring category access denied");
    }
    const { data, error } = await supabase.from("recurring_rules").insert({ household_id: value.householdId, owner_id: user.id, visibility: value.visibility, account_id: value.accountId, category_id: value.categoryId ?? null, name: value.name, amount: value.amount, currency: account.currency, cadence: value.cadence, next_due_on: value.nextDueOn, rule_kind: value.ruleKind, provider: value.provider ?? null, service_reference: value.serviceReference ?? null, billing_period: value.billingPeriod ?? null }).select("id").single();
    if (error || !data) throw error ?? new Error("Recurring rule was not created");
    const through = new Date(); through.setUTCDate(through.getUTCDate() + 120);
    const generation = await createAdminClient().rpc("generate_recurring_occurrences", { target_through: through.toISOString().slice(0, 10) });
    if (generation.error) console.error("recurring occurrence generation failed", { code: generation.error.code });
    revalidatePath("/"); return { data };
  } catch (error) { return actionError(error); }
}

export async function confirmRecurringOccurrence(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = recurringOccurrenceConfirmSchema.parse(input); const { supabase, user } = await authenticatedClient();
    const { data: occurrence, error: occurrenceError } = await supabase.from("recurring_occurrences").select("id,recurring_rules!inner(currency,household_id)").eq("id", value.occurrenceId).single();
    if (occurrenceError || !occurrence) throw occurrenceError ?? new Error("Recurring occurrence access denied");
    const rule = Array.isArray(occurrence.recurring_rules) ? occurrence.recurring_rules[0] : occurrence.recurring_rules;
    if (!rule) throw new Error("Recurring occurrence access denied");
    const { data: household } = await supabase.from("households").select("reporting_currency").eq("id", rule.household_id).single();
    if (!household) throw new Error("Household access denied");
    const rates = rule.currency === household.reporting_currency ? null : await getDailyExchangeRates();
    const reportingRate = rule.currency === household.reporting_currency ? 1 : rates ? currencyRate(rule.currency, household.reporting_currency, rates.copPerUnit) : null;
    if (reportingRate === null) throw new Error("Daily exchange rate unavailable");
    const { data, error } = await createAdminClient().rpc("confirm_recurring_occurrence", { actor_id: user.id, target_occurrence: value.occurrenceId, payment_date: value.paidOn, transaction_rate: reportingRate });
    if (error || !data) throw error ?? new Error("Recurring item was not confirmed"); revalidatePath("/"); return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function skipRecurringOccurrence(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = recurringOccurrenceSkipSchema.parse(input); const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("skip_recurring_occurrence", { actor_id: user.id, target_occurrence: value.occurrenceId });
    if (error || !data) throw error ?? new Error("Recurring item was not skipped"); revalidatePath("/"); return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function recordCardStatement(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = cardStatementSchema.parse(input); const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("record_card_statement", { actor_id: user.id, target_card: value.cardId, statement_period_start: value.periodStart, statement_closing_on: value.closingOn, statement_due_on: value.dueOn, statement_amount: value.statementBalance });
    if (error || !data) throw error ?? new Error("Card statement was not recorded"); revalidatePath("/"); return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function recordCardPayment(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = cardPaymentSchema.parse(input); const { supabase, user } = await authenticatedClient();
    const { data: statement, error: statementError } = await supabase.from("card_statements").select("id,household_id,accounts!inner(currency)").eq("id", value.statementId).single();
    if (statementError || !statement) throw statementError ?? new Error("Card statement access denied");
    const account = Array.isArray(statement.accounts) ? statement.accounts[0] : statement.accounts;
    const { data: household } = await supabase.from("households").select("reporting_currency").eq("id", statement.household_id).single();
    if (!account || !household) throw new Error("Card statement access denied");
    const rates = account.currency === household.reporting_currency ? null : await getDailyExchangeRates();
    const reportingRate = account.currency === household.reporting_currency ? 1 : rates ? currencyRate(account.currency, household.reporting_currency, rates.copPerUnit) : null;
    if (reportingRate === null) throw new Error("Daily exchange rate unavailable");
    const { data, error } = await createAdminClient().rpc("record_card_payment", { actor_id: user.id, target_statement: value.statementId, payment_amount: value.amount, payment_date: value.paidOn, transaction_rate: reportingRate });
    if (error || !data) throw error ?? new Error("Card payment was not recorded"); revalidatePath("/"); return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function allocateGoal(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = goalAllocationSchema.parse(input); const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("allocate_goal", { actor_id: user.id, target_goal: value.goalId, allocation_amount: value.amount, allocation_date: value.allocatedOn, allocation_note: value.note ?? null });
    if (error || !data) throw error ?? new Error("Goal allocation was not created"); revalidatePath("/"); return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function recordDebtPayment(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = debtPaymentSchema.parse(input); const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("record_debt_payment", { actor_id: user.id, target_debt: value.debtId, source_account: value.accountId, payment_amount: value.amount, payment_date: value.paidOn, payment_visibility: value.visibility, payment_note: value.note ?? null });
    if (error || !data) throw error ?? new Error("Debt payment was not recorded"); revalidatePath("/"); return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function createBudgetEnvelope(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = budgetEnvelopeSchema.parse(input); const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("create_budget_envelope", { actor_id: user.id, target_budget: value.budgetId, envelope_name: value.name, allocated_amount: value.amount });
    if (error || !data) throw error ?? new Error("Budget envelope was not created"); revalidatePath("/"); return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function rolloverBudget(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = budgetRolloverSchema.parse(input); const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("rollover_budget", { actor_id: user.id, target_budget: value.budgetId, rollover_decision: value.decision });
    if (error || !data) throw error ?? new Error("Budget rollover was not saved"); revalidatePath("/"); return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function createHouseholdInvitation(input: unknown): Promise<ActionResult> {
  try {
    const value = invitationSchema.parse(input);
    const { user } = await authenticatedClient();
    const admin = createAdminClient();
    const { data: invitationId, error } = await admin.rpc("create_household_invitation", { actor_id: user.id, target_household: value.householdId, invite_email: value.email });
    if (error || !invitationId) throw error ?? new Error("Invitation was not created");
    const appUrl = process.env.APP_URL;
    if (!appUrl) throw new Error("Application URL is not configured");
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(value.email, { redirectTo: `${appUrl}/auth/callback?invite=${invitationId}` });
    if (inviteError) throw inviteError;
    revalidatePath("/");
    return {};
  } catch (error) { return actionError(error); }
}

export async function acceptHouseholdInvitation(invitationId: string): Promise<ActionResult<{ householdId: string }>> {
  try {
    const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("accept_household_invitation", { actor_id: user.id, invitation_id: uuidSchema.parse(invitationId) });
    if (error || !data) throw error ?? new Error("Invitation was not accepted");
    revalidatePath("/");
    return { data: { householdId: data } };
  } catch (error) { return actionError(error); }
}

export async function uploadReceipt(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const transactionId = uuidSchema.parse(formData.get("transactionId"));
    const file = formData.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error("Invalid receipt file");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detectedMime = detectReceiptMime(bytes);
    if (!detectedMime || detectedMime !== file.type) throw new Error("Receipt type does not match file contents");
    const { supabase, user } = await authenticatedClient();
    const { data: transaction, error: transactionError } = await supabase.from("transactions").select("id, household_id, visibility").eq("id", transactionId).single();
    if (transactionError || !transaction) throw transactionError ?? new Error("Transaction was not found");
    const extension = receiptExtension(detectedMime);
    const storagePath = `${transaction.household_id}/${user.id}/${crypto.randomUUID()}.${extension}`;
    const admin = createAdminClient();
    const { error: uploadError } = await admin.storage.from("receipts").upload(storagePath, bytes, { contentType: detectedMime, upsert: false });
    if (uploadError) throw uploadError;
    const { data: receiptId, error: receiptError } = await admin.rpc("register_receipt", {
      actor_id: user.id,
      target_transaction: transactionId,
      receipt_storage_path: storagePath,
      receipt_mime_type: detectedMime,
      receipt_size_bytes: file.size,
      receipt_original_filename: safeReceiptFilename(file.name),
    });
    if (receiptError || !receiptId) {
      await admin.storage.from("receipts").remove([storagePath]);
      throw receiptError ?? new Error("Receipt was not saved");
    }
    revalidatePath("/");
    return { data: { id: receiptId } };
  } catch (error) { return actionError(error); }
}

export async function deleteReceipt(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = receiptDeletionSchema.parse(input);
    const { user } = await authenticatedClient();
    const admin = createAdminClient();
    const { data: storagePath, error: archiveError } = await admin.rpc("archive_receipt", { actor_id: user.id, target_receipt: value.receiptId });
    if (archiveError || !storagePath) throw archiveError ?? new Error("Receipt was not archived");
    const { error: storageError } = await admin.storage.from("receipts").remove([storagePath]);
    if (storageError) {
      await admin.rpc("restore_receipt_after_storage_failure", { actor_id: user.id, target_receipt: value.receiptId });
      throw new Error("Receipt storage deletion failed");
    }
    revalidatePath("/");
    return { data: { id: value.receiptId } };
  } catch (error) { return actionError(error); }
}

export async function createAccountReconciliation(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = reconciliationSchema.parse(input);
    const { supabase, user } = await authenticatedClient();
    const { data: account, error: accountError } = await supabase.from("accounts").select("id,household_id,currency").eq("id", value.accountId).is("archived_at", null).single();
    if (accountError || !account) throw accountError ?? new Error("Reconciliation account access denied");
    const { data: household } = await supabase.from("households").select("reporting_currency").eq("id", account.household_id).single();
    if (!household) throw new Error("Reconciliation account access denied");
    const rates = account.currency === household.reporting_currency ? null : await getDailyExchangeRates(value.endingOn);
    const reportingRate = account.currency === household.reporting_currency ? 1 : rates ? currencyRate(account.currency, household.reporting_currency, rates.copPerUnit) : null;
    if (reportingRate === null) throw new Error("Daily exchange rate unavailable");
    const { data, error } = await createAdminClient().rpc("create_account_reconciliation", {
      actor_id: user.id,
      target_account: value.accountId,
      reconciliation_period_start: value.periodStart,
      reconciliation_ending_on: value.endingOn,
      reconciliation_statement_balance: value.statementBalance,
      create_adjustment: value.createAdjustment,
      transaction_rate: reportingRate,
      reconciliation_note: value.note ?? null,
    });
    if (error || !data) throw error ?? new Error("Reconciliation was not created");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error); }
}

export async function updateProfileLanguage(input: unknown): Promise<ActionResult> {
  try {
    const value = profileLanguageSchema.parse(input);
    const { supabase, user } = await authenticatedClient();
    const { error } = await supabase.from("profiles").update({ preferred_language: value.language }).eq("id", user.id);
    if (error) throw error;
    revalidatePath("/");
    return {};
  } catch (error) { return actionError(error); }
}

export async function voidOwnedExpense(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = voidExpenseSchema.parse(input);
    const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("void_owned_expense", {
      actor_id: user.id,
      target_transaction: value.transactionId,
    });
    if (error || !data) throw error ?? new Error("Expense was not removed");
    revalidatePath("/");
    return { data: { id: data } };
  } catch (error) { return actionError(error); }
}
