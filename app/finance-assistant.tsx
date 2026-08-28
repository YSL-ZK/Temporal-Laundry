"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, ChatCircleDots, Gauge, LockKey, PaperPlaneTilt, ShieldCheck } from "@phosphor-icons/react";
import type { DashboardData } from "../lib/dashboard";
import type { FinanceChatMessage } from "../lib/finance-ai";
import { translate } from "../lib/i18n";

type ChatResponse = { answer?: string; error?: string; remaining?: number; resetAt?: string };

const englishSuggestions = [
  "Where did most of my spending go recently?",
  "How can I make progress on my debts?",
  "Can my current budget support my goals?",
];

export default function FinanceAssistant({ data }: { data: DashboardData }) {
  const [messages, setMessages] = useState<FinanceChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(10);
  const t = (copy: string) => translate(data.language, copy);
  const suggestions = data.language === "es" ? ["¿En qué se concentraron mis gastos recientes?", "¿Cómo puedo avanzar con mis deudas?", "¿Mi presupuesto actual permite cumplir mis metas?"] : englishSuggestions;

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || pending || !data.aiConfigured) return;
    const nextMessages: FinanceChatMessage[] = [...messages, { role: "user" as const, content: question }].slice(-8);
    setMessages(nextMessages);
    setDraft("");
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/finance-chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const payload = await response.json() as ChatResponse;
      if (typeof payload.remaining === "number") setRemaining(payload.remaining);
      if (!response.ok || !payload.answer) throw new Error(payload.error || t("Laundry Guide could not answer that question."));
      setMessages((current) => [...current, { role: "assistant" as const, content: payload.answer! }].slice(-8));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Laundry Guide could not answer that question."));
    } finally {
      setPending(false);
    }
  }

  return <section className="assistant-page">
    <section className="assistant-workbench">
      <div className="assistant-intro"><div><p className="eyebrow">{t("READ-ONLY FINANCE GUIDE")}</p><h2>{t("Ask Your Ledger.")}</h2><p>{t("Laundry turns authorized account totals, cash flow, budgets, debts, goals, and upcoming commitments into a focused explanation.")}</p></div><span className={data.aiConfigured ? "assistant-status online" : "assistant-status"}><i aria-hidden="true" />{data.aiConfigured ? t("Ready") : t("Setup required")}</span></div>
      <div className="assistant-consent"><ShieldCheck weight="duotone" aria-hidden="true" /><p><strong>{data.language === "es" ? "Antes de enviar" : "Before you send"}</strong><span>{data.language === "es" ? "Los resúmenes financieros minimizados que aparecen en el recibo de contexto serán procesados por Groq fuera de Supabase. Laundry no envía nombres, notas, recibos ni descripciones individuales, y no guarda esta conversación." : "The minimized finance summaries listed in the context receipt will be processed by Groq outside Supabase. Laundry sends no names, notes, receipts, or individual transaction descriptions and does not store this conversation."}</span></p></div>
      <div className="assistant-thread" role="log" aria-live="polite" aria-label={t("Conversation with Laundry Guide")}>
        {messages.length ? messages.map((message, index) => <article className={`assistant-message ${message.role}`} key={`${message.role}-${index}`}><span aria-hidden="true">{message.role === "assistant" ? <ChatCircleDots weight="duotone" /> : data.userName.slice(0, 2).toUpperCase()}</span><div><small>{message.role === "assistant" ? "LAUNDRY GUIDE" : t("YOU")}</small><p>{message.content}</p></div></article>) : <div className="assistant-empty"><span aria-hidden="true"><ChatCircleDots weight="duotone" /></span><h3>{t("Start with a decision.")}</h3><p>{t("Ask one concrete question. Laundry will use summaries of the finance records you are already allowed to see.")}</p><div className="assistant-suggestions">{suggestions.map((suggestion) => <button type="button" onClick={() => setDraft(suggestion)} key={suggestion}>{suggestion}<ArrowRight aria-hidden="true" /></button>)}</div></div>}
        {pending && <article className="assistant-message assistant"><span aria-hidden="true"><ChatCircleDots weight="duotone" /></span><div><small>LAUNDRY GUIDE</small><p className="assistant-thinking">{t("Reviewing the ledger summary…")}</p></div></article>}
      </div>
      <form className="assistant-composer" onSubmit={send}>
        <label htmlFor="finance-question">{t("Ask a finance question")}</label>
        <div><textarea id="finance-question" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1200} rows={3} disabled={pending || !data.aiConfigured} placeholder={data.aiConfigured ? t("Could I increase my debt payment this month?…") : t("Add the server-only Groq key in Vercel to enable Laundry Guide.")} /><button type="submit" disabled={!draft.trim() || pending || !data.aiConfigured} aria-label={t("Send question")}><PaperPlaneTilt aria-hidden="true" weight="fill" /></button></div>
        <span>{draft.length}/1,200 · {t("Recommendations are educational, not professional financial advice.")}</span>
      </form>
      {error && <p className="assistant-error" role="alert">{error}</p>}
    </section>
    <aside className="assistant-controls" aria-label={t("Assistant privacy and usage controls")}>
      <section><span className="assistant-control-icon"><ShieldCheck weight="duotone" aria-hidden="true" /></span><p className="eyebrow">{t("CONTEXT RECEIPT")}</p><h3>{t("What the model can see")}</h3><ul><li>{t("Grouped account balances")}</li><li>{t("90-day income and expenses")}</li><li>{t("Budgets, goals, and debt totals")}</li><li>{t("Upcoming bill amounts and dates")}</li></ul><p className="assistant-control-note">{t("No emails, account names, payees, notes, receipt files, or transaction-level descriptions are sent.")}</p></section>
      <section><span className="assistant-control-icon"><Gauge weight="duotone" aria-hidden="true" /></span><p className="eyebrow">{t("DAILY ALLOWANCE")}</p><h3><strong>{remaining}</strong> {t("questions left")}</h3><div className="assistant-quota" role="meter" aria-label={`${remaining} ${t("of 10 daily questions remaining")}`} aria-valuemin={0} aria-valuemax={10} aria-valuenow={remaining}><i style={{ width: `${remaining * 10}%` }} /></div><p className="assistant-control-note">{t("Maximum 3 questions per 5 minutes, 10 per person daily, and 30 per household daily.")}</p></section>
      <section><span className="assistant-control-icon"><LockKey weight="duotone" aria-hidden="true" /></span><p className="eyebrow">{t("NO AUTOPILOT")}</p><h3>{t("Advice cannot move money")}</h3><p className="assistant-control-note">{t("The model has no tools, database write access, browsing, or ability to post transactions. You review every real decision.")}</p></section>
    </aside>
  </section>;
}
