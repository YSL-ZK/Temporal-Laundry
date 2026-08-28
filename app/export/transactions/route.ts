import { createClient } from "../../../lib/supabase/server";
import { csvRow } from "../../../lib/csv";

export const dynamic = "force-dynamic";

const exportLimit = 5_000;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Authentication required", { status: 401 });

  const { data: membership } = await supabase.from("household_members").select("household_id").limit(1).maybeSingle();
  if (!membership) return new Response("Household membership required", { status: 403 });

  const { data, error } = await supabase
    .from("transactions")
    .select("occurred_on,kind,status,amount,currency,reporting_exchange_rate,payee,note,visibility,accounts(name),categories(name)")
    .eq("household_id", membership.household_id)
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
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Export-Row-Limit": String(exportLimit),
    },
  });
}
