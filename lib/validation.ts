import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "./money";
import { formulaReferences } from "./finance";

export const visibilitySchema = z.enum(["private", "shared"]);
export const currencySchema = z.string().trim().toUpperCase().pipe(z.enum(SUPPORTED_CURRENCIES, { error: "Choose COP, USD, or EUR" }));
export const moneySchema = z.coerce.number().finite().min(0).max(999_999_999_999);
export const signedMoneySchema = z.coerce.number().finite().min(-999_999_999_999).max(999_999_999_999);
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

export const accountUpdateSchema = z.object({
  accountId: uuidSchema,
  name: z.string().trim().min(1).max(80),
  visibility: visibilitySchema,
  creditLimit: moneySchema.optional(),
  paymentAccountId: uuidSchema.optional(),
  closingDay: z.coerce.number().int().min(1).max(31).optional(),
  dueDay: z.coerce.number().int().min(1).max(31).optional(),
});

export const accountArchiveSchema = z.object({ accountId: uuidSchema });

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

export const transactionDraftSchema = transactionSchema.omit({ reportingExchangeRate: true, items: true }).extend({
  draftId: uuidSchema.optional(),
});
export const transactionDraftIdSchema = z.object({ draftId: uuidSchema });
export const transactionCorrectionSchema = transactionSchema.pick({
  householdId: true,
  accountId: true,
  categoryId: true,
  payeeId: true,
  tagIds: true,
  amount: true,
  currency: true,
  occurredOn: true,
  payee: true,
  note: true,
  visibility: true,
}).extend({ transactionId: uuidSchema, reason: z.string().trim().min(3).max(500) });
export const transactionReversalSchema = z.object({ transactionId: uuidSchema, reason: z.string().trim().min(3).max(500) });

const categoryWorkflowBaseSchema = z.object({
  householdId: uuidSchema,
  accountId: uuidSchema,
  categoryId: uuidSchema,
  payeeId: uuidSchema.optional(),
  tagIds: z.array(uuidSchema).max(12).default([]),
  amount: moneySchema.positive(),
  currency: currencySchema,
  occurredOn: z.string().date(),
  payee: z.string().trim().max(120).optional(),
  note: z.string().trim().max(2_000).optional(),
  visibility: visibilitySchema,
});

const billsWorkflowDetailsSchema = z.object({
  provider: z.string().trim().min(1).max(120),
  serviceReference: z.string().trim().max(120).optional(),
  billingPeriod: z.string().trim().max(80).optional(),
  dueOn: z.string().date(),
  recurringRuleId: uuidSchema.optional(),
});
const transportWorkflowDetailsSchema = z.object({
  vehicleOrRoute: z.string().trim().min(1).max(120),
  distance: moneySchema.optional(),
  odometer: moneySchema.optional(),
  fuelQuantity: moneySchema.optional(),
  fare: moneySchema.optional(),
  tripNotes: z.string().trim().max(1_000).optional(),
});
const diningWorkflowDetailsSchema = z.object({
  venue: z.string().trim().min(1).max(120),
  participants: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  splitAmount: moneySchema.optional(),
  tip: moneySchema.default(0),
  tax: moneySchema.default(0),
});
const healthWorkflowDetailsSchema = z.object({
  provider: z.string().trim().min(1).max(120),
  service: z.string().trim().min(1).max(160),
  patient: z.string().trim().max(120).optional(),
  reimbursementStatus: z.enum(["not_applicable", "pending", "submitted", "reimbursed", "denied"]).default("not_applicable"),
  claimReference: z.string().trim().max(120).optional(),
});
const travelWorkflowDetailsSchema = z.object({
  trip: z.string().trim().min(1).max(120),
  reservationOrVendor: z.string().trim().max(160).optional(),
  itineraryOn: z.string().date(),
  localCurrency: currencySchema,
  tripBudget: moneySchema.optional(),
});

export const categoryWorkflowTransactionSchema = z.discriminatedUnion("workflow", [
  categoryWorkflowBaseSchema.extend({
    workflow: z.literal("bills"),
    details: billsWorkflowDetailsSchema,
  }),
  categoryWorkflowBaseSchema.extend({
    workflow: z.literal("transport"),
    details: transportWorkflowDetailsSchema,
  }),
  categoryWorkflowBaseSchema.extend({
    workflow: z.literal("dining"),
    details: diningWorkflowDetailsSchema,
  }),
  categoryWorkflowBaseSchema.extend({
    workflow: z.literal("health"),
    details: healthWorkflowDetailsSchema,
  }),
  categoryWorkflowBaseSchema.extend({
    workflow: z.literal("travel"),
    details: travelWorkflowDetailsSchema,
  }),
]);

