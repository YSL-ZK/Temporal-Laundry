# Supabase database tests

These pgTAP suites verify Laundry's database authorization boundary without retaining fixture data. Every file starts a transaction and ends with `rollback`.

## Local

Docker Desktop must be running. Start only the local database, then run the suites:

```powershell
pnpm exec supabase db start
pnpm run test:db
```

## Linked project

Use the linked-project command only against an authorized Laundry environment. Supabase CLI creates a temporary login role and pgTAP rolls every test back:

```powershell
pnpm run test:db:linked
```

The suites cover:

- RLS enablement and policy presence on every public application table;
- private/shared visibility across owners, members, unrelated households, and anonymous clients;
- nested visibility for ledger, shopping, card, recurring, planning, receipt, and reconciliation records;
- owner-only settings and invitation visibility;
- immutable/server-managed table privileges;
- every service-only finance RPC, pinned `search_path`, and browser-role denial;
- private receipt-bucket constraints and read-only object policies.

No production keys are required by CI. GitHub starts an isolated local Postgres container and reapplies the committed migrations from scratch.
