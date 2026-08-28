# Ledgerly

Responsive shared-household finance workspace built with Next.js and Supabase. Accounts, ledger transactions, shopping lists, categories, budgets, goals, debts, recurring bills, and household invitations use authenticated Supabase data with row-level security.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Connect Supabase

1. Create a Supabase project and configure Authentication URLs: Site URL `http://localhost:3000`, Redirect URL `http://localhost:3000/auth/callback`.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to `.env.local`. Never put a secret or service-role key in this file.
3. Link the CLI: `pnpm exec supabase login`, then `pnpm exec supabase link --project-ref ilemvtovlpjaawczfjfd`.
4. Apply the versioned migrations with `pnpm exec supabase db push`. This creates the protected ledger schema, user profiles, and first-household onboarding RPC.
5. Run `pnpm dev`, create an account, confirm the email, and create the first household.

For household email invitations and receipt uploads, add the server-only `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` and your Vercel environment. Never prefix that value with `NEXT_PUBLIC_`.

Before a public launch, configure a custom domain and SMTP provider in Supabase Auth. The default Supabase sender is suitable only for testing or a small private beta.
