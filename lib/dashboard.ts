import "server-only";
import { createClient } from "./supabase/server";

export type DashboardData = {
  userName: string;
  household: { id: string; name: string; currency: string; taxRate: number } | null;
  accounts: Array<{ id: string; name: string; kind: string; currency: string; openingBalance: number; balance: number; visibility: "private" | "shared"; creditLimit: number | null }>;
  categories: Array<{ id: string; name: string; kind: "income" | "expense" }>;
  transactions: Array<{ id: string; occurredOn: string; kind: string; amount: number; currency: string; accountId: string; category: string | null; payee: string | null; visibility: "private" | "shared" }>;
  shoppingLists: Array<{ id: string; name: string; currency: string; visibility: "private" | "shared"; taxRate: number; status: string; discount: number; shipping: number; tip: number; items: Array<{ id: string; name: string; quantity: number; estimatedPrice: number; actualPrice: number | null; bought: boolean; taxRate: number | null; fixedTax: number | null; categoryId: string | null }> }>;
  goals: Array<{ id: string; name: string; target: number; current: number; currency: string; targetDate: string | null }>;
  debts: Array<{ id: string; creditor: string; balance: number; rate: number | null; minimum: number | null; currency: string }>;
  budgets: Array<{ id: string; month: string; amount: number; envelope: number; currency: string; category: string | null }>;
  recurring: Array<{ id: string; name: string; amount: number; currency: string; nextDueOn: string; kind: string }>;
};

const numeric = (value: unknown) => Number(value ?? 0);

export async function loadDashboard(): Promise<DashboardData | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: membership } = await supabase.from("household_members").select("household_id").limit(1).maybeSingle();
  if (!membership) return { userName: user.email?.split("@")[0] ?? "there", household: null, accounts: [], categories: [], transactions: [], shoppingLists: [], goals: [], debts: [], budgets: [], recurring: [] };
  const householdId = membership.household_id;
  const [householdResult, accountsResult, categoriesResult, transactionsResult, listsResult, goalsResult, debtsResult, budgetsResult, recurringResult, entriesResult] = await Promise.all([
    supabase.from("households").select("id,name,reporting_currency,default_tax_rate").eq("id", householdId).single(),
    supabase.from("accounts").select("id,name,kind,currency,opening_balance,visibility,credit_limit").eq("household_id", householdId).is("archived_at", null).order("name"),
    supabase.from("categories").select("id,name,kind").eq("household_id", householdId).order("name"),
    supabase.from("transactions").select("id,occurred_on,kind,amount,currency,account_id,visibility,payee,categories(name)").eq("household_id", householdId).order("occurred_on", { ascending: false }).limit(50),
    supabase.from("shopping_lists").select("id,name,currency,visibility,default_tax_rate,discount,shipping,tip,status,shopping_items(id,name,quantity,estimated_price,actual_price,bought,tax_rate,fixed_tax,category_id)").eq("household_id", householdId).order("created_at", { ascending: false }),
    supabase.from("goals").select("id,name,target_amount,current_amount,currency,target_date").eq("household_id", householdId).order("target_date"),
    supabase.from("debts").select("id,creditor,balance,interest_rate,minimum_payment,currency").eq("household_id", householdId).order("creditor"),
    supabase.from("budgets").select("id,month,amount,envelope_amount,currency,categories(name)").eq("household_id", householdId).order("month", { ascending: false }),
    supabase.from("recurring_rules").select("id,name,amount,currency,next_due_on,rule_kind").eq("household_id", householdId).eq("active", true).order("next_due_on"),
    supabase.from("ledger_entries").select("account_id,amount,transactions!inner(household_id)").eq("transactions.household_id", householdId),
  ]);
  const household = householdResult.data;
  const balances = new Map<string, number>();
  for (const entry of entriesResult.data ?? []) balances.set(entry.account_id, (balances.get(entry.account_id) ?? 0) + numeric(entry.amount));
  return {
    userName: user.email?.split("@")[0] ?? "there",
    household: household ? { id: household.id, name: household.name, currency: household.reporting_currency, taxRate: numeric(household.default_tax_rate) } : null,
    accounts: (accountsResult.data ?? []).map((row) => ({ id: row.id, name: row.name, kind: row.kind, currency: row.currency, openingBalance: numeric(row.opening_balance), balance: numeric(row.opening_balance) + (balances.get(row.id) ?? 0), visibility: row.visibility, creditLimit: row.credit_limit === null ? null : numeric(row.credit_limit) })),
    categories: (categoriesResult.data ?? []).map((row) => ({ id: row.id, name: row.name, kind: row.kind as "income" | "expense" })),
    transactions: (transactionsResult.data ?? []).map((row) => { const category = Array.isArray(row.categories) ? row.categories[0] : row.categories; return { id: row.id, occurredOn: row.occurred_on, kind: row.kind, amount: numeric(row.amount), currency: row.currency, accountId: row.account_id, category: (category as { name: string } | null)?.name ?? null, payee: row.payee, visibility: row.visibility }; }),
    shoppingLists: (listsResult.data ?? []).map((row) => ({ id: row.id, name: row.name, currency: row.currency, visibility: row.visibility, taxRate: numeric(row.default_tax_rate), discount: numeric(row.discount), shipping: numeric(row.shipping), tip: numeric(row.tip), status: row.status, items: (row.shopping_items ?? []).map((item) => ({ id: item.id, name: item.name, quantity: numeric(item.quantity), estimatedPrice: numeric(item.estimated_price), actualPrice: item.actual_price === null ? null : numeric(item.actual_price), bought: item.bought, taxRate: item.tax_rate === null ? null : numeric(item.tax_rate), fixedTax: item.fixed_tax === null ? null : numeric(item.fixed_tax), categoryId: item.category_id })) })),
    goals: (goalsResult.data ?? []).map((row) => ({ id: row.id, name: row.name, target: numeric(row.target_amount), current: numeric(row.current_amount), currency: row.currency, targetDate: row.target_date })),
    debts: (debtsResult.data ?? []).map((row) => ({ id: row.id, creditor: row.creditor, balance: numeric(row.balance), rate: row.interest_rate === null ? null : numeric(row.interest_rate), minimum: row.minimum_payment === null ? null : numeric(row.minimum_payment), currency: row.currency })),
    budgets: (budgetsResult.data ?? []).map((row) => { const category = Array.isArray(row.categories) ? row.categories[0] : row.categories; return { id: row.id, month: row.month, amount: numeric(row.amount), envelope: numeric(row.envelope_amount), currency: row.currency, category: (category as { name: string } | null)?.name ?? null }; }),
    recurring: (recurringResult.data ?? []).map((row) => ({ id: row.id, name: row.name, amount: numeric(row.amount), currency: row.currency, nextDueOn: row.next_due_on, kind: row.rule_kind })),
  };
}
