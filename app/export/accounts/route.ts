import { csvRow } from "../../../lib/csv";
import { loadDashboard } from "../../../lib/dashboard";
import { privateCsvHeaders, reserveFinanceExport } from "../../../lib/finance-exports";
import { convertMoney, isSupportedCurrency } from "../../../lib/money";

export const dynamic = "force-dynamic";
const exportLimit = 500;

export async function GET(request: Request) {
  const reservation = await reserveFinanceExport("accounts");
  if (!reservation.ok) return new Response(reservation.message, { status: reservation.status });

  const data = await loadDashboard();
  if (!data?.household) return new Response("Household data unavailable", { status: 403 });
  const requestedCurrency = new URL(request.url).searchParams.get("currency")?.toUpperCase() ?? data.household.currency;
  if (!isSupportedCurrency(requestedCurrency)) return new Response("Invalid reporting currency", { status: 400 });

  const headers = ["Account", "Type", "Visibility", "Native balance", "Native currency", "Converted balance", "Reporting currency", "FX valuation date"];
  const lines = data.accounts.slice(0, exportLimit).map((account) => {
    const converted = convertMoney(account.balance, account.currency, requestedCurrency, data.exchangeRates?.copPerUnit ?? {});
    return csvRow([
      account.name,
      account.kind,
      account.visibility,
      account.balance.toFixed(2),
      account.currency,
      converted === null ? "" : converted.toFixed(2),
      requestedCurrency,
      data.exchangeRates?.valuationDate ?? "",
    ]);
  });
  const csv = `\uFEFF${csvRow(headers)}\r\n${lines.join("\r\n")}`;
  const filename = `laundry-accounts-${data.asOf}-${requestedCurrency}.csv`;
  return new Response(csv, { headers: privateCsvHeaders(filename, exportLimit) });
}
