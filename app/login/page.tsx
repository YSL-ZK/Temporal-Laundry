"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
import LaundryMark from "../laundry-mark";

type Mode = "sign-in" | "sign-up";
const PASSWORD_MIN_LENGTH = 12;

function passwordChecks(password: string) {
  return {
    length: password.length >= PASSWORD_MIN_LENGTH,
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    number: /\d/.test(password),
  };
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const supabase = createClient();
    const normalizedEmail = email.normalize("NFKC").trim().toLowerCase();
    const genericError = "We couldn't complete that request. Check your details and try again.";

    if (mode === "sign-up") {
      const checks = passwordChecks(password);
      if (!Object.values(checks).every(Boolean)) {
        setMessage("Your password must have at least 12 characters, including an uppercase letter, a lowercase letter, and a number.");
        setSubmitting(false);
        return;
      }
    }

    if (mode === "sign-in") {
      const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (error) {
        const code = "code" in error ? String(error.code) : "";
        const detail = error.message.toLowerCase();
        if (code === "weak_password" || detail.includes("password") && (detail.includes("weak") || detail.includes("character"))) {
          setMessage("Your password must have at least 12 characters, including an uppercase letter, a lowercase letter, and a number.");
        } else if (code === "over_email_send_rate_limit") setMessage("Too many confirmation emails were requested. Wait a few minutes and try again.");
        else if (code === "email_address_invalid") setMessage("Enter a valid email address.");
        else setMessage(genericError);
      }
      else router.replace("/");
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        const code = "code" in error ? String(error.code) : "";
        const detail = error.message.toLowerCase();
        if (code === "weak_password" || detail.includes("password") && (detail.includes("weak") || detail.includes("character"))) {
          setMessage("Your password must have at least 12 characters, including an uppercase letter, a lowercase letter, and a number.");
        } else if (code === "over_email_send_rate_limit") setMessage("Too many confirmation emails were requested. Wait a few minutes and try again.");
        else if (code === "email_address_invalid") setMessage("Enter a valid email address.");
        else setMessage(genericError);
      }
      else if (data.session) router.replace("/");
      else setMessage("Check your email to confirm your account, then sign in.");
    }

    setSubmitting(false);
  }

  return <main className="auth-page auth-experience"><div className="auth-atmosphere" aria-hidden="true"><div className="auth-orbit auth-orbit-one" /><div className="auth-orbit auth-orbit-two" /><div className="auth-coin auth-coin-one">$</div><div className="auth-coin auth-coin-two">%</div><div className="auth-coin auth-coin-three">+</div></div><div className="auth-grid"><section className="auth-intro">
    <div className="auth-brand"><LaundryMark className="auth-brand-mark" /> <strong translate="no">Laundry</strong></div><p className="eyebrow">SHARED FINANCE, WITHOUT THE FRICTION</p>
    <h1>Money moves better in the <em>same orbit.</em></h1>
    <p>One calm place for the accounts you own, the plans you share, and the small decisions that add up.</p>
    <div className="auth-points"><span>Private by default</span><span>Shared when invited</span><span>Built on a ledger</span></div>
  </section><section className="auth-card">
    <div className="auth-card-heading"><p className="eyebrow">{mode === "sign-in" ? "WELCOME BACK" : "START HERE"}</p><span className="auth-status">Secure workspace</span></div>
    <h2>{mode === "sign-in" ? "Pick up where your money left off." : "Build a clearer household picture."}</h2>
    <p className="muted">{mode === "sign-in" ? "Sign in to your private finance workspace." : "Create your account, then name your household."}</p>
    <form className="form-grid auth-form" onSubmit={submit}>
      <label>Email<input name="email" required maxLength={254} type="email" inputMode="email" autoComplete="email" spellCheck={false} placeholder="you@example.com…" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Password<input name="password" required maxLength={128} type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} placeholder={mode === "sign-up" ? "12+ characters…" : "Your password…"} value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby={mode === "sign-up" ? "password-requirements" : undefined} /></label>
      {mode === "sign-up" && <div className="password-requirements" id="password-requirements" aria-label="Password requirements">{Object.entries({ length: "12 or more characters", lower: "One lowercase letter", upper: "One uppercase letter", number: "One number" }).map(([key, label]) => <span className={passwordChecks(password)[key as keyof ReturnType<typeof passwordChecks>] ? "met" : ""} key={key}><i aria-hidden="true">{passwordChecks(password)[key as keyof ReturnType<typeof passwordChecks>] ? "✓" : "·"}</i>{label}</span>)}</div>}
      {message && <p className="form-note" role="status">{message}</p>}
      <button className="submit-button" disabled={submitting}>{submitting ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}</button>
    </form>
    <button type="button" className="text-button auth-switch" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setMessage(""); }}>
      {mode === "sign-in" ? "Need an account? Create one" : "Already have an account? Sign in"}
    </button>
  </section></div></main>;
}
