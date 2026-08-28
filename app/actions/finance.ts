"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "../../lib/supabase/admin";
import { createClient } from "../../lib/supabase/server";
import { accountSchema, budgetEnvelopeSchema, budgetSchema, categorySchema, debtPaymentSchema, debtSchema, goalAllocationSchema, goalSchema, householdSchema, invitationSchema, profileLanguageSchema, recurringConfirmSchema, recurringSchema, shoppingCheckoutSchema, shoppingItemSchema, shoppingListSchema, transactionSchema, uuidSchema, voidExpenseSchema } from "../../lib/validation";

type ActionResult<T = void> = { data?: T; error?: string };

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error?.message.toLowerCase().includes("invalid api key")) throw new Error("Supabase browser connection is invalid");
  if (!user) throw new Error("Sign in to continue");
  return { supabase, user };
}

function actionError(error: unknown): { error: string } {
  const diagnostic = typeof error === "object" && error !== null
    ? { name: "name" in error ? String(error.name) : "Error", code: "code" in error ? String(error.code) : undefined }
    : { name: "Error" };
  console.error("finance action failed", diagnostic);
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message).toLowerCase() : "";
  if (message.includes("invalid api key") || message.includes("server-side finance operations") || message.includes("supabase browser connection")) {
    return { error: "This deployment is not connected to Supabase correctly. Its administrator must add a valid server secret in Vercel and redeploy." };
  }
  return { error: "We couldn't complete that request. Please try again." };
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
    const { supabase, user } = await authenticatedClient();
    const { data: account, error } = await supabase.from("accounts").insert({
      household_id: value.householdId, owner_id: user.id, visibility: value.visibility, name: value.name,
      kind: value.kind, currency: value.currency, opening_balance: value.openingBalance,
      credit_limit: value.kind === "card" ? value.creditLimit ?? null : null,
      closing_day: value.kind === "card" ? value.closingDay ?? null : null,
      due_day: value.kind === "card" ? value.dueDay ?? null : null,
    }).select("id").single();
    if (error || !account) throw error ?? new Error("Account was not created");
    if (value.kind === "card" && value.closingDay && value.dueDay) {
      const { error: settingsError } = await supabase.from("card_settings").insert({
        account_id: account.id, payment_account_id: value.paymentAccountId ?? null, closing_day: value.closingDay, due_day: value.dueDay,
      });
      if (settingsError) throw settingsError;
    }
    revalidatePath("/");
    return { data: account };
  } catch (error) { return actionError(error); }
}

export async function postTransaction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = transactionSchema.parse(input);
    const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("post_transaction", {
      actor_id: user.id, target_household: value.householdId, source_account: value.accountId, target_account: value.transferAccountId ?? null,
      target_category: value.categoryId ?? null, transaction_kind: value.kind, transaction_amount: value.amount,
      transaction_currency: value.currency, transaction_rate: value.reportingExchangeRate, transaction_date: value.occurredOn,
      transaction_visibility: value.visibility, transaction_payee: value.payee ?? null, transaction_note: value.note ?? null,
      transaction_items: value.items.map((item) => ({ categoryId: item.categoryId ?? null, name: item.name, quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount, tax: item.tax })),
    });
    if (error || !data) throw error ?? new Error("Transaction was not posted");
    revalidatePath("/");
    return { data: { id: data } };
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
    const { data, error } = await supabase.from("debts").insert({ household_id: value.householdId, owner_id: user.id, visibility: value.visibility, creditor: value.creditor, balance: value.balance, currency: value.currency, interest_rate: value.interestRate ?? null, minimum_payment: value.minimumPayment ?? null, due_day: value.dueDay ?? null, account_id: value.accountId ?? null }).select("id").single();
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
    const { data, error } = await supabase.from("recurring_rules").insert({ household_id: value.householdId, owner_id: user.id, visibility: value.visibility, account_id: value.accountId, category_id: value.categoryId ?? null, name: value.name, amount: value.amount, currency: value.currency, cadence: value.cadence, next_due_on: value.nextDueOn, rule_kind: value.ruleKind }).select("id").single();
    if (error || !data) throw error ?? new Error("Recurring rule was not created"); revalidatePath("/"); return { data };
  } catch (error) { return actionError(error); }
}

export async function confirmRecurringRule(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const value = recurringConfirmSchema.parse(input); const { user } = await authenticatedClient();
    const { data, error } = await createAdminClient().rpc("confirm_recurring_rule", { actor_id: user.id, target_rule: value.ruleId, payment_date: value.paidOn });
    if (error || !data) throw error ?? new Error("Recurring item was not confirmed"); revalidatePath("/"); return { data: { id: data } };
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
    if (!(file instanceof File) || file.size < 1 || file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) throw new Error("Invalid receipt file");
    const { supabase, user } = await authenticatedClient();
    const { data: transaction, error: transactionError } = await supabase.from("transactions").select("id, household_id, visibility").eq("id", transactionId).single();
    if (transactionError || !transaction) throw transactionError ?? new Error("Transaction was not found");
    const extension = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
    const storagePath = `${transaction.household_id}/${user.id}/${crypto.randomUUID()}.${extension}`;
    const admin = createAdminClient();
    const { error: uploadError } = await admin.storage.from("receipts").upload(storagePath, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { data: receipt, error: receiptError } = await supabase.from("receipts").insert({ household_id: transaction.household_id, owner_id: user.id, visibility: transaction.visibility, transaction_id: transactionId, storage_path: storagePath, mime_type: file.type, size_bytes: file.size }).select("id").single();
    if (receiptError || !receipt) {
      await admin.storage.from("receipts").remove([storagePath]);
      throw receiptError ?? new Error("Receipt was not saved");
    }
    revalidatePath("/");
    return { data: receipt };
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
