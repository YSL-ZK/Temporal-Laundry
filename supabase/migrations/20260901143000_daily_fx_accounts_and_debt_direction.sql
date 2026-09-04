-- Add daily COP-based exchange-rate snapshots, safe account lifecycle RPCs,
-- and explicit payable/receivable debt direction without rewriting history.

create table public.daily_exchange_rates (
  valuation_date date not null,
  currency char(3) not null,
  cop_per_unit numeric(20,8) not null check (cop_per_unit > 0),
  source text not null check (source in ('identity', 'datos.gov.co', 'ecb.europa.eu')),
  source_observed_on date not null,
  fetched_at timestamptz not null default now(),
  primary key (valuation_date, currency),
  constraint daily_exchange_rates_supported_currency check (currency in ('COP', 'USD', 'EUR'))
);

create index daily_exchange_rates_latest_currency_idx
  on public.daily_exchange_rates (currency, valuation_date desc);

alter table public.daily_exchange_rates enable row level security;
alter table public.daily_exchange_rates force row level security;

create policy "authenticated users read daily exchange rates"
  on public.daily_exchange_rates for select to authenticated using (true);

revoke all on public.daily_exchange_rates from public, anon, authenticated;
grant select on public.daily_exchange_rates to authenticated;
grant select, insert, update on public.daily_exchange_rates to service_role;

