import "server-only";

import { safeOperationalError, type AssistantQuotaReason } from "./monitoring-safe";

type BackgroundJob = "exchange_rate_refresh" | "recurring_occurrence_generation";
type AssistantAvailabilityReason = "configuration_missing" | "configuration_invalid" | "provider_timeout" | "provider_http_error" | "provider_empty_response" | "provider_network_error" | "usage_record_failed";

function write(level: "error" | "warn", event: Record<string, string | number | boolean | undefined>) {
  const payload = JSON.stringify({ timestamp: new Date().toISOString(), service: "laundry", ...event });
  console[level](payload);
}

export function logMutationFailure(error: unknown) {
  write("error", { event: "finance_mutation_failed", area: "server_action", ...safeOperationalError(error) });
}

export function logBackgroundFailure(job: BackgroundJob, error: unknown) {
  write("error", { event: "background_job_failed", job, ...safeOperationalError(error) });
}

export function logAssistantQuotaDenied(reason: AssistantQuotaReason) {
  write("warn", { event: "assistant_quota_denied", reason });
}

export function logAssistantUnavailable(reason: AssistantAvailabilityReason, error?: unknown) {
  write("error", { event: "assistant_unavailable", provider: "groq", reason, ...(error === undefined ? {} : safeOperationalError(error)) });
}