export const categoryWorkflowMetadataSchema = z.discriminatedUnion("categoryWorkflow", [
  z.object({ categoryWorkflow: z.literal("bills"), workflowVersion: z.literal(1), details: billsWorkflowDetailsSchema }),
  z.object({ categoryWorkflow: z.literal("transport"), workflowVersion: z.literal(1), details: transportWorkflowDetailsSchema }),
  z.object({ categoryWorkflow: z.literal("dining"), workflowVersion: z.literal(1), details: diningWorkflowDetailsSchema }),
  z.object({ categoryWorkflow: z.literal("health"), workflowVersion: z.literal(1), details: healthWorkflowDetailsSchema }),
  z.object({ categoryWorkflow: z.literal("travel"), workflowVersion: z.literal(1), details: travelWorkflowDetailsSchema }),
]);
export type CategoryWorkflowMetadata = z.infer<typeof categoryWorkflowMetadataSchema>;

export const templateFieldInputSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().trim().min(1).max(80),
  type: z.enum(["text", "number", "currency", "date", "checkbox", "select", "multiselect", "list", "formula"]),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  defaultValue: z.union([z.string().max(1_000), z.number().finite(), z.boolean(), z.array(z.string().max(160)).max(100)]).optional(),
  formula: z.string().trim().max(300).optional(),
  amountPrefill: z.boolean().default(false),
});

export const categoryTemplateSchema = z.object({
  templateId: uuidSchema.optional(),
  householdId: uuidSchema,
  categoryId: uuidSchema,
  visibility: visibilitySchema,
  name: z.string().trim().min(1).max(100),
  icon: z.string().trim().max(40).optional(),
  description: z.string().trim().max(500).optional(),
  fields: z.array(templateFieldInputSchema).min(1).max(30),
}).superRefine((value, context) => {
  const keys = new Set<string>();
  const numericKeys = new Set<string>();
  let amountPrefillCount = 0;
  value.fields.forEach((field, index) => {
    if (keys.has(field.key)) context.addIssue({ code: "custom", path: ["fields", index, "key"], message: "Field keys must be unique" });
    keys.add(field.key);
    const usesOptions = field.type === "select" || field.type === "multiselect";
    if (usesOptions && field.options.length === 0) context.addIssue({ code: "custom", path: ["fields", index, "options"], message: "Selection fields need options" });
    if (!usesOptions && field.options.length > 0) context.addIssue({ code: "custom", path: ["fields", index, "options"], message: "Only selection fields use options" });
    if (new Set(field.options).size !== field.options.length) context.addIssue({ code: "custom", path: ["fields", index, "options"], message: "Options must be unique" });
    if (field.type === "formula") {
      const references = field.formula ? formulaReferences(field.formula) : null;
      if (!references) context.addIssue({ code: "custom", path: ["fields", index, "formula"], message: "Use a valid declarative formula" });
      else if (references.some((reference) => !numericKeys.has(reference))) context.addIssue({ code: "custom", path: ["fields", index, "formula"], message: "Formulas can only reference earlier numeric fields" });
      numericKeys.add(field.key);
    } else {
      if (field.formula) context.addIssue({ code: "custom", path: ["fields", index, "formula"], message: "Only formula fields use formulas" });
      if (field.type === "number" || field.type === "currency") numericKeys.add(field.key);
    }
    if (field.amountPrefill) {
      amountPrefillCount += 1;
      if (field.type !== "formula") context.addIssue({ code: "custom", path: ["fields", index, "amountPrefill"], message: "Only a formula can prefill the reviewed amount" });
    }
  });
  if (amountPrefillCount > 1) context.addIssue({ code: "custom", path: ["fields"], message: "Only one formula can prefill the reviewed amount" });
});
export const categoryTemplateDeleteSchema = z.object({ templateId: uuidSchema });

const templateStoredValueSchema = z.union([
  z.string().max(1_000),
  z.number().finite().min(-999_999_999_999).max(999_999_999_999),
  z.boolean(),
  z.array(z.string().trim().min(1).max(160)).max(100),
]);
export const templateTransactionSchema = z.object({
  templateId: uuidSchema,
  accountId: uuidSchema,
  payeeId: uuidSchema.optional(),
  tagIds: z.array(uuidSchema).max(12).default([]),
  amount: moneySchema.positive(),
  currency: currencySchema,
  occurredOn: z.string().date(),
  payee: z.string().trim().max(120).optional(),
  note: z.string().trim().max(2_000).optional(),
  visibility: visibilitySchema,
  values: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), templateStoredValueSchema),
}).superRefine((value, context) => {
  if (Object.keys(value.values).length > 30) context.addIssue({ code: "custom", path: ["values"], message: "Too many template values" });
});

