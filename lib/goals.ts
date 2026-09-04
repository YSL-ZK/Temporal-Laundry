export type GoalAllocationPoint = { amount: number; allocatedOn: string };

export type GoalForecast = {
  remaining: number;
  averageMonthly: number;
  requiredMonthly: number | null;
  forecastMonths: number | null;
  forecastDate: string | null;
  status: "complete" | "on-track" | "behind" | "no-pace" | "no-target-date";
};

const DAY_MS = 86_400_000;
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function monthDistance(from: string, to: string) {
  const start = new Date(`${from.slice(0, 7)}-01T12:00:00Z`);
  const end = new Date(`${to.slice(0, 7)}-01T12:00:00Z`);
  return Math.max(1, (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1);
}

function addMonths(dateValue: string, months: number) {
  const date = new Date(`${dateValue}T12:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const finalDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, finalDay));
  return date.toISOString().slice(0, 10);
}

export function forecastGoal({ target, current, targetDate, asOf, allocations }: { target: number; current: number; targetDate: string | null; asOf: string; allocations: GoalAllocationPoint[] }): GoalForecast {
  const safeTarget = Number.isFinite(target) ? Math.max(0, target) : 0;
  const safeCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
  const remaining = cents(Math.max(0, safeTarget - safeCurrent));
  const validAllocations = allocations.filter((allocation) => Number.isFinite(allocation.amount) && allocation.amount > 0 && allocation.allocatedOn <= asOf);
  const firstAllocation = validAllocations.reduce<string | null>((first, allocation) => !first || allocation.allocatedOn < first ? allocation.allocatedOn : first, null);
  const observedMonths = firstAllocation ? Math.min(12, monthDistance(firstAllocation, asOf)) : 0;
  const observedStart = observedMonths ? addMonths(`${asOf.slice(0, 7)}-01`, -(observedMonths - 1)) : asOf;
  const observedTotal = validAllocations.filter((allocation) => allocation.allocatedOn >= observedStart).reduce((sum, allocation) => sum + allocation.amount, 0);
  const averageMonthly = observedMonths ? cents(observedTotal / observedMonths) : 0;

  if (remaining <= 0) return { remaining: 0, averageMonthly, requiredMonthly: 0, forecastMonths: 0, forecastDate: asOf, status: "complete" };

  const forecastMonths = averageMonthly > 0 ? Math.ceil(remaining / averageMonthly) : null;
  const forecastDate = forecastMonths === null ? null : addMonths(asOf, forecastMonths);
  if (!targetDate) return { remaining, averageMonthly, requiredMonthly: null, forecastMonths, forecastDate, status: averageMonthly > 0 ? "no-target-date" : "no-pace" };

  const daysRemaining = Math.max(0, Math.ceil((Date.parse(`${targetDate}T12:00:00Z`) - Date.parse(`${asOf}T12:00:00Z`)) / DAY_MS));
  const monthsRemaining = Math.max(1, Math.ceil(daysRemaining / 30.4375));
  const requiredMonthly = cents(remaining / monthsRemaining);
  if (!forecastDate) return { remaining, averageMonthly, requiredMonthly, forecastMonths, forecastDate, status: "no-pace" };
  return { remaining, averageMonthly, requiredMonthly, forecastMonths, forecastDate, status: forecastDate <= targetDate ? "on-track" : "behind" };
}
