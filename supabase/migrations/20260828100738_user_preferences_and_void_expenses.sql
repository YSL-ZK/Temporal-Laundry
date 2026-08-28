-- Persist per-user language preferences and provide a tamper-evident, owner-only
-- way to remove an expense from active balances without erasing ledger history.

alter table public.profiles
  add column if not exists preferred_language text not null default 'en';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_preferred_language_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_preferred_language_check
      check (preferred_language in ('en', 'es'));
  end if;
end $$;

alter table public.transactions
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_void_pair_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_void_pair_check
      check ((voided_at is null) = (voided_by is null));
  end if;
end $$;

create index if not exists transactions_owner_active_expenses_idx
  on public.transactions (owner_id, occurred_on desc)
  where kind = 'expense' and status = 'posted' and voided_at is null;

create or replace function public.void_owned_expense(
  actor_id uuid,
  target_transaction uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  expense_record public.transactions;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Server-only operation';
  end if;
  if $1 is null or not exists (select 1 from public.profiles where id = $1) then
    raise exception 'A verified user profile is required';
  end if;
  if coalesce((
    select count(*) from public.audit_events
    where actor_id = $1
      and action = 'void_expense'
      and created_at > now() - interval '1 minute'
  ), 0) >= 20 then
    raise exception 'Expense change limit reached. Try again later.';
  end if;

  select * into expense_record
  from public.transactions
  where id = target_transaction
  for update;

  if not found
    or expense_record.owner_id <> $1
    or expense_record.kind <> 'expense'
    or expense_record.status <> 'posted'
    or expense_record.voided_at is not null then
    raise exception 'Expense cannot be removed';
  end if;

  update public.transactions
  set voided_at = now(), voided_by = $1, updated_at = now()
  where id = expense_record.id;

  insert into public.audit_events (
    household_id, actor_id, owner_id, visibility,
    entity_type, entity_id, action, data
  ) values (
    expense_record.household_id, $1, $1, expense_record.visibility,
    'transaction', expense_record.id, 'void_expense',
    jsonb_build_object('kind', expense_record.kind, 'amount', expense_record.amount, 'currency', expense_record.currency)
  );

  return expense_record.id;
end;
$$;

revoke all on function public.void_owned_expense(uuid, uuid) from public, anon, authenticated;
grant execute on function public.void_owned_expense(uuid, uuid) to service_role;
