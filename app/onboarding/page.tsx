"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createHousehold } from "../actions/finance";

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [taxRate, setTaxRate] = useState("0");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const { error } = await createHousehold({ name, currency, taxRate: Number(taxRate) });
    if (error) {
      setMessage(error);
      setSubmitting(false);
      return;
    }
    router.replace("/");
  }

  return <main className="auth-page"><section className="auth-card">
    <p className="eyebrow">FIRST STEP</p>
    <h1>Name your household.</h1>
    <p className="muted">You will be its owner. You can invite members later.</p>
    <form className="form-grid" onSubmit={submit}>
      <label>Household name<input required autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Alex + Jules" /></label>
      <label>Reporting currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>USD</option><option>EUR</option><option>COP</option><option>GBP</option></select></label>
      <label>Default shopping tax rate (%)<input required min="0" max="100" step="0.01" type="number" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} /></label>
      {message && <p className="form-note" role="alert">{message}</p>}
      <button className="submit-button" disabled={submitting}>{submitting ? "Creating…" : "Create household"}</button>
    </form>
  </section></main>;
}