create function public.store_daily_exchange_rates(
  target_date date,
  usd_cop numeric,
  eur_cop numeric,
  usd_observed_on date,
  eur_observed_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Server-only operation';
  end if;
  if target_date is null or usd_observed_on is null or eur_observed_on is null
    or usd_cop < 100 or usd_cop > 20000
    or eur_cop < 100 or eur_cop > 30000 then
    raise exception 'Invalid daily exchange rates';
  end if;

  insert into public.daily_exchange_rates
    (valuation_date, currency, cop_per_unit, source, source_observed_on)
  values
    (target_date, 'COP', 1, 'identity', target_date),
    (target_date, 'USD', usd_cop, 'datos.gov.co', usd_observed_on),
    (target_date, 'EUR', eur_cop, 'ecb.europa.eu', eur_observed_on)
  on conflict (valuation_date, currency) do update set
    cop_per_unit = excluded.cop_per_unit,
    source = excluded.source,
    source_observed_on = excluded.source_observed_on,
    fetched_at = now();
end;
$$;

revoke all on function public.store_daily_exchange_rates(date, numeric, numeric, date, date) from public, anon, authenticated;
grant execute on function public.store_daily_exchange_rates(date, numeric, numeric, date, date) to service_role;

create function private.exchange_rate(
  source_currency char(3),
  target_currency char(3),
  rate_on date
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with selected_rates as (
    select requested.currency,
      coalesce(
        (select rate.cop_per_unit
         from public.daily_exchange_rates rate
         where rate.currency = requested.currency and rate.valuation_date <= rate_on
         order by rate.valuation_date desc limit 1),
        (select rate.cop_per_unit
         from public.daily_exchange_rates rate
         where rate.currency = requested.currency
         order by rate.valuation_date desc limit 1)
      ) as cop_per_unit
    from (values (upper(source_currency)::char(3)), (upper(target_currency)::char(3))) requested(currency)
  )
  select case
    when upper(source_currency) = upper(target_currency) then 1::numeric
    else
      (select cop_per_unit from selected_rates where currency = upper(source_currency)::char(3)) /
      nullif((select cop_per_unit from selected_rates where currency = upper(target_currency)::char(3)), 0)
  end;
$$;

revoke all on function private.exchange_rate(char(3), char(3), date) from public, anon, authenticated;

alter table public.debts
  add column if not exists direction text not null default 'payable';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'debts_direction_check' and conrelid = 'public.debts'::regclass
  ) then
    alter table public.debts
      add constraint debts_direction_check check (direction in ('payable', 'receivable'));
  end if;
end
$$;

-- Existing installations may contain currencies outside the newly supported set.
-- NOT VALID preserves those rows while enforcing COP/USD/EUR for every new write.
do $$
declare
  target record;
  constraint_name text;
begin
  for target in
    select * from (values
      ('households', 'reporting_currency'),
      ('accounts', 'currency'),
      ('transactions', 'currency'),
      ('recurring_rules', 'currency'),
      ('goals', 'currency'),
      ('debts', 'currency'),
      ('budgets', 'currency'),
      ('shopping_lists', 'currency')
    ) as supported(table_name, column_name)
  loop
    constraint_name := target.table_name || '_' || target.column_name || '_supported_check';
    if not exists (
      select 1 from pg_constraint
      where conname = constraint_name
        and conrelid = ('public.' || target.table_name)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I check (%I in (''COP'', ''USD'', ''EUR'')) not valid',
        target.table_name, constraint_name, target.column_name
      );
    end if;
  end loop;
end
$$;

create function public.create_finance_account(
  actor_id uuid,
  target_household uuid,
  account_name text,
  account_kind public.account_kind,
  account_currency char(3),
  account_opening_balance numeric,
  account_visibility public.visibility,
  card_credit_limit numeric default null,
  card_payment_account uuid default null,
  card_closing_day smallint default null,
  card_due_day smallint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_account_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  if actor_id is null or not exists (
    select 1 from public.household_members
    where household_id = target_household and user_id = actor_id
  ) then raise exception 'Household access denied'; end if;
  if length(trim(account_name)) not between 1 and 80
    or upper(account_currency) not in ('COP', 'USD', 'EUR')
    or account_opening_balance is null
    or abs(account_opening_balance) > 999999999999 then
    raise exception 'Invalid account values';
  end if;
  if coalesce((select count(*) from public.audit_events
    where actor_id = create_finance_account.actor_id and entity_type = 'account'
      and created_at > now() - interval '1 minute'), 0) >= 20 then
    raise exception 'Account mutation limit reached. Try again shortly.';
  end if;
  if account_kind = 'card'::public.account_kind then
    if card_credit_limit is not null and card_credit_limit <= 0 then raise exception 'Card limit must be positive'; end if;
    if (card_closing_day is null) <> (card_due_day is null) then raise exception 'Provide both card statement dates'; end if;
  elsif card_credit_limit is not null or card_payment_account is not null or card_closing_day is not null or card_due_day is not null then
    raise exception 'Card settings require a card account';
  end if;
  if card_payment_account is not null and not exists (
    select 1 from public.accounts payment
    where payment.id = card_payment_account and payment.household_id = target_household
      and payment.archived_at is null
      and (payment.visibility = 'shared'::public.visibility or payment.owner_id = actor_id)
  ) then raise exception 'Payment account access denied'; end if;

  insert into public.accounts (
    household_id, owner_id, visibility, name, kind, currency, opening_balance,
    credit_limit, closing_day, due_day
  ) values (
    target_household, actor_id, account_visibility, trim(account_name), account_kind,
    upper(account_currency), account_opening_balance,
    case when account_kind = 'card'::public.account_kind then card_credit_limit end,
    case when account_kind = 'card'::public.account_kind then card_closing_day end,
    case when account_kind = 'card'::public.account_kind then card_due_day end
  ) returning id into new_account_id;

  if account_kind = 'card'::public.account_kind and card_closing_day is not null then
    insert into public.card_settings (account_id, payment_account_id, closing_day, due_day)
    values (new_account_id, card_payment_account, card_closing_day, card_due_day);
  end if;

  insert into public.audit_events (
    household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data
  ) values (
    target_household, actor_id, actor_id, account_visibility, 'account', new_account_id,
    'create_account', jsonb_build_object('kind', account_kind, 'currency', upper(account_currency))
  );
  return new_account_id;
end;
$$;

create function public.update_finance_account(
  actor_id uuid,
  target_account uuid,
  account_name text,
  account_visibility public.visibility,
  card_credit_limit numeric default null,
  card_payment_account uuid default null,
  card_closing_day smallint default null,
  card_due_day smallint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_record public.accounts;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  select * into account_record from public.accounts where id = target_account and archived_at is null for update;
  if not found or not exists (
    select 1 from public.household_members
    where household_id = account_record.household_id and user_id = actor_id
  ) or (account_record.visibility = 'private'::public.visibility and account_record.owner_id <> actor_id) then
    raise exception 'Account access denied';
  end if;
  if length(trim(account_name)) not between 1 and 80 then raise exception 'Invalid account name'; end if;
  if account_visibility = 'private'::public.visibility and account_record.owner_id <> actor_id then
    raise exception 'Only the account creator can make it private';
  end if;
  if coalesce((select count(*) from public.audit_events
    where actor_id = update_finance_account.actor_id and entity_type = 'account'
      and created_at > now() - interval '1 minute'), 0) >= 20 then
    raise exception 'Account mutation limit reached. Try again shortly.';
  end if;
  if account_record.kind = 'card'::public.account_kind then
    if card_credit_limit is not null and card_credit_limit <= 0 then raise exception 'Card limit must be positive'; end if;
    if (card_closing_day is null) <> (card_due_day is null) then raise exception 'Provide both card statement dates'; end if;
    if card_payment_account = target_account then raise exception 'A card cannot pay itself'; end if;
    if card_payment_account is not null and not exists (
      select 1 from public.accounts payment
      where payment.id = card_payment_account and payment.household_id = account_record.household_id
        and payment.archived_at is null
        and (payment.visibility = 'shared'::public.visibility or payment.owner_id = actor_id)
    ) then raise exception 'Payment account access denied'; end if;
  end if;

  update public.accounts set
    name = trim(account_name), visibility = account_visibility,
    credit_limit = case when account_record.kind = 'card'::public.account_kind then card_credit_limit end,
    closing_day = case when account_record.kind = 'card'::public.account_kind then card_closing_day end,
    due_day = case when account_record.kind = 'card'::public.account_kind then card_due_day end
  where id = target_account;

  if account_record.kind = 'card'::public.account_kind and card_closing_day is not null then
    insert into public.card_settings (account_id, payment_account_id, closing_day, due_day)
    values (target_account, card_payment_account, card_closing_day, card_due_day)
    on conflict (account_id) do update set
      payment_account_id = excluded.payment_account_id,
      closing_day = excluded.closing_day,
      due_day = excluded.due_day,
      updated_at = now();
  elsif account_record.kind = 'card'::public.account_kind then
    delete from public.card_settings where account_id = target_account;
  end if;

  insert into public.audit_events (
    household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data
  ) values (
    account_record.household_id, actor_id, account_record.owner_id, account_visibility,
    'account', target_account, 'update_account', jsonb_build_object('name', trim(account_name))
  );
  return target_account;
end;
$$;

create function public.archive_finance_account(actor_id uuid, target_account uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_record public.accounts;
  current_balance numeric;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  select * into account_record from public.accounts where id = target_account and archived_at is null for update;
  if not found or not exists (
    select 1 from public.household_members
    where household_id = account_record.household_id and user_id = actor_id
  ) or (account_record.visibility = 'private'::public.visibility and account_record.owner_id <> actor_id) then
    raise exception 'Account access denied';
  end if;
  if coalesce((select count(*) from public.audit_events
    where actor_id = archive_finance_account.actor_id and entity_type = 'account'
      and created_at > now() - interval '1 minute'), 0) >= 20 then
    raise exception 'Account mutation limit reached. Try again shortly.';
  end if;

  select account_record.opening_balance + coalesce(sum(entry.amount), 0)
    into current_balance
  from public.ledger_entries entry
  join public.transactions transaction_record on transaction_record.id = entry.transaction_id
  where entry.account_id = target_account
    and transaction_record.status = 'posted'::public.transaction_status
    and transaction_record.voided_at is null;
  current_balance := coalesce(current_balance, account_record.opening_balance);
  if abs(current_balance) >= 0.005 then raise exception 'Account balance must be zero before archiving'; end if;
  if exists (select 1 from public.recurring_rules where account_id = target_account and active)
    or exists (select 1 from public.debts where account_id = target_account and balance > 0)
    or exists (select 1 from public.card_settings where payment_account_id = target_account) then
    raise exception 'Account still has active links';
  end if;

  update public.accounts set archived_at = now() where id = target_account;
  insert into public.audit_events (
    household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data
  ) values (
    account_record.household_id, actor_id, account_record.owner_id, account_record.visibility,
    'account', target_account, 'archive_account', jsonb_build_object('balance', current_balance)
  );
  return target_account;
end;
$$;

revoke insert, update, delete on public.accounts, public.card_settings from authenticated;
revoke all on function public.create_finance_account(uuid, uuid, text, public.account_kind, char(3), numeric, public.visibility, numeric, uuid, smallint, smallint) from public, anon, authenticated;
revoke all on function public.update_finance_account(uuid, uuid, text, public.visibility, numeric, uuid, smallint, smallint) from public, anon, authenticated;
revoke all on function public.archive_finance_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_finance_account(uuid, uuid, text, public.account_kind, char(3), numeric, public.visibility, numeric, uuid, smallint, smallint) to service_role;
grant execute on function public.update_finance_account(uuid, uuid, text, public.visibility, numeric, uuid, smallint, smallint) to service_role;
grant execute on function public.archive_finance_account(uuid, uuid) to service_role;

create or replace function public.record_debt_payment(
  actor_id uuid,
  target_debt uuid,
  source_account uuid,
  payment_amount numeric,
  payment_date date,
  payment_visibility public.visibility,
  payment_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  debt_record public.debts;
  cash_account public.accounts;
  household_currency char(3);
  transaction_id uuid;
  transaction_kind public.transaction_kind;
  reporting_rate numeric;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  if actor_id is null or payment_amount <= 0 or payment_date is null
    or (payment_note is not null and length(trim(payment_note)) > 500) then
    raise exception 'Invalid debt payment';
  end if;
  if coalesce((select count(*) from public.transactions
    where owner_id = actor_id and created_at > now() - interval '1 minute'), 0) >= 30 then
    raise exception 'Transaction limit reached. Try again shortly.';
  end if;
  select * into debt_record from public.debts where id = target_debt for update;
  if not found or payment_amount > debt_record.balance
    or not exists (select 1 from public.household_members where household_id = debt_record.household_id and user_id = actor_id)
    or (debt_record.visibility = 'private'::public.visibility and debt_record.owner_id <> actor_id) then
    raise exception 'Debt payment access denied';
  end if;
  if debt_record.visibility = 'private'::public.visibility and payment_visibility <> 'private'::public.visibility then
    raise exception 'A private debt payment must remain private';
  end if;
  select * into cash_account from public.accounts
  where id = source_account and household_id = debt_record.household_id and archived_at is null
    and (visibility = 'shared'::public.visibility or owner_id = actor_id);
  if not found then raise exception 'Payment account access denied'; end if;
  if cash_account.currency <> debt_record.currency then
    raise exception 'Debt and payment account currencies must match';
  end if;
  if debt_record.account_id is not null and debt_record.account_id = source_account then
    raise exception 'Choose a different payment account';
  end if;
  if debt_record.account_id is not null and not exists (
    select 1 from public.accounts linked
    where linked.id = debt_record.account_id and linked.household_id = debt_record.household_id
      and linked.archived_at is null and linked.currency = debt_record.currency
      and (linked.visibility = 'shared'::public.visibility or linked.owner_id = actor_id)
  ) then raise exception 'Linked debt account access denied'; end if;

  select reporting_currency into household_currency from public.households where id = debt_record.household_id;
  reporting_rate := private.exchange_rate(debt_record.currency, household_currency, payment_date);
  if reporting_rate is null then raise exception 'Daily exchange rate unavailable'; end if;

  transaction_kind := case
    when debt_record.account_id is not null then 'transfer'::public.transaction_kind
    when debt_record.direction = 'receivable' then 'income'::public.transaction_kind
    else 'expense'::public.transaction_kind
  end;

  insert into public.transactions (
    household_id, owner_id, visibility, account_id, transfer_account_id, kind, status,
    amount, currency, reporting_exchange_rate, occurred_on, payee, note, metadata
  ) values (
    debt_record.household_id, actor_id, payment_visibility,
    case when debt_record.direction = 'receivable' and debt_record.account_id is not null then debt_record.account_id else source_account end,
    case when debt_record.account_id is null then null
         when debt_record.direction = 'receivable' then source_account else debt_record.account_id end,
    transaction_kind, 'posted', payment_amount, debt_record.currency, reporting_rate,
    payment_date, debt_record.creditor, nullif(trim(payment_note), ''),
    jsonb_build_object('debt_id', debt_record.id, 'debt_direction', debt_record.direction)
  ) returning id into transaction_id;

  if debt_record.direction = 'receivable' then
    if debt_record.account_id is not null then
      insert into public.ledger_entries (transaction_id, account_id, amount)
      values (transaction_id, debt_record.account_id, -payment_amount),
             (transaction_id, source_account, payment_amount);
    else
      insert into public.ledger_entries (transaction_id, account_id, amount)
      values (transaction_id, source_account, payment_amount);
    end if;
  else
    insert into public.ledger_entries (transaction_id, account_id, amount)
    values (transaction_id, source_account, -payment_amount);
    if debt_record.account_id is not null then
      insert into public.ledger_entries (transaction_id, account_id, amount)
      values (transaction_id, debt_record.account_id, payment_amount);
    end if;
  end if;

  insert into public.debt_payments (debt_id, transaction_id, amount, paid_on)
  values (target_debt, transaction_id, payment_amount, payment_date);
  update public.debts set balance = balance - payment_amount where id = target_debt;
  return transaction_id;
end;
$$;

revoke all on function public.record_debt_payment(uuid, uuid, uuid, numeric, date, public.visibility, text) from public, anon, authenticated;
grant execute on function public.record_debt_payment(uuid, uuid, uuid, numeric, date, public.visibility, text) to service_role;
