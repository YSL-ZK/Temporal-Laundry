export type DebtStrategy = "snowball" | "avalanche";

export type DebtProjectionInput = {
  id: string;
  name: string;
  balance: number;
  annualRate: number;
  minimumPayment: number;
};

export type DebtProjectionMonth = {
  month: number;
  focusId: string;
  focusName: string;
  openingBalance: number;
  interest: number;
  payment: number;
  closingBalance: number;
};

export type DebtProjection = {
  strategy: DebtStrategy;
  months: number | null;
  totalInterest: number;
  totalPaid: number;
  monthlyBudget: number;
  schedule: DebtProjectionMonth[];
};

type WorkingDebt = DebtProjectionInput & { currentBalance: number };

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const validAmount = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

function priority(strategy: DebtStrategy, left: WorkingDebt, right: WorkingDebt) {
  if (strategy === "snowball") {
    return left.currentBalance - right.currentBalance
      || right.annualRate - left.annualRate
      || left.name.localeCompare(right.name);
  }
  return right.annualRate - left.annualRate
    || left.currentBalance - right.currentBalance
    || left.name.localeCompare(right.name);
}

/**
 * Simulates a fixed monthly debt budget. Minimums released by a paid-off debt
 * roll into the next priority debt, which is the defining snowball/avalanche behavior.
 */
export function projectDebtStrategy(
  debts: DebtProjectionInput[],
  strategy: DebtStrategy,
  extraMonthlyPayment = 0,
  maximumMonths = 1200,
): DebtProjection {
  const working: WorkingDebt[] = debts
    .filter((debt) => validAmount(debt.balance) > 0)
    .map((debt) => ({
      ...debt,
      balance: cents(validAmount(debt.balance)),
      annualRate: Math.min(100, validAmount(debt.annualRate)),
      minimumPayment: cents(validAmount(debt.minimumPayment)),
      currentBalance: cents(validAmount(debt.balance)),
    }));
  const monthlyBudget = cents(working.reduce((sum, debt) => sum + debt.minimumPayment, 0) + validAmount(extraMonthlyPayment));
  if (!working.length) return { strategy, months: 0, totalInterest: 0, totalPaid: 0, monthlyBudget, schedule: [] };

  const schedule: DebtProjectionMonth[] = [];
  let totalInterest = 0;
  let totalPaid = 0;

  for (let month = 1; month <= maximumMonths; month += 1) {
    const active = working.filter((debt) => debt.currentBalance > 0.005);
    if (!active.length) {
      return { strategy, months: month - 1, totalInterest: cents(totalInterest), totalPaid: cents(totalPaid), monthlyBudget, schedule };
    }

    const openingBalance = cents(active.reduce((sum, debt) => sum + debt.currentBalance, 0));
    const focus = [...active].sort((left, right) => priority(strategy, left, right))[0];
    let monthInterest = 0;
    for (const debt of active) {
      const interest = cents(debt.currentBalance * debt.annualRate / 1200);
      debt.currentBalance = cents(debt.currentBalance + interest);
      monthInterest += interest;
    }

    let remainingBudget = monthlyBudget;
    let monthPayment = 0;
    for (const debt of active) {
      const payment = Math.min(debt.currentBalance, debt.minimumPayment, remainingBudget);
      debt.currentBalance = cents(debt.currentBalance - payment);
      remainingBudget = cents(remainingBudget - payment);
      monthPayment += payment;
    }

    while (remainingBudget > 0.005) {
      const target = working.filter((debt) => debt.currentBalance > 0.005).sort((left, right) => priority(strategy, left, right))[0];
      if (!target) break;
      const payment = Math.min(target.currentBalance, remainingBudget);
      target.currentBalance = cents(target.currentBalance - payment);
      remainingBudget = cents(remainingBudget - payment);
      monthPayment += payment;
    }

    const closingBalance = cents(working.reduce((sum, debt) => sum + Math.max(0, debt.currentBalance), 0));
    totalInterest += monthInterest;
    totalPaid += monthPayment;
    schedule.push({
      month,
      focusId: focus.id,
      focusName: focus.name,
      openingBalance,
      interest: cents(monthInterest),
      payment: cents(monthPayment),
      closingBalance,
    });

    if (closingBalance <= 0.005) {
      return { strategy, months: month, totalInterest: cents(totalInterest), totalPaid: cents(totalPaid), monthlyBudget, schedule };
    }
    if (monthPayment <= 0.005 && closingBalance >= openingBalance) break;
  }

  return { strategy, months: null, totalInterest: cents(totalInterest), totalPaid: cents(totalPaid), monthlyBudget, schedule };
}
