import "server-only";
import { normalizeAssistantText, type FinanceChatMessage } from "./finance-ai";

const DEFAULT_MODEL = "openai/gpt-oss-20b";
const FREE_MODEL_ALLOWLIST = new Set(["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"]);

export type GroqFailureKind = "provider_timeout" | "provider_http_error" | "provider_empty_response" | "provider_network_error";

export class GroqError extends Error {
  readonly kind: GroqFailureKind;

  constructor(kind: GroqFailureKind) {
    super("AI provider request failed");
    this.name = "GroqError";
    this.kind = kind;
  }
}

export function getGroqConfig() {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  const model = process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
  if (!apiKey) return null;
  if (!FREE_MODEL_ALLOWLIST.has(model)) throw new Error("The configured AI model is not in Laundry's free-model allowlist");
  return { apiKey, model };
}

export async function askGroq({ apiKey, model }: { apiKey: string; model: string }, system: string, messages: FinanceChatMessage[]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, ...messages],
        temperature: 0.2,
        max_completion_tokens: 500,
        stream: false,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new GroqError("provider_http_error");
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const answer = normalizeAssistantText(payload.choices?.[0]?.message?.content);
    if (!answer) throw new GroqError("provider_empty_response");
    return answer;
  } catch (error) {
    if (error instanceof GroqError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new GroqError("provider_timeout");
    throw new GroqError("provider_network_error");
  } finally {
    clearTimeout(timeout);
  }
}
