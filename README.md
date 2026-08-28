# Laundry

Responsive shared-household finance workspace built with Next.js and Supabase. Accounts, ledger transactions, shopping lists, categories, budgets, goals, debts, recurring bills, and household invitations use authenticated Supabase data with row-level security.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Connect Supabase

1. Create a Supabase project and configure Authentication URLs: Site URL `http://localhost:3000`, Redirect URL `http://localhost:3000/auth/callback`.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the untracked `.env.local` file. The server secret may also live in that local-only file, but it must never use a `NEXT_PUBLIC_` name or appear in browser code.
3. Link the CLI: `pnpm exec supabase login`, then `pnpm exec supabase link --project-ref ilemvtovlpjaawczfjfd`.
4. Apply the versioned migrations with `pnpm exec supabase db push`. This creates the protected ledger schema, user profiles, and first-household onboarding RPC.
5. Run `pnpm dev`, create an account, confirm the email, and create the first household.

For household creation, ledger posting, shopping checkout, email invitations, and receipt uploads, add the server-only `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` and your Vercel environment. Never prefix that value with `NEXT_PUBLIC_`.

Before a public launch, configure a custom domain and SMTP provider in Supabase Auth. The default Supabase sender is suitable only for testing or a small private beta.

## Enable Laundry Guide

Laundry Guide is a read-only, finance-scoped chat assistant. It is disabled until its server configuration is present.

1. Create a free [GroqCloud](https://console.groq.com/) project and API key.
2. In Groq **Data Controls**, enable Zero Data Retention.
3. Add `GROQ_API_KEY` to `.env.local` and to the Vercel project. Never prefix it with `NEXT_PUBLIC_`.
4. Optionally set `GROQ_MODEL=openai/gpt-oss-20b`; Laundry restricts model IDs to a reviewed free-model allowlist.
5. Apply the newest Supabase migration with `pnpm exec supabase db push`. The database quota is required before the chat endpoint can run.
6. Redeploy Vercel.

The assistant sends aggregated, RLS-authorized finance context only. Laundry does not store prompts or answers, and the model cannot browse, call tools, write to the database, or move money. Usage is limited to 3 questions per 5 minutes, 10 per person per UTC day, 30 per household per UTC day, and 200 total project requests per UTC day.

See [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for the remaining product roadmap and AI threat model.
