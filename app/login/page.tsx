"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";

type Mode = "sign-in" | "sign-up";

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

    if (mode === "sign-in") {
      const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (error) setMessage(genericError);
      else router.replace("/");
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) setMessage(genericError);
      else if (data.session) router.replace("/");
      else setMessage("Check your email to confirm your account, then sign in.");
    }

    setSubmitting(false);
  }

  return <main className="auth-page"><section className="auth-card">
    <p className="eyebrow">LEDGERLY</p>
    <h1>{mode === "sign-in" ? "Welcome back." : "Start your household."}</h1>
    <p className="muted">Private finances, shared when you choose.</p>
    <form className="form-grid" onSubmit={submit}>
      <label>Email<input required maxLength={254} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Password<input required minLength={12} maxLength={128} type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {message && <p className="form-note" role="status">{message}</p>}
      <button className="submit-button" disabled={submitting}>{submitting ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}</button>
    </form>
    <button type="button" className="text-button auth-switch" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setMessage(""); }}>
      {mode === "sign-in" ? "Need an account? Create one" : "Already have an account? Sign in"}
    </button>
  </section></main>;
}
