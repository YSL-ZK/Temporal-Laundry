export type SafeOperationalError = { errorName: string; errorCode?: string };
export type AssistantQuotaReason = "burst" | "user_daily" | "household_daily" | "global_daily" | "policy" | "verification_failed";

const SAFE_TOKEN = /^[a-zA-Z0-9_.-]{1,64}$/;

function token(value: unknown, fallback: string) {
  return typeof value === "string" && SAFE_TOKEN.test(value) ? value : fallback;
}

export function safeOperationalError(error: unknown): SafeOperationalError {
  if (typeof error !== "object" || error === null) return { errorName: "Error" };
  const errorName = token("name" in error ? error.name : undefined, "Error");
  const candidateCode = "code" in error ? error.code : undefined;
  const errorCode = typeof candidateCode === "number" ? String(candidateCode) : token(candidateCode, "");
  return errorCode ? { errorName, errorCode } : { errorName };
}

export function classifyQuotaReason(reason: unknown): AssistantQuotaReason {
  const normalized = typeof reason === "string" ? reason.toLowerCase() : "";
  if (normalized.includes("5 minute") || normalized.includes("burst")) return "burst";
  if (normalized.includes("user") && normalized.includes("daily")) return "user_daily";
  if (normalized.includes("household") && normalized.includes("daily")) return "household_daily";
  if (normalized.includes("global") && normalized.includes("daily")) return "global_daily";
  return "policy";
}
