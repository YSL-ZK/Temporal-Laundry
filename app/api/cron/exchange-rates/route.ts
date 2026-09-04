import { timingSafeEqual } from "node:crypto";
import { refreshDailyExchangeRates } from "../../../../lib/exchange-rates";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const configured = process.env.CRON_SECRET?.trim();
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configured || configured.length < 16 || configured.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(configured), Buffer.from(received));
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const through = new Date();
    through.setUTCDate(through.getUTCDate() + 120);
    const [rates, occurrences] = await Promise.all([
      refreshDailyExchangeRates(),
      createAdminClient().rpc("generate_recurring_occurrences", { target_through: through.toISOString().slice(0, 10) }),
    ]);
    if (occurrences.error) throw occurrences.error;
    return Response.json({ ok: true, valuationDate: rates.valuationDate, observedOn: rates.observedOn, occurrencesCreated: occurrences.data ?? 0 });
  } catch (error) {
    console.error("scheduled exchange-rate refresh failed", { name: error instanceof Error ? error.name : "Error" });
    return Response.json({ error: "Exchange-rate refresh failed" }, { status: 502 });
  }
}
