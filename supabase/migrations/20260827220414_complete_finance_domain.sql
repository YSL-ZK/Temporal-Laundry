-- Complete the production finance domain without rewriting the existing migration history.
-- All money remains NUMERIC and every report is derived from posted ledger entries.

create table public.payees (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  amount numeric(18,2) not null check (amount <> 0),
  created_at timestamptz not null default now(),
  unique (transaction_id, account_id)
);
create index ledger_entries_account_transaction_idx on public.ledger_entries (account_id, transaction_id);

create table public.transaction_tags (
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (transaction_id, tag_id)
);

create table public.transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  category_id uuid references public.categories(id),
  name text not null check (length(trim(name)) between 1 and 160),
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(18,2) not null check (unit_price >= 0),
  discount numeric(18,2) not null default 0 check (discount >= 0),
  tax numeric(18,2) not null default 0 check (tax >= 0),
  metadata jsonb not null default '{}',
  sort_order integer not null default 0
);

create table public.card_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  payment_account_id uuid references public.accounts(id),
  statement_balance numeric(18,2) not null default 0,
  closing_day smallint not null check (closing_day between 1 and 31),
  due_day smallint not null check (due_day between 1 and 31),
  updated_at timestamptz not null default now()
);

alter table public.recurring_rules
  add column if not exists rule_kind text not null default 'bill' check (rule_kind in ('bill', 'subscription', 'income')),
  add column if not exists provider text,
  add column if not exists service_reference text,
  add column if not exists billing_period text,
  add column if not exists deadline_day smallint check (deadline_day between 1 and 31);

create table public.recurring_occurrences (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.recurring_rules(id) on delete cascade,
  due_on date not null,
  transaction_id uuid references public.transactions(id),
  status text not null default 'projected' check (status in ('projected', 'confirmed', 'skipped')),
  amount numeric(18,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (rule_id, due_on)
);

create table public.goal_allocations (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete set null,
  amount numeric(18,2) not null check (amount > 0),
  allocated_on date not null default current_date,
  note text
);

create table public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete set null,
  amount numeric(18,2) not null check (amount > 0),
  paid_on date not null default current_date
);

create table public.budget_envelopes (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  allocated_amount numeric(18,2) not null default 0 check (allocated_amount >= 0),
  unique (budget_id, name)
);

create table public.reconciliations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  statement_ending_balance numeric(18,2) not null,
  statement_ending_on date not null,
  reconciled_at timestamptz not null default now(),
  note text
);

create table public.reconciliation_entries (
  reconciliation_id uuid not null references public.reconciliations(id) on delete cascade,
  ledger_entry_id uuid not null references public.ledger_entries(id) on delete cascade,
  primary key (reconciliation_id, ledger_entry_id)
);

create table public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  invited_by uuid not null references public.profiles(id),
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (household_id, email, status)
);
create index household_invitations_pending_idx on public.household_invitations (household_id, status, expires_at);

alter table public.template_fields
  add column if not exists default_value jsonb,
  add column if not exists formula_definition jsonb,
  add column if not exists amount_prefill boolean not null default false;

alter table public.receipts
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint check (size_bytes is null or size_bytes between 1 and 10485760);

alter table public.audit_events
  add column if not exists owner_id uuid references public.profiles(id),
  add column if not exists visibility public.visibility not null default 'shared';

drop policy if exists "member audits" on public.audit_events;
create policy "scoped audit events" on public.audit_events
  for select to authenticated
  using (private.can_access(household_id, owner_id, visibility));

create or replace function private.transaction_is_accessible(target_transaction uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.transactions t
    where t.id = target_transaction
      and private.can_access(t.household_id, t.owner_id, t.visibility)
  );
$$;
revoke all on function private.transaction_is_accessible(uuid) from public;
grant execute on function private.transaction_is_accessible(uuid) to authenticated;

alter table public.payees enable row level security;
alter table public.tags enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.transaction_tags enable row level security;
alter table public.transaction_items enable row level security;
alter table public.card_settings enable row level security;
alter table public.recurring_occurrences enable row level security;
alter table public.goal_allocations enable row level security;
alter table public.debt_payments enable row level security;
alter table public.budget_envelopes enable row level security;
alter table public.reconciliations enable row level security;
alter table public.reconciliation_entries enable row level security;
alter table public.household_invitations enable row level security;

