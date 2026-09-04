import "server-only";
import { createAdminClient } from "./supabase/admin";
import { parseDatosGovUsdCop, parseEcbUsdPerEur } from "./exchange-rate-utils";
import type { CurrencyRates, SupportedCurrency } from "./money";
import { logBackgroundFailure } from "./monitoring";

type RateRow = {
  valuation_date: string;
  currency: SupportedCurrency;
  cop_per_unit: number | string;
  source_observed_on: string;
};

export type ExchangeRateSnapshot = {
  valuationDate: string;
  stale: boolean;
  copPerUnit: CurrencyRates;
  observedOn: Partial<Record<SupportedCurrency, string>>;
};

export function bogotaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function snapshot(rows: RateRow[], requestedDate: string): ExchangeRateSnapshot | null {
  const latest = new Map<SupportedCurrency, RateRow>();
  for (const row of rows) if (!latest.has(row.currency)) latest.set(row.currency, row);
  if (!["COP", "USD", "EUR"].every((currency) => latest.has(currency as SupportedCurrency))) return null;
  const valuationDate = [...latest.values()].reduce((value, row) => row.valuation_date > value ? row.valuation_date : value, "");
  return {
    valuationDate,
    stale: valuationDate !== requestedDate,
    copPerUnit: Object.fromEntries([...latest].map(([currency, row]) => [currency, Number(row.cop_per_unit)])),
    observedOn: Object.fromEntries([...latest].map(([currency, row]) => [currency, row.source_observed_on])),
  };
}

async function readRates(date: string, exact: boolean) {
  const admin = createAdminClient();
  let query = admin.from("daily_exchange_rates")
    .select("valuation_date,currency,cop_per_unit,source_observed_on")
    .order("valuation_date", { ascending: false })
    .limit(30);
  query = exact ? query.eq("valuation_date", date) : query.lte("valuation_date", date);
  const { data, error } = await query;
  if (error) throw error;
  return snapshot((data ?? []) as RateRow[], date);
}

export async function refreshDailyExchangeRates(date = bogotaDate()) {
  const datosUrl = new URL("https://www.datos.gov.co/resource/32sa-8pi3.json");
  datosUrl.searchParams.set("$limit", "1");
  datosUrl.searchParams.set("$order", "vigenciadesde DESC");
  const datosHeaders: HeadersInit = { Accept: "application/json" };
  const appToken = process.env.DATOS_GOV_APP_TOKEN?.trim();
  if (appToken) datosHeaders["X-App-Token"] = appToken;

  const [datosResponse, ecbResponse] = await Promise.all([
    fetch(datosUrl, { headers: datosHeaders, cache: "no-store", signal: AbortSignal.timeout(8_000) }),
    fetch("https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=1&format=csvdata", {
      headers: { Accept: "text/csv" }, cache: "no-store", signal: AbortSignal.timeout(8_000),
    }),
  ]);
  if (!datosResponse.ok || !ecbResponse.ok) throw new Error("An official exchange-rate provider was unavailable");

  const usdCop = parseDatosGovUsdCop(await datosResponse.json());
  const usdPerEur = parseEcbUsdPerEur(await ecbResponse.text());
  const eurCop = usdCop.value * usdPerEur.value;
  const { error } = await createAdminClient().rpc("store_daily_exchange_rates", {
    target_date: date,
    usd_cop: usdCop.value,
    eur_cop: eurCop,
    usd_observed_on: usdCop.observedOn,
    eur_observed_on: usdPerEur.observedOn,
  });
  if (error) throw error;
  const stored = await readRates(date, true);
  if (!stored) throw new Error("Daily exchange rates were not stored");
  return stored;
}

export async function getDailyExchangeRates(date = bogotaDate()) {
  try {
    const current = await readRates(date, true);
    if (current) return current;
    if (date === bogotaDate()) return await refreshDailyExchangeRates(date);
    return await readRates(date, false);
  } catch (error) {
    logBackgroundFailure("exchange_rate_refresh", error);
    try {
      return await readRates(date, false);
    } catch {
      return null;
    }
  }
}
