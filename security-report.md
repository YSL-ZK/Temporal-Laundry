# Security Audit Report

Date: 2026-08-27 (implementation status updated)
Score: 78/100 at original audit; targeted remediations applied afterward
Project: Next.js 16.3.3 / TypeScript / Supabase / pnpm

## Critical Issues

None found in the local source tree. `.env.local` is ignored, and no secret or service-role key is present in source files.

## High Issues

Resolved in this pass. A pnpm workspace override now pins PostCSS to `8.5.26`; `pnpm audit` reports zero vulnerabilities. Pnpm permits the required `esbuild` postinstall only and explicitly denies the optional `unrs-resolver` build step. The app now returns framing, MIME-sniffing, referrer, permissions, cross-origin, HSTS, and sensitive-page cache headers. `X-Powered-By` is disabled.

## Medium Issues

### Authentication abuse protection must also be configured for hosted Supabase

The browser calls Supabase Auth directly. Hosted Supabase Auth rate limits and CAPTCHA must be configured in the Dashboard before production. Enable email confirmation, require a stronger password policy, and enable Turnstile or hCaptcha for sign-up/sign-in abuse protection.

### Strict CSP remains deferred

The application uses inline style properties in the finance UI. A strict CSP requires a nonce/refactor pass, so it has been intentionally deferred rather than adding an unsafe policy that could break the UI.

### Strict CSP remains the outstanding code-hardening item

The original `Function`-based formula evaluator and finance `localStorage` persistence have been replaced with a declarative parser and Supabase-backed server actions. A nonce-based Content Security Policy still needs a dedicated UI refactor because the application uses inline style properties.

## What Is Secure

- Supabase uses a publishable browser key only; no service-role key is present.
- Auth sessions use Supabase SSR cookies and `getClaims()` rather than trusting a browser session object.
- RLS helper functions are migrated to a non-exposed `private` schema with pinned search paths.
- The `rls_auto_enable()` safeguard revokes public, anonymous, and authenticated function execution when the hosted function exists.
- The repository includes a tracked environment template and Dependabot updates; secret-scanner configuration was intentionally removed at the project's request.
- The callback uses the fixed server-only `APP_URL` and rejects protocol-relative redirect paths.
- Finance mutation RPCs are executable only by `service_role`; server actions authenticate the user first and database functions re-check actor, household, account, and invitation access.
- Login and sign-up normalize email input, avoid detailed error disclosure, and enforce a 12-character UI password minimum.
- Local Supabase Auth configuration enables confirmation, stronger passwords, tighter rate limits, and secure password changes.
- Next.js 16 uses the supported root `proxy.ts` convention for session refreshes, and the deprecated `next lint` command has been replaced with ESLint.

## Required Before Deployment

1. Refresh Supabase Security Advisor after the applied migrations and resolve any unrelated hosted findings.
2. Configure hosted Supabase password, confirmation, rate-limit, CAPTCHA, and MFA settings.
3. Plan and test a nonce-based CSP refactor.
4. Set production-only Vercel environment variables, including `SUPABASE_SERVICE_ROLE_KEY`, and never expose that key to the browser.
