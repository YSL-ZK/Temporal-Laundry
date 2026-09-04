import "server-only";
import { createClient } from "./supabase/server";
import { bogotaDate, getDailyExchangeRates, type ExchangeRateSnapshot } from "./exchange-rates";
import { convertMoney } from "./money";
import { categoryWorkflowMetadataSchema, customTemplateMetadataSchema, type CategoryWorkflowMetadata, type CustomTemplateMetadata } from "./validation";

export type DashboardData = {
  asOf: string;
  aiConfigured: boolean;
  userName: string;
  language: "en" | "es";
  exchangeRates: ExchangeRateSnapshot | null;
  household: { id: string; name: string; currency: string; taxRate: number } | null;
  accounts: Array<{ id: string; name: string; kind: string; currency: string; openingBalance: number; balance: number; reportingBalance: number | null; exchangeRate: number | null; visibility: "private" | "shared"; creditLimit: number | null; statementBalance: number | null; paymentAccountId: string | null; closingDay: number | null; dueDay: number | null }>;
  cardStatements: Array<{ id: string; cardId: string; cardName: string; currency: string; periodStart: string; closingOn: string; dueOn: string; statementBalance: number; paidAmount: number; status: "open" | "paid" | "void"; visibility: "private" | "shared" }>;
  categories: Array<{ id: string; name: string; kind: "income" | "expense"; color: string | null }>;
  templates: Array<{ id: string; ownerId: string; name: string; categoryId: string; category: string; categoryKind: "income" | "expense"; visibility: "private" | "shared"; icon: string | null; description: string | null; version: number; isBuiltin: boolean; fields: Array<{ id: string; key: string; label: string; type: "text" | "number" | "currency" | "date" | "checkbox" | "select" | "multiselect" | "list" | "formula"; required: boolean; options: string[]; defaultValue: string | number | boolean | string[] | null; formula: string | null; amountPrefill: boolean; sortOrder: number }> }>;
  payees: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string; color: string }>;
  transactions: Array<{ id: string; occurredOn: string; createdAt: string; kind: string; status: string; amount: number; currency: string; reportingExchangeRate: number; accountId: string; account: string | null; transferAccountId: string | null; transferAccount: string | null; categoryId: string | null; category: string | null; payeeId: string | null; payee: string | null; note: string | null; visibility: "private" | "shared"; ownedByUser: boolean; correctable: boolean; correctsTransactionId: string | null; correctionReason: string | null; workflow: CategoryWorkflowMetadata | null; customTemplate: CustomTemplateMetadata | null; tags: Array<{ id: string; name: string; color: string }>; items: Array<{ id: string; name: string; quantity: number; unitPrice: number; discount: number; tax: number }> }>;
  drafts: Array<{ id: string; accountId: string; account: string; transferAccountId: string | null; transferAccount: string | null; categoryId: string | null; category: string | null; payeeId: string | null; payee: string | null; tagIds: string[]; kind: "income" | "expense" | "transfer" | "adjustment"; amount: number; currency: string; occurredOn: string; visibility: "private" | "shared"; note: string | null; createdAt: string; updatedAt: string }>;
  ownedExpenses: Array<{ id: string; occurredOn: string; amount: number; currency: string; account: string; category: string | null; payee: string | null; visibility: "private" | "shared" }>;
  reportTransactions: Array<{ occurredOn: string; kind: "income" | "expense"; amount: number; currency: string; reportingExchangeRate: number; accountId: string; categoryId: string | null; category: string | null }>;
  reportAccounts: Array<{ id: string; name: string; currency: string; openingBalance: number; trackingStartedOn: string; archivedAt: string | null }>;
  reportEntries: Array<{ accountId: string; amount: number; occurredOn: string }>;
  reportRates: Array<{ valuationDate: string; currency: "COP" | "USD" | "EUR"; copPerUnit: number }>;
  reportDataTruncated: boolean;
  shoppingLists: Array<{ id: string; name: string; currency: string; visibility: "private" | "shared"; taxRate: number; status: string; discount: number; shipping: number; tip: number; items: Array<{ id: string; name: string; quantity: number; estimatedPrice: number; actualPrice: number | null; bought: boolean; taxRate: number | null; fixedTax: number | null; categoryId: string | null }> }>;
  goals: Array<{ id: string; name: string; target: number; current: number; currency: string; targetDate: string | null; visibility: "private" | "shared" }>;
  goalAllocations: Array<{ id: string; goalId: string; amount: number; allocatedOn: string; note: string | null }>;
  debts: Array<{ id: string; creditor: string; direction: "payable" | "receivable"; balance: number; reportingBalance: number | null; rate: number | null; minimum: number | null; currency: string; accountId: string | null; dueDay: number | null; visibility: "private" | "shared"; trackingStartedOn: string }>;
  debtPayments: Array<{ debtId: string; amount: number; paidOn: string }>;
  budgets: Array<{ id: string; month: string; baseAmount: number; rolloverAmount: number; amount: number; envelope: number; spent: number; currency: string; category: string | null; categoryId: string | null; visibility: "private" | "shared"; rolloverDecision: "reset" | "carry_surplus" | "carry_balance" | null; rolledToBudgetId: string | null; envelopes: Array<{ id: string; name: string; amount: number }> }>;
  recurring: Array<{ id: string; name: string; amount: number; currency: string; nextDueOn: string; kind: string; accountId: string; categoryId: string | null; visibility: "private" | "shared" }>;
  recurringOccurrences: Array<{ id: string; ruleId: string; name: string; amount: number; currency: string; dueOn: string; status: "projected" | "confirmed" | "skipped"; kind: string; accountId: string; provider: string | null; visibility: "private" | "shared" }>;
  receipts: Array<{ id: string; transactionId: string; filename: string; mimeType: string; sizeBytes: number; createdAt: string; occurredOn: string; amount: number; currency: string; payee: string | null; category: string | null; account: string | null; visibility: "private" | "shared"; ownedByUser: boolean }>;
  reconciliations: Array<{ id: string; accountId: string; account: string; currency: string; periodStart: string; endingOn: string; statementBalance: number; ledgerBalance: number; discrepancy: number; status: "balanced" | "discrepancy" | "adjusted"; matchedEntryCount: number; reconciledAt: string; note: string | null }>;
};

