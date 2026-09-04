import { csvRow } from "../../../lib/csv";
import { loadDashboard } from "../../../lib/dashboard";
import { privateCsvHeaders, reserveFinanceExport } from "../../../lib/finance-exports";
import { buildFinanceReport, reportSourceFromDashboard } from "../../../lib/reports";
import { reportFiltersSchema } from "../../../lib/validation";

export const dynamic = "force-dynamic";
const exportLimit = 12;

export async function GET(request: Request) {
  const reservation = await reserveFinanceExport("report");
  if (!reservation.ok) return new Response(reservation.message, { status: reservation.status });

  const data = await loadDashboard();
  if (!data?.household) return new Response("Household data unavailable", { status: 403 });
  const params = new URL(request.url).searchParams;
  const parsed = reportFiltersSchema.safeParse({
    months: params.get("months") ?? 6,
    currency: params.get("currency") ?? data.household.currency,
    accountId: params.get("accountId") ?? "",
    categoryId: params.get("categoryId") ?? "",
    kind: params.get("kind") ?? "all",
  });
  if (!parsed.success) return new Response("Invalid report filters", { status: 400 });

  const report = buildFinanceReport(reportSourceFromDashboard(data), parsed.data);
  const headers = ["Month", "Income", "Expenses", "Net cash flow", "Net worth", "Currency", "Period start", "Period end"];
  const lines = report.months.map((month) => csvRow([
    month.key,
    month.income.toFixed(2),
    month.expense.toFixed(2),
    (month.income - month.expense).toFixed(2),
    month.netWorth === null ? "" : month.netWorth.toFixed(2),
    report.currency,
    report.from,
    report.to,
  ]));
  const csv = `\uFEFF${csvRow(headers)}\r\n${lines.join("\r\n")}`;
  const filename = `laundry-report-${report.from}-${report.to}-${report.currency}.csv`;
  return new Response(csv, { headers: privateCsvHeaders(filename, exportLimit) });
}
