# Laundry Development Plan

This roadmap extends the original full-product plan. A checked item is implemented in the repository; hosted behavior still depends on applying migrations and configuring the documented environment values.

## Product foundation

- [x] Email/password authentication, first-household onboarding, private/shared scope, and Supabase RLS.
- [x] Ledger-backed accounts, cards, income, expenses, transfers, adjustments, transaction-date FX rates, and balance derivation.
- [x] Shopping lists with itemized checkout, tax overrides, discounts, shipping, tips, receipts, and unpurchased-item retention.
- [x] Basic budgets/envelopes, goals/allocations, debts/payments, recurring confirmations, household invitations, reporting, and CSV export.
- [x] Responsive Laundry design system, SEO metadata, social artwork, favicon set, and installable PWA shell.
- [x] Persistent English/Spanish workspace preference with localized navigation, core finance forms, planning headings, reports, settings, dates, and accessibility labels.

## Finance assistant: Laundry Guide

### Implemented foundation

- [x] Read-only chat workspace integrated into the authenticated dashboard.
- [x] Server-only Groq adapter using a reviewed allowlist of free model IDs.
- [x] RLS-authorized, data-minimized context: grouped balances, 90-day cash flow, category totals, budgets, goals, debts, and upcoming commitments.
- [x] No raw transaction descriptions, payees, account names, emails, receipts, or household names sent to the model.
- [x] Atomic Supabase quotas: 3 requests per 5 minutes, 10 per user per UTC day, 30 per household per UTC day, and a 200-request project-wide ceiling that resists account farming.
- [x] Metadata-only usage records with 90-day cleanup; prompts and responses are not stored by Laundry.
- [x] Same-origin enforcement, 16 KB request ceiling, Zod validation, 1,200-character question ceiling, eight-message history ceiling, 500-token output ceiling, and 15-second provider timeout.
- [x] Finance-scope screening, prompt-injection resistance, plain-text output rendering, and no model tools or database write capability.

### Before enabling for users

- [ ] Create a separate Groq project/key for each deployment environment and enable Groq Zero Data Retention.
- [ ] Add `GROQ_API_KEY`, optional `GROQ_MODEL`, and the existing Supabase service-role secret to Vercel; never expose them with a `NEXT_PUBLIC_` prefix.
- [x] Apply the AI quota migration and rerun Supabase Security and Performance Advisors.
- [x] Add an in-product consent notice describing which summaries leave Supabase and which inference provider processes them.
- [ ] Add deletion/privacy documentation and a provider outage status message before public launch.
- [ ] Add integration tests for authentication, RLS context isolation, parallel quota attempts, daily reset, provider timeout, malformed output, and prompt-injection cases.
- [ ] Add Cloudflare Workers AI as a provider fallback while keeping the same server-only gateway and quotas.
- [ ] Add Cloudflare Turnstile to signup after repeated abuse signals if the beta becomes publicly discoverable.

### Abuse model

The assistant is intentionally not a general agent. Users cannot choose arbitrary system prompts, model URLs, tools, or output lengths. A malicious user can still attempt to coerce an LLM into unrelated output, so the real cost boundary is the database quota plus the provider account limit—not prompt filtering alone. Failed provider calls count against the quota to prevent cheap retry abuse. The model receives no credentials or executable tools, and its output is never interpreted as SQL, HTML, code, or a financial transaction.

## Remaining finance workflows

### Category workflows and templates

- [x] Finish dedicated Bills, Transport, Dining, Health, and Travel entry experiences.
- [x] Build the category-template editor for text, numeric, currency, date, checkbox, select, multi-select, and list fields.
- [x] Connect the existing safe formula engine to template defaults, reviewed amount prefills, options, required fields, and display order.

### Transactions and records

- [x] Add payee and tag management plus transaction assignment.
- [x] Add full search/filtering across dates, accounts, categories, payees, tags, amounts, visibility, and status.
- [x] Add receipt browser/download/delete UI with storage-policy integration.
- [x] Add transaction detail with money path, historical conversion, itemized lines, receipts, and audit context.
- [x] Add private drafts plus correction/reversal workflows while preserving posted-ledger audit history.
- [x] Add creator-only expense voiding with immutable audit history and active-balance/report/export recalculation.
- [x] Build account reconciliation and statement discrepancy handling.

### Cards, bills, and calendar

- [x] Complete statement balance, utilization, closing date, due date, payment-account, and card-payment interfaces.
- [x] Generate recurring occurrences without affecting posted balances until confirmation.
- [x] Build the due calendar, overdue indicators, and duplicate-occurrence protection.
- [x] Add a dedicated in-app reminder center.

### Planning and analysis

- [x] Add full snowball/avalanche schedules with interest and payoff comparisons.
- [x] Expand budget reporting with envelope rollover decisions and monthly comparisons.
- [x] Expand goal forecasting and allocation history.
- [x] Add net-worth history, multi-currency converted reports, report filters, and additional CSV exports.

## Quality and release

- [x] Add Supabase integration tests for every RLS boundary and privileged RPC.
- [ ] Add browser tests for authentication, dashboard, operations, assistant, shopping checkout, calendar, reports, responsive layouts, and accessibility.
- [ ] Add structured, privacy-safe monitoring for failed mutations, quota denial, and provider availability without logging finance prompts.
- [ ] Configure production SMTP and a custom domain before public launch.
- [ ] Complete a release-candidate security audit, hosted advisor pass, restore test, and beta acceptance run.
