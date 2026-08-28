import { z } from "zod";

export const visibilitySchema = z.enum(["private", "shared"]);
export const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a three-letter currency code");
export const moneySchema = z.coerce.number().finite().min(0).max(999_999_999_999);
export const uuidSchema = z.string().uuid();
export const languageSchema = z.enum(["en", "es"]);

export const accountSchema = z.object({
  householdId: uuidSchema,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["cash", "bank", "card", "savings", "loan"]),
  currency: currencySchema,
  openingBalance: z.coerce.number().finite().min(-999_999_999_999).max(999_999_999_999).default(0),
  visibility: visibilitySchema,
  creditLimit: moneySchema.optional(),
  paymentAccountId: uuidSchema.optional(),
  closingDay: z.coerce.number().int().min(1).max(31).optional(),
  dueDay: z.coerce.number().int().min(1).max(31).optional(),
});

export const transactionSchema = z.object({
  householdId: uuidSchema,
  accountId: uuidSchema,
  transferAccountId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  payeeId: uuidSchema.optional(),
  tagIds: z.array(uuidSchema).max(12).default([]),
  kind: z.enum(["income", "expense", "transfer", "adjustment"]),
  amount: moneySchema.positive(),
  currency: currencySchema,
  reportingExchangeRate: z.coerce.number().finite().positive().max(1_000_000).default(1),
  occurredOn: z.string().date(),
  payee: z.string().trim().max(120).optional(),
  note: z.string().trim().max(2_000).optional(),
  visibility: visibilitySchema,
  items: z.array(z.object({
    name: z.string().trim().min(1).max(160),
    quantity: z.coerce.number().positive().max(1_000_000).default(1),
    unitPrice: moneySchema,
    discount: moneySchema.default(0),
    tax: moneySchema.default(0),
    categoryId: uuidSchema.optional(),
  })).max(250).default([]),
});

export const shoppingListSchema = z.object({
  householdId: uuidSchema,
  name: z.string().trim().min(1).max(100),
  currency: currencySchema,
  visibility: visibilitySchema,
  defaultTaxRate: z.coerce.number().min(0).max(100).default(0),
});

export const shoppingItemSchema = z.object({
  listId: uuidSchema,
  categoryId: uuidSchema.optional(),
  name: z.string().trim().min(1).max(160),
  quantity: z.coerce.number().finite().positive().max(1_000_000).default(1),
  estimatedPrice: moneySchema,
  taxRate: z.coerce.number().finite().min(0).max(100).optional(),
  fixedTax: moneySchema.optional(),
});

const checkoutLineSchema = z.object({
  id: uuidSchema,
  categoryId: uuidSchema.optional(),
  quantity: z.coerce.number().finite().positive().max(1_000_000),
  actualPrice: moneySchema,
  discount: moneySchema.default(0),
  taxRate: z.coerce.number().finite().min(0).max(100).optional(),
  fixedTax: moneySchema.optional(),
});

export const shoppingCheckoutSchema = z.object({
  listId: uuidSchema,
  accountId: uuidSchema,
  categoryId: uuidSchema,
  occurredOn: z.string().date(),
  visibility: visibilitySchema,
  discount: moneySchema.default(0),
  shipping: moneySchema.default(0),
  tip: moneySchema.default(0),
  note: z.string().trim().max(2_000).optional(),
  items: z.array(checkoutLineSchema).min(1).max(250),
});

export const invitationSchema = z.object({
  householdId: uuidSchema,
  email: z.string().trim().toLowerCase().email().max(254),
});

export const householdSchema = z.object({
  name: z.string().trim().min(1).max(80),
  currency: currencySchema,
  taxRate: z.coerce.number().finite().min(0).max(100),
});

export const categorySchema = z.object({ householdId: uuidSchema, name: z.string().trim().min(1).max(80), kind: z.enum(["income", "expense"]), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });
export const payeeSchema = z.object({ householdId: uuidSchema, name: z.string().trim().min(1).max(120) });
export const tagSchema = z.object({ householdId: uuidSchema, name: z.string().trim().min(1).max(40), color: z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/) });
export const transactionSearchSchema = z.object({
  householdId: uuidSchema,
  query: z.string().trim().max(80).optional(),
  kind: z.enum(["income", "expense", "transfer", "adjustment"]).optional(),
  accountId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  payeeId: uuidSchema.optional(),
  tagId: uuidSchema.optional(),
  visibility: visibilitySchema.optional(),
  status: z.enum(["posted", "projected"]).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  minAmount: moneySchema.optional(),
  maxAmount: moneySchema.optional(),
}).superRefine((value, context) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) context.addIssue({ code: "custom", path: ["dateTo"], message: "End date must be on or after start date" });
  if (value.minAmount !== undefined && value.maxAmount !== undefined && value.minAmount > value.maxAmount) context.addIssue({ code: "custom", path: ["maxAmount"], message: "Maximum amount must be at least the minimum amount" });
});
export const goalSchema = z.object({ householdId: uuidSchema, name: z.string().trim().min(1).max(100), targetAmount: moneySchema.positive(), currency: currencySchema, targetDate: z.string().date().optional(), visibility: visibilitySchema });
export const debtSchema = z.object({ householdId: uuidSchema, creditor: z.string().trim().min(1).max(120), balance: moneySchema.positive(), currency: currencySchema, interestRate: z.coerce.number().min(0).max(100).optional(), minimumPayment: moneySchema.optional(), dueDay: z.coerce.number().int().min(1).max(31).optional(), accountId: uuidSchema.optional(), visibility: visibilitySchema });
export const budgetSchema = z.object({ householdId: uuidSchema, categoryId: uuidSchema.optional(), month: z.string().date(), amount: moneySchema, envelopeAmount: moneySchema.default(0), currency: currencySchema, visibility: visibilitySchema });
export const recurringSchema = z.object({ householdId: uuidSchema, accountId: uuidSchema, categoryId: uuidSchema.optional(), name: z.string().trim().min(1).max(120), amount: moneySchema.positive(), currency: currencySchema, cadence: z.enum(["weekly", "monthly", "quarterly", "yearly"]), nextDueOn: z.string().date(), ruleKind: z.enum(["bill", "subscription", "income"]), visibility: visibilitySchema });
export const recurringConfirmSchema = z.object({ ruleId: uuidSchema, paidOn: z.string().date() });
export const goalAllocationSchema = z.object({ goalId: uuidSchema, amount: moneySchema.positive(), allocatedOn: z.string().date(), note: z.string().trim().max(500).optional() });
export const debtPaymentSchema = z.object({ debtId: uuidSchema, accountId: uuidSchema, amount: moneySchema.positive(), paidOn: z.string().date(), visibility: visibilitySchema, note: z.string().trim().max(500).optional() });
export const budgetEnvelopeSchema = z.object({ budgetId: uuidSchema, name: z.string().trim().min(1).max(80), amount: moneySchema });
export const voidExpenseSchema = z.object({ transactionId: uuidSchema });
export const profileLanguageSchema = z.object({ language: languageSchema });