const numeric = (value: unknown) => Number(value ?? 0);

export async function loadDashboard(): Promise<DashboardData | null> {
  const asOf = bogotaDate();
  const aiConfigured = Boolean(process.env.GROQ_API_KEY?.trim());
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: membership } = await supabase.from("household_members").select("household_id").limit(1).maybeSingle();
  if (!membership) return { asOf, aiConfigured, userName: user.email?.split("@")[0] ?? "there", language: "en", exchangeRates: null, household: null, accounts: [], cardStatements: [], categories: [], templates: [], payees: [], tags: [], transactions: [], drafts: [], ownedExpenses: [], reportTransactions: [], reportAccounts: [], reportEntries: [], reportRates: [], reportDataTruncated: false, shoppingLists: [], goals: [], goalAllocations: [], debts: [], debtPayments: [], budgets: [], recurring: [], recurringOccurrences: [], receipts: [], reconciliations: [] };
  const householdId = membership.household_id;
  const reportingStart = new Date();
  reportingStart.setUTCMonth(reportingStart.getUTCMonth() - 11, 1);
  const rateHistoryStart = new Date(reportingStart);
  rateHistoryStart.setUTCDate(rateHistoryStart.getUTCDate() - 31);
  const calendarEnd = new Date(`${asOf}T12:00:00Z`); calendarEnd.setUTCDate(calendarEnd.getUTCDate() + 120);
  const calendarStart = new Date(`${asOf}T12:00:00Z`); calendarStart.setUTCDate(calendarStart.getUTCDate() - 31);
  const debtPaymentStart = reportingStart.toISOString().slice(0, 10);
  const allocationStart = new Date(`${asOf}T12:00:00Z`); allocationStart.setUTCFullYear(allocationStart.getUTCFullYear() - 1);
  const [profileResult, householdResult, accountsResult, reportAccountsResult, cardSettingsResult, cardStatementsResult, categoriesResult, templatesResult, payeesResult, tagsResult, transactionsResult, transactionDraftsResult, ownedExpensesResult, reportTransactionsResult, listsResult, goalsResult, goalAllocationsResult, debtsResult, debtPaymentsResult, budgetsResult, budgetRolloversResult, recurringResult, occurrencesResult, receiptsResult, reconciliationsResult, entriesResult, reportRatesResult, exchangeRates] = await Promise.all([
    supabase.from("profiles").select("display_name,preferred_language").eq("id", user.id).single(),
    supabase.from("households").select("id,name,reporting_currency,default_tax_rate").eq("id", householdId).single(),
    supabase.from("accounts").select("id,name,kind,currency,opening_balance,visibility,credit_limit,closing_day,due_day").eq("household_id", householdId).is("archived_at", null).order("name"),
    supabase.from("accounts").select("id,name,currency,opening_balance,tracking_started_on,archived_at").eq("household_id", householdId).order("name"),
    supabase.from("card_settings").select("account_id,payment_account_id,statement_balance"),
    supabase.from("card_statements").select("id,account_id,period_start,closing_on,due_on,statement_balance,paid_amount,status,visibility,accounts!inner(name,currency)").eq("household_id", householdId).order("due_on", { ascending: false }).limit(100),
    supabase.from("categories").select("id,name,kind,color").eq("household_id", householdId).order("name"),
    supabase.from("category_templates").select("id,owner_id,name,category_id,visibility,icon,description,version,is_builtin,categories!inner(name,kind),template_fields(id,key,label,field_type,required,options,default_value,formula,amount_prefill,sort_order)").eq("household_id", householdId).order("name"),
    supabase.from("payees").select("id,name").eq("household_id", householdId).order("name"),
    supabase.from("tags").select("id,name,color").eq("household_id", householdId).order("name"),
    supabase.from("transactions").select("id,owner_id,occurred_on,created_at,kind,status,amount,currency,reporting_exchange_rate,account_id,transfer_account_id,category_id,visibility,payee,payee_id,note,metadata,shopping_list_id,corrects_transaction_id,correction_reason,categories(name),accounts!transactions_account_id_fkey(name),transfer_accounts:accounts!transactions_transfer_account_id_fkey(name),transaction_tags(tags(id,name,color)),transaction_items(id,name,quantity,unit_price,discount,tax)").eq("household_id", householdId).eq("status", "posted").is("voided_at", null).order("occurred_on", { ascending: false }).limit(50),
    supabase.from("transaction_drafts").select("id,account_id,transfer_account_id,category_id,payee_id,tag_ids,kind,amount,currency,occurred_on,visibility,payee,note,created_at,updated_at,accounts!transaction_drafts_account_id_fkey(name),transfer_accounts:accounts!transaction_drafts_transfer_account_id_fkey(name),categories(name)").eq("household_id", householdId).order("updated_at", { ascending: false }).limit(50),
    supabase.from("transactions").select("id,occurred_on,amount,currency,visibility,payee,categories(name),accounts(name)").eq("household_id", householdId).eq("owner_id", user.id).eq("kind", "expense").eq("status", "posted").is("voided_at", null).order("occurred_on", { ascending: false }).limit(100),
    supabase.from("transactions").select("occurred_on,kind,amount,currency,reporting_exchange_rate,account_id,category_id,categories(name)").eq("household_id", householdId).eq("status", "posted").is("voided_at", null).in("kind", ["income", "expense"]).gte("occurred_on", reportingStart.toISOString().slice(0, 10)).order("occurred_on").limit(5001),
    supabase.from("shopping_lists").select("id,name,currency,visibility,default_tax_rate,discount,shipping,tip,status,shopping_items(id,name,quantity,estimated_price,actual_price,bought,tax_rate,fixed_tax,category_id)").eq("household_id", householdId).order("created_at", { ascending: false }),
    supabase.from("goals").select("id,name,target_amount,current_amount,currency,target_date,visibility").eq("household_id", householdId).order("target_date"),
    supabase.from("goal_allocations").select("id,goal_id,amount,allocated_on,note").gte("allocated_on", allocationStart.toISOString().slice(0, 10)).order("allocated_on", { ascending: false }).limit(2000),
    supabase.from("debts").select("id,creditor,direction,balance,interest_rate,minimum_payment,currency,account_id,due_day,visibility,tracking_started_on").eq("household_id", householdId).order("creditor"),
    supabase.from("debt_payments").select("debt_id,amount,paid_on").gte("paid_on", debtPaymentStart).order("paid_on", { ascending: false }).limit(1000),
    supabase.from("budgets").select("id,owner_id,month,amount,envelope_amount,currency,visibility,category_id,categories(name),budget_envelopes(id,name,allocated_amount)").eq("household_id", householdId).order("month", { ascending: false }),
    supabase.from("budget_rollovers").select("source_budget_id,target_budget_id,decision,amount,source_spent").eq("household_id", householdId),
    supabase.from("recurring_rules").select("id,name,amount,currency,next_due_on,rule_kind,account_id,category_id,visibility").eq("household_id", householdId).eq("active", true).order("next_due_on"),
    supabase.from("recurring_occurrences").select("id,rule_id,due_on,status,amount,recurring_rules!inner(household_id,name,currency,rule_kind,account_id,provider,visibility)").eq("recurring_rules.household_id", householdId).gte("due_on", calendarStart.toISOString().slice(0, 10)).lte("due_on", calendarEnd.toISOString().slice(0, 10)).order("due_on").limit(1000),
    supabase.from("receipts").select("id,owner_id,transaction_id,mime_type,size_bytes,original_filename,created_at,visibility,transactions!inner(occurred_on,amount,currency,payee,categories(name),accounts(name))").eq("household_id", householdId).order("created_at", { ascending: false }).limit(100),
    supabase.from("reconciliations").select("id,account_id,period_start,statement_ending_on,statement_ending_balance,ledger_balance,discrepancy,status,matched_entry_count,reconciled_at,note,accounts!inner(name,currency)").eq("household_id", householdId).order("statement_ending_on", { ascending: false }).limit(100),
    supabase.from("ledger_entries").select("account_id,amount,transactions!inner(household_id,status,voided_at,occurred_on)").eq("transactions.household_id", householdId).eq("transactions.status", "posted").is("transactions.voided_at", null).limit(5001),
    supabase.from("daily_exchange_rates").select("valuation_date,currency,cop_per_unit").gte("valuation_date", rateHistoryStart.toISOString().slice(0, 10)).lte("valuation_date", asOf).order("valuation_date").limit(5000),
    getDailyExchangeRates(asOf),
  ]);
  const earliestBudgetMonth = (budgetsResult.data ?? []).reduce<string | null>((earliest, budget) => !earliest || budget.month < earliest ? budget.month : earliest, null);
  const { data: budgetExpenseRows } = earliestBudgetMonth
    ? await supabase.from("transactions").select("amount,occurred_on,category_id,currency,owner_id,visibility").eq("household_id", householdId).eq("kind", "expense").eq("status", "posted").is("voided_at", null).gte("occurred_on", earliestBudgetMonth).limit(5000)
    : { data: [] as Array<{ amount: unknown; occurred_on: string; category_id: string | null; currency: string; owner_id: string; visibility: "private" | "shared" }> };
  const household = householdResult.data;
  const profile = profileResult.data;
  const balances = new Map<string, number>();
  for (const entry of entriesResult.data ?? []) balances.set(entry.account_id, (balances.get(entry.account_id) ?? 0) + numeric(entry.amount));
  const cardSettings = new Map((cardSettingsResult.data ?? []).map((settings) => [settings.account_id, settings]));
  const tagsById = new Map((tagsResult.data ?? []).map((tag) => [tag.id, tag]));
  const incomingRollovers = new Map<string, number>();
  const outgoingRollovers = new Map((budgetRolloversResult.data ?? []).map((rollover) => [rollover.source_budget_id, rollover]));
  for (const rollover of budgetRolloversResult.data ?? []) incomingRollovers.set(rollover.target_budget_id, (incomingRollovers.get(rollover.target_budget_id) ?? 0) + numeric(rollover.amount));
  return {
    asOf,
    aiConfigured,
    userName: profile?.display_name || user.email?.split("@")[0] || "there",
    language: profile?.preferred_language === "es" ? "es" : "en",
    exchangeRates,
    household: household ? { id: household.id, name: household.name, currency: household.reporting_currency, taxRate: numeric(household.default_tax_rate) } : null,
    accounts: (accountsResult.data ?? []).map((row) => {
      const balance = numeric(row.opening_balance) + (balances.get(row.id) ?? 0);
      const reportingBalance = household
        ? convertMoney(balance, row.currency, household.reporting_currency, exchangeRates?.copPerUnit ?? {})
        : null;
      const exchangeRate = household
        ? convertMoney(1, row.currency, household.reporting_currency, exchangeRates?.copPerUnit ?? {})
        : null;
      const settings = cardSettings.get(row.id);
      return { id: row.id, name: row.name, kind: row.kind, currency: row.currency, openingBalance: numeric(row.opening_balance), balance, reportingBalance, exchangeRate, visibility: row.visibility, creditLimit: row.credit_limit === null ? null : numeric(row.credit_limit), statementBalance: settings ? numeric(settings.statement_balance) : null, paymentAccountId: settings?.payment_account_id ?? null, closingDay: row.closing_day, dueDay: row.due_day };
    }),
    cardStatements: (cardStatementsResult.data ?? []).map((row) => { const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts; return { id: row.id, cardId: row.account_id, cardName: account?.name ?? "Card", currency: account?.currency ?? "COP", periodStart: row.period_start, closingOn: row.closing_on, dueOn: row.due_on, statementBalance: numeric(row.statement_balance), paidAmount: numeric(row.paid_amount), status: row.status as "open" | "paid" | "void", visibility: row.visibility }; }),
    categories: (categoriesResult.data ?? []).map((row) => ({ id: row.id, name: row.name, kind: row.kind as "income" | "expense", color: row.color })),
    templates: (templatesResult.data ?? []).map((row) => {
      const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
      return {
        id: row.id, ownerId: row.owner_id, name: row.name, categoryId: row.category_id,
        category: category?.name ?? "Category", categoryKind: (category?.kind === "income" ? "income" : "expense") as "income" | "expense",
        visibility: row.visibility, icon: row.icon, description: row.description, version: row.version,
        isBuiltin: row.is_builtin,
        fields: [...(row.template_fields ?? [])].sort((left, right) => left.sort_order - right.sort_order).map((field) => ({
          id: field.id, key: field.key, label: field.label,
          type: field.field_type as "text" | "number" | "currency" | "date" | "checkbox" | "select" | "multiselect" | "list" | "formula",
          required: field.required, options: Array.isArray(field.options) ? field.options.filter((option): option is string => typeof option === "string") : [],
          defaultValue: typeof field.default_value === "string" || typeof field.default_value === "number" || typeof field.default_value === "boolean" || (Array.isArray(field.default_value) && field.default_value.every((item) => typeof item === "string")) ? field.default_value : null,
          formula: field.formula, amountPrefill: field.amount_prefill, sortOrder: field.sort_order,
        })),
      };
    }),
    payees: (payeesResult.data ?? []).map((row) => ({ id: row.id, name: row.name })),
    tags: (tagsResult.data ?? []).map((row) => ({ id: row.id, name: row.name, color: row.color ?? "#7dd3a7" })),
    transactions: (transactionsResult.data ?? []).map((row) => {
      const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
      const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
      const transferAccount = Array.isArray(row.transfer_accounts) ? row.transfer_accounts[0] : row.transfer_accounts;
      const tags = (row.transaction_tags ?? []).flatMap((link) => {
        const tag = Array.isArray(link.tags) ? link.tags[0] : link.tags;
        return tag ? [{ id: tag.id, name: tag.name, color: tag.color ?? "#7dd3a7" }] : [];
      });
      return {
        id: row.id, occurredOn: row.occurred_on, createdAt: row.created_at, kind: row.kind, status: row.status,
        amount: numeric(row.amount), currency: row.currency, reportingExchangeRate: numeric(row.reporting_exchange_rate),
        accountId: row.account_id, account: (account as { name: string } | null)?.name ?? null,
        transferAccountId: row.transfer_account_id, transferAccount: (transferAccount as { name: string } | null)?.name ?? null,
        categoryId: row.category_id, category: (category as { name: string } | null)?.name ?? null,
        payeeId: row.payee_id, payee: row.payee, note: row.note, visibility: row.visibility,
        ownedByUser: row.owner_id === user.id,
        correctable: row.owner_id === user.id && row.kind !== "transfer" && row.shopping_list_id === null && Object.keys(row.metadata ?? {}).length === 0 && (row.transaction_items ?? []).length === 0,
        correctsTransactionId: row.corrects_transaction_id, correctionReason: row.correction_reason, tags,
        workflow: categoryWorkflowMetadataSchema.safeParse(row.metadata).data ?? null,
        customTemplate: customTemplateMetadataSchema.safeParse(row.metadata).data ?? null,
        items: (row.transaction_items ?? []).map((item) => ({ id: item.id, name: item.name, quantity: numeric(item.quantity), unitPrice: numeric(item.unit_price), discount: numeric(item.discount), tax: numeric(item.tax) })),
      };
    }),
    drafts: (transactionDraftsResult.data ?? []).map((row) => {
      const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
      const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
      const transferAccount = Array.isArray(row.transfer_accounts) ? row.transfer_accounts[0] : row.transfer_accounts;
      return {
        id: row.id, accountId: row.account_id, account: account?.name ?? "Account",
        transferAccountId: row.transfer_account_id, transferAccount: transferAccount?.name ?? null,
        categoryId: row.category_id, category: category?.name ?? null, payeeId: row.payee_id,
        payee: row.payee, tagIds: (row.tag_ids ?? []).filter((tagId: string) => tagsById.has(tagId)),
        kind: row.kind as "income" | "expense" | "transfer" | "adjustment", amount: numeric(row.amount),
        currency: row.currency, occurredOn: row.occurred_on, visibility: row.visibility,
        note: row.note, createdAt: row.created_at, updatedAt: row.updated_at,
      };
    }),
    ownedExpenses: (ownedExpensesResult.data ?? []).map((row) => {
      const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
      const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
      return { id: row.id, occurredOn: row.occurred_on, amount: numeric(row.amount), currency: row.currency, account: (account as { name: string } | null)?.name ?? "Account", category: (category as { name: string } | null)?.name ?? null, payee: row.payee, visibility: row.visibility };
    }),
    reportTransactions: (reportTransactionsResult.data ?? []).slice(0, 5000).map((row) => { const category = Array.isArray(row.categories) ? row.categories[0] : row.categories; return { occurredOn: row.occurred_on, kind: row.kind as "income" | "expense", amount: numeric(row.amount), currency: row.currency, reportingExchangeRate: numeric(row.reporting_exchange_rate), accountId: row.account_id, categoryId: row.category_id, category: (category as { name: string } | null)?.name ?? null }; }),
    reportAccounts: (reportAccountsResult.data ?? []).map((row) => ({ id: row.id, name: row.name, currency: row.currency, openingBalance: numeric(row.opening_balance), trackingStartedOn: row.tracking_started_on, archivedAt: row.archived_at })),
    reportEntries: (entriesResult.data ?? []).slice(0, 5000).flatMap((row) => {
      const transaction = Array.isArray(row.transactions) ? row.transactions[0] : row.transactions;
      return transaction ? [{ accountId: row.account_id, amount: numeric(row.amount), occurredOn: transaction.occurred_on }] : [];
    }),
    reportRates: (reportRatesResult.data ?? []).flatMap((row) => ["COP", "USD", "EUR"].includes(row.currency) ? [{ valuationDate: row.valuation_date, currency: row.currency as "COP" | "USD" | "EUR", copPerUnit: numeric(row.cop_per_unit) }] : []),
    reportDataTruncated: (reportTransactionsResult.data?.length ?? 0) > 5000 || (entriesResult.data?.length ?? 0) > 5000,
    shoppingLists: (listsResult.data ?? []).map((row) => ({ id: row.id, name: row.name, currency: row.currency, visibility: row.visibility, taxRate: numeric(row.default_tax_rate), discount: numeric(row.discount), shipping: numeric(row.shipping), tip: numeric(row.tip), status: row.status, items: (row.shopping_items ?? []).map((item) => ({ id: item.id, name: item.name, quantity: numeric(item.quantity), estimatedPrice: numeric(item.estimated_price), actualPrice: item.actual_price === null ? null : numeric(item.actual_price), bought: item.bought, taxRate: item.tax_rate === null ? null : numeric(item.tax_rate), fixedTax: item.fixed_tax === null ? null : numeric(item.fixed_tax), categoryId: item.category_id })) })),
    goals: (goalsResult.data ?? []).map((row) => ({ id: row.id, name: row.name, target: numeric(row.target_amount), current: numeric(row.current_amount), currency: row.currency, targetDate: row.target_date, visibility: row.visibility })),
    goalAllocations: (goalAllocationsResult.data ?? []).map((row) => ({ id: row.id, goalId: row.goal_id, amount: numeric(row.amount), allocatedOn: row.allocated_on, note: row.note })),
    debts: (debtsResult.data ?? []).map((row) => ({
      id: row.id,
      creditor: row.creditor,
      direction: row.direction === "receivable" ? "receivable" : "payable",
      balance: numeric(row.balance),
      reportingBalance: household ? convertMoney(numeric(row.balance), row.currency, household.reporting_currency, exchangeRates?.copPerUnit ?? {}) : null,
      rate: row.interest_rate === null ? null : numeric(row.interest_rate),
      minimum: row.minimum_payment === null ? null : numeric(row.minimum_payment),
      currency: row.currency,
      accountId: row.account_id,
      dueDay: row.due_day,
      visibility: row.visibility,
      trackingStartedOn: row.tracking_started_on,
    })),
    debtPayments: (debtPaymentsResult.data ?? []).map((row) => ({ debtId: row.debt_id, amount: numeric(row.amount), paidOn: row.paid_on })),
    budgets: (budgetsResult.data ?? []).map((row) => {
      const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
      const spent = (budgetExpenseRows ?? []).filter((expense) => expense.occurred_on.startsWith(row.month.slice(0, 7)) && (!row.category_id || expense.category_id === row.category_id) && expense.currency === row.currency && (row.visibility === "shared" ? expense.visibility === "shared" : expense.owner_id === row.owner_id)).reduce((sum, expense) => sum + numeric(expense.amount), 0);
      const baseAmount = numeric(row.amount);
      const rolloverAmount = incomingRollovers.get(row.id) ?? 0;
      const outgoing = outgoingRollovers.get(row.id);
      const rolloverDecision = outgoing && ["reset", "carry_surplus", "carry_balance"].includes(outgoing.decision) ? outgoing.decision as "reset" | "carry_surplus" | "carry_balance" : null;
      return { id: row.id, month: row.month, baseAmount, rolloverAmount, amount: baseAmount + rolloverAmount, envelope: numeric(row.envelope_amount), spent, currency: row.currency, category: (category as { name: string } | null)?.name ?? null, categoryId: row.category_id, visibility: row.visibility, rolloverDecision, rolledToBudgetId: outgoing?.target_budget_id ?? null, envelopes: (row.budget_envelopes ?? []).map((envelope) => ({ id: envelope.id, name: envelope.name, amount: numeric(envelope.allocated_amount) })) };
    }),
    recurring: (recurringResult.data ?? []).map((row) => ({ id: row.id, name: row.name, amount: numeric(row.amount), currency: row.currency, nextDueOn: row.next_due_on, kind: row.rule_kind, accountId: row.account_id, categoryId: row.category_id, visibility: row.visibility })),
    recurringOccurrences: (occurrencesResult.data ?? []).map((row) => { const rule = Array.isArray(row.recurring_rules) ? row.recurring_rules[0] : row.recurring_rules; return { id: row.id, ruleId: row.rule_id, name: rule?.name ?? "Scheduled item", amount: numeric(row.amount), currency: rule?.currency ?? "COP", dueOn: row.due_on, status: row.status as "projected" | "confirmed" | "skipped", kind: rule?.rule_kind ?? "bill", accountId: rule?.account_id ?? "", provider: rule?.provider ?? null, visibility: rule?.visibility ?? "private" }; }),
    receipts: (receiptsResult.data ?? []).map((row) => {
      const transaction = Array.isArray(row.transactions) ? row.transactions[0] : row.transactions;
      const category = transaction ? (Array.isArray(transaction.categories) ? transaction.categories[0] : transaction.categories) : null;
      const account = transaction ? (Array.isArray(transaction.accounts) ? transaction.accounts[0] : transaction.accounts) : null;
      return { id: row.id, transactionId: row.transaction_id ?? "", filename: row.original_filename ?? "receipt", mimeType: row.mime_type ?? "application/octet-stream", sizeBytes: numeric(row.size_bytes), createdAt: row.created_at, occurredOn: transaction?.occurred_on ?? row.created_at.slice(0, 10), amount: numeric(transaction?.amount), currency: transaction?.currency ?? "COP", payee: transaction?.payee ?? null, category: category?.name ?? null, account: account?.name ?? null, visibility: row.visibility, ownedByUser: row.owner_id === user.id };
    }),
    reconciliations: (reconciliationsResult.data ?? []).map((row) => {
      const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
      return { id: row.id, accountId: row.account_id, account: account?.name ?? "Account", currency: account?.currency ?? "COP", periodStart: row.period_start, endingOn: row.statement_ending_on, statementBalance: numeric(row.statement_ending_balance), ledgerBalance: numeric(row.ledger_balance), discrepancy: numeric(row.discrepancy), status: row.status as "balanced" | "discrepancy" | "adjusted", matchedEntryCount: row.matched_entry_count ?? 0, reconciledAt: row.reconciled_at, note: row.note };
    }),
  };
}