create policy "household payees" on public.payees for all to authenticated
  using (private.is_household_member(household_id)) with check (private.is_household_member(household_id));
create policy "household tags" on public.tags for all to authenticated
  using (private.is_household_member(household_id)) with check (private.is_household_member(household_id));
create policy "accessible ledger entries" on public.ledger_entries for select to authenticated
  using (private.transaction_is_accessible(transaction_id));
create policy "accessible transaction tags" on public.transaction_tags for select to authenticated
  using (private.transaction_is_accessible(transaction_id));
create policy "accessible transaction items" on public.transaction_items for select to authenticated
  using (private.transaction_is_accessible(transaction_id));
create policy "card settings follow account" on public.card_settings for select to authenticated
  using (exists (select 1 from public.accounts a where a.id = account_id and private.can_access(a.household_id, a.owner_id, a.visibility)));
create policy "manage card settings with account access" on public.card_settings for all to authenticated
  using (exists (select 1 from public.accounts a where a.id = account_id and private.can_access(a.household_id, a.owner_id, a.visibility)))
  with check (exists (select 1 from public.accounts a where a.id = account_id and private.can_access(a.household_id, a.owner_id, a.visibility)));
create policy "recurring occurrences follow rule" on public.recurring_occurrences for select to authenticated
  using (exists (select 1 from public.recurring_rules r where r.id = rule_id and private.can_access(r.household_id, r.owner_id, r.visibility)));
create policy "goal allocations follow goal" on public.goal_allocations for select to authenticated
  using (exists (select 1 from public.goals g where g.id = goal_id and private.can_access(g.household_id, g.owner_id, g.visibility)));
create policy "debt payments follow debt" on public.debt_payments for select to authenticated
  using (exists (select 1 from public.debts d where d.id = debt_id and private.can_access(d.household_id, d.owner_id, d.visibility)));
create policy "budget envelopes follow budget" on public.budget_envelopes for select to authenticated
  using (exists (select 1 from public.budgets b where b.id = budget_id and private.can_access(b.household_id, b.owner_id, b.visibility)));
create policy "scoped reconciliations" on public.reconciliations for all to authenticated
  using (private.can_access(household_id, owner_id, 'private'::public.visibility))
  with check (private.can_access(household_id, owner_id, 'private'::public.visibility));
create policy "reconciliation entries follow reconciliation" on public.reconciliation_entries for select to authenticated
  using (exists (select 1 from public.reconciliations r where r.id = reconciliation_id and private.can_access(r.household_id, r.owner_id, 'private'::public.visibility)));
create policy "owners manage household invitations" on public.household_invitations for all to authenticated
  using (private.is_household_owner(household_id)) with check (private.is_household_owner(household_id));

grant select, insert, update, delete on public.payees, public.tags, public.ledger_entries,
  public.transaction_tags, public.transaction_items, public.card_settings, public.recurring_occurrences,
  public.goal_allocations, public.debt_payments, public.budget_envelopes, public.reconciliations,
  public.reconciliation_entries, public.household_invitations to authenticated;

