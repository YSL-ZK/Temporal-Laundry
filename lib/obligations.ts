export type ObligationState = "overdue" | "due-today" | "upcoming" | "confirmed" | "skipped";

export function obligationState(dueOn: string, today: string, status: "projected" | "confirmed" | "skipped"): ObligationState {
  if (status === "confirmed" || status === "skipped") return status;
  if (dueOn < today) return "overdue";
  if (dueOn === today) return "due-today";
  return "upcoming";
}

export function cardUtilization(balance: number, creditLimit: number | null) {
  if (!creditLimit || creditLimit <= 0) return null;
  return Math.max(0, -balance) / creditLimit * 100;
}

export function statementRemaining(statementBalance: number, paidAmount: number) {
  return Math.max(0, statementBalance - paidAmount);
}
