export type BudgetRolloverDecision = "reset" | "carry_surplus" | "carry_balance";

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const safe = (value: number) => Number.isFinite(value) ? value : 0;

export function budgetRolloverAmount(limit: number, spent: number, decision: BudgetRolloverDecision) {
  const balance = money(safe(limit) - Math.max(0, safe(spent)));
  if (decision === "reset") return 0;
  if (decision === "carry_surplus") return Math.max(0, balance);
  return balance;
}

export function compareBudgetSpend(currentSpent: number, previousSpent: number | null) {
  const current = Math.max(0, safe(currentSpent));
  if (previousSpent === null || !Number.isFinite(previousSpent)) return { difference: null, percentage: null };
  const previous = Math.max(0, previousSpent);
  const difference = money(current - previous);
  const percentage = previous > 0 ? Math.round((difference / previous) * 1000) / 10 : current > 0 ? null : 0;
  return { difference, percentage };
}

export function nextBudgetMonth(month: string) {
  const date = new Date(`${month.slice(0, 7)}-01T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}
