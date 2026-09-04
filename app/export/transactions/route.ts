import { csvRow } from "../../../lib/csv";
import { privateCsvHeaders, reserveFinanceExport } from "../../../lib/finance-exports";

export const dynamic = "force-dynamic";

const exportLimit = 5_000;

export async function GET() {
  const reservation = await reserveFinanceExport("transactions");
  if (!reservation.ok) return new Response(reservation.message, { status: reservation.status });
  const { supabase, householdId } = reservation;

  const { data, error } = await supabase
    .from("transactions")
    .select("occurred_on,kind,status,amount,currency,reporting_exchange_rate,payee,note,visibility,accounts(name),categories(name)")
    .eq("household_id", householdId)
    .is("voided_at", null)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(exportLimit);

  if (error) return new Response("The transaction export could not be created", { status: 500 });

  const headers = ["Date", "Type", "Status", "Amount", "Currency", "Reporting FX rate", "Reporting amount", "Account", "Category", "Payee", "Note", "Visibility"];
  const lines = (data ?? []).map((row) => {
    const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
    const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
    const reportingAmount = Number(row.amount) * Number(row.reporting_exchange_rate);
    return csvRow([row.occurred_on, row.kind, row.status, row.amount, row.currency, row.reporting_exchange_rate, reportingAmount.toFixed(2), account?.name ?? "", category?.name ?? "", row.payee ?? "", row.note ?? "", row.visibility]);
  });
  const csv = `\uFEFF${csvRow(headers)}\r\n${lines.join("\r\n")}`;
  const filename = `laundry-transactions-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: privateCsvHeaders(filename, exportLimit),
  });
}