export const customTemplateMetadataSchema = z.object({
  customTemplate: uuidSchema,
  templateName: z.string().max(100),
  templateVersion: z.number().int().positive(),
  fields: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), label: z.string().max(80), type: z.string().max(20) })).max(30),
  values: z.record(z.string(), templateStoredValueSchema),
});
export type CustomTemplateMetadata = z.infer<typeof customTemplateMetadataSchema>;

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
export const debtSchema = z.object({ householdId: uuidSchema, creditor: z.string().trim().min(1).max(120), direction: z.enum(["payable", "receivable"]), balance: moneySchema.positive(), currency: currencySchema, interestRate: z.coerce.number().min(0).max(100).optional(), minimumPayment: moneySchema.optional(), dueDay: z.coerce.number().int().min(1).max(31).optional(), accountId: uuidSchema.optional(), visibility: visibilitySchema });
export const budgetSchema = z.object({ householdId: uuidSchema, categoryId: uuidSchema.optional(), month: z.string().date(), amount: moneySchema, envelopeAmount: moneySchema.default(0), currency: currencySchema, visibility: visibilitySchema });
export const recurringSchema = z.object({ householdId: uuidSchema, accountId: uuidSchema, categoryId: uuidSchema.optional(), name: z.string().trim().min(1).max(120), amount: moneySchema.positive(), cadence: z.enum(["weekly", "monthly", "quarterly", "yearly"]), nextDueOn: z.string().date(), ruleKind: z.enum(["bill", "subscription", "income"]), visibility: visibilitySchema, provider: z.string().trim().max(120).optional(), serviceReference: z.string().trim().max(120).optional(), billingPeriod: z.string().trim().max(80).optional() });
export const recurringOccurrenceConfirmSchema = z.object({ occurrenceId: uuidSchema, paidOn: z.string().date() });
export const recurringOccurrenceSkipSchema = z.object({ occurrenceId: uuidSchema });
export const cardStatementSchema = z.object({ cardId: uuidSchema, periodStart: z.string().date(), closingOn: z.string().date(), dueOn: z.string().date(), statementBalance: moneySchema.positive() }).superRefine((value, context) => {
  if (value.periodStart > value.closingOn) context.addIssue({ code: "custom", path: ["closingOn"], message: "Closing date must follow the period start" });
  if (value.closingOn >= value.dueOn) context.addIssue({ code: "custom", path: ["dueOn"], message: "Due date must follow the closing date" });
});
export const cardPaymentSchema = z.object({ statementId: uuidSchema, amount: moneySchema.positive(), paidOn: z.string().date() });
export const receiptDeletionSchema = z.object({ receiptId: uuidSchema });
export const reconciliationSchema = z.object({
  accountId: uuidSchema,
  periodStart: z.string().date(),
  endingOn: z.string().date(),
  statementBalance: signedMoneySchema,
  createAdjustment: z.coerce.boolean().default(false),
  note: z.string().trim().max(1_000).optional(),
}).superRefine((value, context) => {
  if (value.periodStart > value.endingOn) context.addIssue({ code: "custom", path: ["endingOn"], message: "Statement end must follow the period start" });
});
export const goalAllocationSchema = z.object({ goalId: uuidSchema, amount: moneySchema.positive(), allocatedOn: z.string().date(), note: z.string().trim().max(500).optional() });
export const debtPaymentSchema = z.object({ debtId: uuidSchema, accountId: uuidSchema, amount: moneySchema.positive(), paidOn: z.string().date(), visibility: visibilitySchema, note: z.string().trim().max(500).optional() });
export const budgetEnvelopeSchema = z.object({ budgetId: uuidSchema, name: z.string().trim().min(1).max(80), amount: moneySchema });
export const budgetRolloverSchema = z.object({ budgetId: uuidSchema, decision: z.enum(["reset", "carry_surplus", "carry_balance"]) });
export const voidExpenseSchema = z.object({ transactionId: uuidSchema });
export const profileLanguageSchema = z.object({ language: languageSchema });

export const reportFiltersSchema = z.object({
  months: z.coerce.number().pipe(z.union([z.literal(3), z.literal(6), z.literal(12)])).default(6),
  currency: currencySchema,
  accountId: z.union([z.literal(""), uuidSchema]).default(""),
  categoryId: z.union([z.literal(""), uuidSchema]).default(""),
  kind: z.enum(["all", "income", "expense"]).default("all"),
});
