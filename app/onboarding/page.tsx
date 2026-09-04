"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createHousehold } from "../actions/finance";
import LaundryMark from "../laundry-mark";

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

  return <main className="auth-page auth-experience"><div className="auth-atmosphere" aria-hidden="true"><div className="auth-orbit auth-orbit-one" /><div className="auth-orbit auth-orbit-two" /><div className="auth-coin auth-coin-one">$</div><div className="auth-coin auth-coin-two">%</div><div className="auth-coin auth-coin-three">+</div></div><div className="auth-grid"><section className="auth-intro">
    <div className="auth-brand"><LaundryMark className="auth-brand-mark" /> <strong translate="no">Laundry</strong></div><p className="eyebrow">YOUR SHARED FINANCIAL SPACE</p>
    <h1>A household is more than an <em>account.</em></h1><p>Give this space a name. You will be the owner, with full control over who joins and what stays private.</p>
    <div className="auth-points"><span>Invite on your terms</span><span>Multiple currencies</span><span>Clear audit trail</span></div>
  </section><section className="auth-card">
    <div className="auth-card-heading"><p className="eyebrow">FIRST STEP</p><span className="auth-status">Owner setup</span></div>
    <h2>Name your shared space.</h2>
    <p className="muted">Start simple. You can create accounts, lists, and invitations next.</p>
    <form className="form-grid auth-form" onSubmit={submit}>
      <label>Household name<input name="householdName" required autoComplete="off" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="For example, Alex + Jules…" /></label>
      <label>Reporting currency<select name="reportingCurrency" autoComplete="off" value={currency} onChange={(event) => setCurrency(event.target.value)}><option>COP</option><option>USD</option><option>EUR</option></select></label>
      <label>Default shopping tax rate (%)<input name="defaultTaxRate" required autoComplete="off" inputMode="decimal" min="0" max="100" step="0.01" type="number" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} /></label>
      {message && <p className="form-note" role="alert">{message}</p>}
      <button className="submit-button" disabled={submitting}>{submitting ? "Creating…" : "Create household"}</button>
    </form>
  </section></div></main>;
}
