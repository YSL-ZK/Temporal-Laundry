# Browser tests

Public authentication, accessibility, mobile reflow, and PWA checks run without a database:

```powershell
pnpm build
pnpm test:e2e -- tests/e2e/public.spec.ts
```

Authenticated finance tests require the local Supabase stack. The setup refuses any non-local Supabase or app URL, creates its own confirmed user and household, and removes them after the run.

```powershell
pnpm exec supabase start -x realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
pnpm exec supabase status -o env
```

Map the printed local `API_URL`, `ANON_KEY`, and `SERVICE_ROLE_KEY` values to `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the current terminal. Then set `E2E_FULL_STACK=1`, build, and run `pnpm test:e2e`. GitHub Actions performs these steps automatically.

Stop the isolated services when finished:

```powershell
pnpm exec supabase stop
```
