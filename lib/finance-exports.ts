import "server-only";
import { createAdminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";

export type FinanceExportKind = "transactions" | "accounts" | "report";

export async function reserveFinanceExport(kind: FinanceExportKind) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, message: "Authentication required" };

  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .limit(1)
    .maybeSingle();
  if (!membership) return { ok: false as const, status: 403, message: "Household membership required" };

  const { error } = await createAdminClient().rpc("reserve_finance_export", {
    actor_id: user.id,
    target_household: membership.household_id,
    export_kind: kind,
  });
  if (error) return { ok: false as const, status: 429, message: "Export limit reached. Wait a few minutes and try again." };

  return { ok: true as const, userId: user.id, householdId: membership.household_id, supabase };
}

export const privateCsvHeaders = (filename: string, rowLimit: number) => ({
  "Content-Type": "text/csv; charset=utf-8",
  "Content-Disposition": `attachment; filename="${filename}"`,
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Export-Row-Limit": String(rowLimit),
});
