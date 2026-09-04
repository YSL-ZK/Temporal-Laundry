export type ReminderUrgency = "overdue" | "today" | "soon" | "upcoming";
export type ReminderKind = "recurring" | "card" | "debt" | "receivable";

export type FinanceReminder = {
  id: string;
  sourceId: string;
  kind: ReminderKind;
  urgency: ReminderUrgency;
  title: string;
  detail: string | null;
  dueOn: string;
  amount: number | null;
  currency: string;
  visibility: "private" | "shared";
  destination: "accounts" | "plans";
};

type ReminderInput = {
  asOf: string;
  recurring: Array<{ id: string; name: string; amount: number; currency: string; dueOn: string; status: string; kind: string; provider: string | null; visibility: "private" | "shared" }>;
  statements: Array<{ id: string; cardName: string; currency: string; dueOn: string; statementBalance: number; paidAmount: number; status: string; visibility: "private" | "shared" }>;
  debts: Array<{ id: string; creditor: string; direction: "payable" | "receivable"; balance: number; minimum: number | null; currency: string; dueDay: number | null; visibility: "private" | "shared" }>;
  debtPayments: Array<{ debtId: string; amount: number; paidOn: string }>;
};

const DAY_MS = 86_400_000;
const dateValue = (date: string) => Date.parse(`${date}T00:00:00Z`);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

function urgencyFor(dueOn: string, asOf: string): ReminderUrgency | null {
  const difference = Math.round((dateValue(dueOn) - dateValue(asOf)) / DAY_MS);
  if (difference < 0) return "overdue";
  if (difference === 0) return "today";
  if (difference <= 7) return "soon";
  if (difference <= 31) return "upcoming";
  return null;
}

function monthlyDueDate(asOf: string, dueDay: number, monthOffset = 0) {
  const anchor = new Date(`${asOf}T12:00:00Z`);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + monthOffset;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return isoDate(new Date(Date.UTC(year, month, Math.min(dueDay, lastDay))));
}

function sortReminders(left: FinanceReminder, right: FinanceReminder) {
  const urgencyOrder: Record<ReminderUrgency, number> = { overdue: 0, today: 1, soon: 2, upcoming: 3 };
  return urgencyOrder[left.urgency] - urgencyOrder[right.urgency]
    || left.dueOn.localeCompare(right.dueOn)
    || left.title.localeCompare(right.title);
}

export function buildFinanceReminders({ asOf, recurring, statements, debts, debtPayments }: ReminderInput) {
  const reminders: FinanceReminder[] = [];

  for (const item of recurring) {
    if (item.status !== "projected") continue;
    const urgency = urgencyFor(item.dueOn, asOf);
    if (!urgency) continue;
    reminders.push({ id: `recurring:${item.id}`, sourceId: item.id, kind: "recurring", urgency, title: item.name, detail: item.provider, dueOn: item.dueOn, amount: item.amount, currency: item.currency, visibility: item.visibility, destination: "plans" });
  }

  for (const statement of statements) {
    const remaining = Math.max(0, statement.statementBalance - statement.paidAmount);
    if (statement.status !== "open" || remaining <= 0) continue;
    const urgency = urgencyFor(statement.dueOn, asOf);
    if (!urgency) continue;
    reminders.push({ id: `card:${statement.id}`, sourceId: statement.id, kind: "card", urgency, title: statement.cardName, detail: null, dueOn: statement.dueOn, amount: remaining, currency: statement.currency, visibility: statement.visibility, destination: "accounts" });
  }

  const currentMonth = asOf.slice(0, 7);
  for (const debt of debts) {
    if (!debt.dueDay || debt.balance <= 0) continue;
    const expected = Math.min(debt.balance, Math.max(0, debt.minimum ?? 0));
    const paidThisMonth = debtPayments
      .filter((payment) => payment.debtId === debt.id && payment.paidOn.startsWith(currentMonth))
      .reduce((sum, payment) => sum + payment.amount, 0);
    const currentDue = monthlyDueDate(asOf, debt.dueDay);
    const satisfied = expected > 0 && paidThisMonth + 0.005 >= expected;
    const dueOn = satisfied ? monthlyDueDate(asOf, debt.dueDay, 1) : currentDue;
    const urgency = urgencyFor(dueOn, asOf);
    if (!urgency) continue;
    reminders.push({
      id: `${debt.direction}:${debt.id}:${dueOn}`,
      sourceId: debt.id,
      kind: debt.direction === "receivable" ? "receivable" : "debt",
      urgency,
      title: debt.creditor,
      detail: null,
      dueOn,
      amount: expected > 0 ? Math.max(0, expected - (satisfied ? 0 : paidThisMonth)) : null,
      currency: debt.currency,
      visibility: debt.visibility,
      destination: "plans",
    });
  }

  return reminders.sort(sortReminders);
}