create or replace function public.create_household_invitation(target_household uuid, invite_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare invitation_id uuid; normalized_email text;
begin
  if (select auth.uid()) is null or not private.is_household_owner(target_household) then
    raise exception 'Only household owners can invite members';
  end if;
  if coalesce((select count(*) from public.household_invitations where invited_by = (select auth.uid()) and created_at > now() - interval '1 hour'), 0) >= 10 then
    raise exception 'Invitation limit reached. Try again later.';
  end if;
  normalized_email := lower(trim(invite_email));
  if normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Invalid email address'; end if;
  insert into public.household_invitations (household_id, invited_by, email)
  values (target_household, (select auth.uid()), normalized_email)
  on conflict (household_id, email, status) do update set status = 'pending', expires_at = now() + interval '7 days', created_at = now()
  returning id into invitation_id;
  return invitation_id;
end;
$$;
revoke all on function public.create_household_invitation(uuid, text) from public;
grant execute on function public.create_household_invitation(uuid, text) to authenticated;

create or replace function public.accept_household_invitation(invitation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare invite public.household_invitations; account_email text;
begin
  if (select auth.uid()) is null then raise exception 'You must be signed in'; end if;
  select lower(email) into account_email from auth.users where id = (select auth.uid());
  select * into invite from public.household_invitations where id = invitation_id for update;
  if not found or invite.status <> 'pending' or invite.expires_at <= now() or invite.email <> account_email then
    raise exception 'Invitation is invalid or expired';
  end if;
  insert into public.household_members (household_id, user_id, role) values (invite.household_id, (select auth.uid()), 'member') on conflict do nothing;
  update public.household_invitations set status = 'accepted', accepted_at = now() where id = invitation_id;
  return invite.household_id;
end;
$$;
revoke all on function public.accept_household_invitation(uuid) from public;
grant execute on function public.accept_household_invitation(uuid) to authenticated;

-- Posting is the only supported write path for ledger entries. It creates balanced
-- entries atomically and never exposes direct entry mutation to browser clients.
drop policy if exists "scoped transactions" on public.transactions;
create policy "read scoped transactions" on public.transactions for select to authenticated
  using (private.can_access(household_id, owner_id, visibility));

create or replace function public.post_transaction(
  target_household uuid,
  source_account uuid,
  target_account uuid,
  target_category uuid,
  transaction_kind public.transaction_kind,
  transaction_amount numeric,
  transaction_currency char(3),
  transaction_rate numeric,
  transaction_date date,
  transaction_visibility public.visibility,
  transaction_payee text default null,
  transaction_note text default null,
  transaction_items jsonb default '[]'
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare transaction_id uuid; owner uuid := (select auth.uid()); item jsonb;
begin
  if owner is null then raise exception 'You must be signed in'; end if;
  if not private.is_household_member(target_household) then raise exception 'Household access denied'; end if;
  if transaction_amount <= 0 or transaction_rate <= 0 or transaction_date is null then raise exception 'Invalid transaction values'; end if;
  if not exists (select 1 from public.accounts where id = source_account and household_id = target_household and private.can_access(household_id, owner_id, visibility)) then
    raise exception 'Source account access denied';
  end if;
  if transaction_kind = 'transfer' then
    if target_account is null or target_account = source_account or not exists (select 1 from public.accounts where id = target_account and household_id = target_household and private.can_access(household_id, owner_id, visibility)) then
      raise exception 'A different accessible destination account is required';
    end if;
  elsif target_account is not null then
    raise exception 'Destination account is only valid for transfers';
  end if;
  if target_category is not null and not exists (select 1 from public.categories where id = target_category and household_id = target_household) then
    raise exception 'Category access denied';
  end if;

  insert into public.transactions (household_id, owner_id, visibility, account_id, transfer_account_id, category_id, kind, status, amount, currency, reporting_exchange_rate, occurred_on, payee, note)
  values (target_household, owner, transaction_visibility, source_account, target_account, target_category, transaction_kind, 'posted', transaction_amount, upper(transaction_currency), transaction_rate, transaction_date, nullif(trim(transaction_payee), ''), nullif(trim(transaction_note), ''))
  returning id into transaction_id;

  if transaction_kind = 'income' or transaction_kind = 'adjustment' then
    insert into public.ledger_entries (transaction_id, account_id, amount) values (transaction_id, source_account, transaction_amount);
  elsif transaction_kind = 'expense' then
    insert into public.ledger_entries (transaction_id, account_id, amount) values (transaction_id, source_account, -transaction_amount);
  else
    insert into public.ledger_entries (transaction_id, account_id, amount) values
      (transaction_id, source_account, -transaction_amount), (transaction_id, target_account, transaction_amount);
  end if;

  for item in select value from jsonb_array_elements(coalesce(transaction_items, '[]'::jsonb)) loop
    insert into public.transaction_items (transaction_id, category_id, name, quantity, unit_price, discount, tax)
    values (transaction_id, nullif(item ->> 'categoryId', '')::uuid, left(trim(item ->> 'name'), 160), coalesce((item ->> 'quantity')::numeric, 1), coalesce((item ->> 'unitPrice')::numeric, 0), coalesce((item ->> 'discount')::numeric, 0), coalesce((item ->> 'tax')::numeric, 0));
  end loop;
  return transaction_id;
end;
$$;
revoke all on function public.post_transaction(uuid, uuid, uuid, uuid, public.transaction_kind, numeric, char(3), numeric, date, public.visibility, text, text, jsonb) from public;
grant execute on function public.post_transaction(uuid, uuid, uuid, uuid, public.transaction_kind, numeric, char(3), numeric, date, public.visibility, text, text, jsonb) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
