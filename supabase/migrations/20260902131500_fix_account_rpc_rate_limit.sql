-- Qualify audit columns in account RPC rate limits and serialize the check per actor.

create or replace function public.create_finance_account(
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

  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':account_mutation', 0));
  if coalesce((select count(*) from public.audit_events event
    where event.actor_id = create_finance_account.actor_id and event.entity_type = 'account'
      and event.created_at > now() - interval '1 minute'), 0) >= 20 then
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

create or replace function public.update_finance_account(
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

  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':account_mutation', 0));
  if coalesce((select count(*) from public.audit_events event
    where event.actor_id = update_finance_account.actor_id and event.entity_type = 'account'
      and event.created_at > now() - interval '1 minute'), 0) >= 20 then
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

create or replace function public.archive_finance_account(actor_id uuid, target_account uuid)
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

  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':account_mutation', 0));
  if coalesce((select count(*) from public.audit_events event
    where event.actor_id = archive_finance_account.actor_id and event.entity_type = 'account'
      and event.created_at > now() - interval '1 minute'), 0) >= 20 then
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

revoke all on function public.create_finance_account(uuid, uuid, text, public.account_kind, char(3), numeric, public.visibility, numeric, uuid, smallint, smallint) from public, anon, authenticated;
revoke all on function public.update_finance_account(uuid, uuid, text, public.visibility, numeric, uuid, smallint, smallint) from public, anon, authenticated;
revoke all on function public.archive_finance_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_finance_account(uuid, uuid, text, public.account_kind, char(3), numeric, public.visibility, numeric, uuid, smallint, smallint) to service_role;
grant execute on function public.update_finance_account(uuid, uuid, text, public.visibility, numeric, uuid, smallint, smallint) to service_role;
grant execute on function public.archive_finance_account(uuid, uuid) to service_role;
