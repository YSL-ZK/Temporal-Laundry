-- Statement-aware cards and materialized recurring obligations.
-- Projected occurrences never create ledger entries; confirmation is the only
-- path that posts money. All mutation functions are service-role-only and
-- independently re-check the authenticated actor supplied by the server.

create table public.card_statements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  visibility public.visibility not null,
  period_start date not null,
  closing_on date not null,
  due_on date not null,
  statement_balance numeric(18,2) not null check (statement_balance > 0 and statement_balance <= 999999999999),
  paid_amount numeric(18,2) not null default 0 check (paid_amount >= 0 and paid_amount <= statement_balance),
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_statements_period_valid check (period_start <= closing_on and closing_on < due_on),
  unique (account_id, closing_on)
);

create index card_statements_account_due_idx on public.card_statements (account_id, due_on);
create index card_statements_owner_id_idx on public.card_statements (owner_id);
create index card_statements_household_open_due_idx on public.card_statements (household_id, due_on)
  where status = 'open';
create index recurring_occurrences_projected_due_idx on public.recurring_occurrences (due_on, rule_id)
  where status = 'projected';

alter table public.card_statements enable row level security;
create policy "card statements follow account" on public.card_statements
  for select to authenticated
  using (private.can_access(household_id, owner_id, visibility));

revoke all on public.card_statements from public, anon, authenticated;
grant select on public.card_statements to authenticated;
grant select, insert, update, delete on public.card_statements to service_role;

create function private.validate_card_payment_account()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  card_record public.accounts;
  payment_record public.accounts;
begin
  if new.payment_account_id is null then return new; end if;
  select * into card_record from public.accounts where id = new.account_id;
  select * into payment_record from public.accounts where id = new.payment_account_id;
  if not found or card_record.kind <> 'card'::public.account_kind
    or payment_record.id = card_record.id
    or payment_record.household_id <> card_record.household_id
    or payment_record.currency <> card_record.currency
    or payment_record.visibility <> card_record.visibility
    or (card_record.visibility = 'private'::public.visibility and payment_record.owner_id <> card_record.owner_id)
    or payment_record.archived_at is not null then
    raise exception 'Card payment account must be an active account with matching household, currency, and visibility';
  end if;
  return new;
end;
$$;

create trigger validate_card_payment_account
before insert or update of account_id, payment_account_id on public.card_settings
for each row execute function private.validate_card_payment_account();

create function public.generate_recurring_occurrences(target_through date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule_record public.recurring_rules;
  due_cursor date;
  inserted_count integer := 0;
  affected integer;
  iterations integer;
begin
  if target_through is null or target_through < current_date or target_through > current_date + 366 then
    raise exception 'Invalid recurring generation horizon';
  end if;

  for rule_record in
    select * from public.recurring_rules where active order by id
  loop
    due_cursor := rule_record.next_due_on;
    iterations := 0;
    while due_cursor <= target_through and iterations < 60 loop
      insert into public.recurring_occurrences (rule_id, due_on, status, amount)
      values (rule_record.id, due_cursor, 'projected', rule_record.amount)
      on conflict (rule_id, due_on) do nothing;
      get diagnostics affected = row_count;
      inserted_count := inserted_count + affected;
      iterations := iterations + 1;
      due_cursor := case rule_record.cadence
        when 'weekly' then due_cursor + 7
        when 'monthly' then (due_cursor + interval '1 month')::date
        when 'quarterly' then (due_cursor + interval '3 months')::date
        when 'yearly' then (due_cursor + interval '1 year')::date
        else null
      end;
      if due_cursor is null then raise exception 'Unsupported recurring cadence'; end if;
    end loop;
  end loop;
  return inserted_count;
end;
$$;

create function public.confirm_recurring_occurrence(
  actor_id uuid,
  target_occurrence uuid,
  payment_date date,
  transaction_rate numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  occurrence_record public.recurring_occurrences;
  rule_record public.recurring_rules;
  posted_transaction_id uuid;
  transaction_kind public.transaction_kind;
  following_due date;
begin
  if actor_id is null or payment_date is null or transaction_rate <= 0 or transaction_rate > 1000000 then
    raise exception 'Invalid recurring confirmation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':transaction_mutation', 0));
  if coalesce((select count(*) from public.transactions t where t.owner_id = confirm_recurring_occurrence.actor_id and t.created_at > now() - interval '1 minute'), 0) >= 30 then
    raise exception 'Transaction limit reached. Try again shortly.';
  end if;

  select * into occurrence_record from public.recurring_occurrences where id = target_occurrence for update;
  if not found or occurrence_record.status <> 'projected' then raise exception 'Recurring occurrence is not available'; end if;
  select * into rule_record from public.recurring_rules where id = occurrence_record.rule_id for update;
  if not found or not rule_record.active
    or not exists (select 1 from public.household_members hm where hm.household_id = rule_record.household_id and hm.user_id = actor_id)
    or (rule_record.visibility = 'private'::public.visibility and rule_record.owner_id <> actor_id) then
    raise exception 'Recurring occurrence access denied';
  end if;
  if not exists (
    select 1 from public.accounts a where a.id = rule_record.account_id and a.household_id = rule_record.household_id
      and a.archived_at is null and a.currency = rule_record.currency
      and (a.visibility = 'shared'::public.visibility or a.owner_id = actor_id)
      and (rule_record.visibility = 'private'::public.visibility or a.visibility = 'shared'::public.visibility)
  ) then raise exception 'Recurring account access denied'; end if;

  transaction_kind := case when rule_record.rule_kind = 'income' then 'income'::public.transaction_kind else 'expense'::public.transaction_kind end;
  if rule_record.category_id is not null and not exists (
    select 1 from public.categories c where c.id = rule_record.category_id and c.household_id = rule_record.household_id
      and c.kind = transaction_kind::text
  ) then raise exception 'Recurring category access denied'; end if;

  insert into public.transactions (
    household_id, owner_id, visibility, account_id, category_id, kind, status,
    amount, currency, reporting_exchange_rate, occurred_on, payee, metadata
  ) values (
    rule_record.household_id, actor_id, rule_record.visibility, rule_record.account_id, rule_record.category_id,
    transaction_kind, 'posted', occurrence_record.amount, rule_record.currency, transaction_rate, payment_date,
    coalesce(nullif(trim(rule_record.provider), ''), rule_record.name),
    jsonb_build_object('recurring_rule_id', rule_record.id, 'recurring_occurrence_id', occurrence_record.id, 'due_on', occurrence_record.due_on)
  ) returning id into posted_transaction_id;
  insert into public.ledger_entries (transaction_id, account_id, amount)
  values (posted_transaction_id, rule_record.account_id, case when transaction_kind = 'income' then occurrence_record.amount else -occurrence_record.amount end);

  update public.recurring_occurrences set transaction_id = posted_transaction_id, status = 'confirmed' where id = target_occurrence;
  select min(o.due_on) into following_due from public.recurring_occurrences o
    where o.rule_id = rule_record.id and o.status = 'projected' and o.due_on > occurrence_record.due_on;
  if following_due is null then
    following_due := case rule_record.cadence
      when 'weekly' then occurrence_record.due_on + 7
      when 'monthly' then (occurrence_record.due_on + interval '1 month')::date
      when 'quarterly' then (occurrence_record.due_on + interval '3 months')::date
      when 'yearly' then (occurrence_record.due_on + interval '1 year')::date
      else null
    end;
  end if;
  update public.recurring_rules set next_due_on = following_due where id = rule_record.id;
  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (rule_record.household_id, actor_id, rule_record.owner_id, rule_record.visibility, 'recurring_occurrence', occurrence_record.id, 'confirm', jsonb_build_object('transaction_id', posted_transaction_id));
  return posted_transaction_id;
end;
$$;

create function public.skip_recurring_occurrence(actor_id uuid, target_occurrence uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  occurrence_record public.recurring_occurrences;
  rule_record public.recurring_rules;
  following_due date;
begin
  if actor_id is null then raise exception 'Invalid recurring skip'; end if;
  select * into occurrence_record from public.recurring_occurrences where id = target_occurrence for update;
  if not found or occurrence_record.status <> 'projected' then raise exception 'Recurring occurrence is not available'; end if;
  select * into rule_record from public.recurring_rules where id = occurrence_record.rule_id for update;
  if not found
    or not exists (select 1 from public.household_members hm where hm.household_id = rule_record.household_id and hm.user_id = actor_id)
    or (rule_record.visibility = 'private'::public.visibility and rule_record.owner_id <> actor_id) then
    raise exception 'Recurring occurrence access denied';
  end if;
  update public.recurring_occurrences set status = 'skipped' where id = target_occurrence;
  select min(o.due_on) into following_due from public.recurring_occurrences o
    where o.rule_id = rule_record.id and o.status = 'projected' and o.due_on > occurrence_record.due_on;
  following_due := coalesce(following_due, case rule_record.cadence
    when 'weekly' then occurrence_record.due_on + 7
    when 'monthly' then (occurrence_record.due_on + interval '1 month')::date
    when 'quarterly' then (occurrence_record.due_on + interval '3 months')::date
    when 'yearly' then (occurrence_record.due_on + interval '1 year')::date
    else null end);
  update public.recurring_rules set next_due_on = following_due where id = rule_record.id;
  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (rule_record.household_id, actor_id, rule_record.owner_id, rule_record.visibility, 'recurring_occurrence', occurrence_record.id, 'skip', '{}'::jsonb);
  return occurrence_record.id;
end;
$$;

create function public.record_card_statement(
  actor_id uuid,
  target_card uuid,
  statement_period_start date,
  statement_closing_on date,
  statement_due_on date,
  statement_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_record public.accounts;
  statement_id uuid;
begin
  if actor_id is null or statement_period_start is null or statement_closing_on is null or statement_due_on is null
    or statement_period_start > statement_closing_on or statement_closing_on >= statement_due_on
    or statement_amount <= 0 or statement_amount > 999999999999 then raise exception 'Invalid card statement'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':card_mutation', 0));
  if coalesce((select count(*) from public.audit_events e where e.actor_id = record_card_statement.actor_id and e.entity_type = 'card_statement' and e.created_at > now() - interval '1 minute'), 0) >= 20 then
    raise exception 'Card mutation limit reached. Try again shortly.';
  end if;
  select * into account_record from public.accounts where id = target_card for update;
  if not found or account_record.kind <> 'card'::public.account_kind or account_record.archived_at is not null
    or not exists (select 1 from public.household_members hm where hm.household_id = account_record.household_id and hm.user_id = actor_id)
    or (account_record.visibility = 'private'::public.visibility and account_record.owner_id <> actor_id) then
    raise exception 'Card access denied';
  end if;
  insert into public.card_statements (account_id, household_id, owner_id, visibility, period_start, closing_on, due_on, statement_balance)
  values (account_record.id, account_record.household_id, account_record.owner_id, account_record.visibility, statement_period_start, statement_closing_on, statement_due_on, statement_amount)
  returning id into statement_id;
  update public.card_settings set statement_balance = statement_amount, updated_at = now() where account_id = account_record.id;
  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (account_record.household_id, actor_id, account_record.owner_id, account_record.visibility, 'card_statement', statement_id, 'create', jsonb_build_object('due_on', statement_due_on, 'amount', statement_amount));
  return statement_id;
end;
$$;

create function public.record_card_payment(
  actor_id uuid,
  target_statement uuid,
  payment_amount numeric,
  payment_date date,
  transaction_rate numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  statement_record public.card_statements;
  card_record public.accounts;
  payment_record public.accounts;
  payment_account uuid;
  posted_transaction_id uuid;
  remaining numeric;
  card_balance numeric;
begin
  if actor_id is null or payment_amount <= 0 or payment_amount > 999999999999 or payment_date is null or transaction_rate <= 0 or transaction_rate > 1000000 then
    raise exception 'Invalid card payment';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':transaction_mutation', 0));
  if coalesce((select count(*) from public.transactions t where t.owner_id = record_card_payment.actor_id and t.created_at > now() - interval '1 minute'), 0) >= 30 then
    raise exception 'Transaction limit reached. Try again shortly.';
  end if;
  select * into statement_record from public.card_statements where id = target_statement for update;
  if not found or statement_record.status <> 'open' then raise exception 'Card statement is not payable'; end if;
  select * into card_record from public.accounts where id = statement_record.account_id for update;
  if not found or card_record.kind <> 'card'::public.account_kind or card_record.archived_at is not null
    or not exists (select 1 from public.household_members hm where hm.household_id = card_record.household_id and hm.user_id = actor_id)
    or (card_record.visibility = 'private'::public.visibility and card_record.owner_id <> actor_id) then raise exception 'Card access denied'; end if;
  select cs.payment_account_id into payment_account from public.card_settings cs where cs.account_id = card_record.id;
  if payment_account is null then raise exception 'Card payment account is not configured'; end if;
  select * into payment_record from public.accounts where id = payment_account for update;
  if not found or payment_record.household_id <> card_record.household_id or payment_record.archived_at is not null or payment_record.currency <> card_record.currency
    or (payment_record.visibility = 'private'::public.visibility and payment_record.owner_id <> actor_id)
    or payment_record.visibility <> card_record.visibility
    or (card_record.visibility = 'private'::public.visibility and payment_record.owner_id <> card_record.owner_id) then
    raise exception 'Card payment account access denied';
  end if;
  remaining := statement_record.statement_balance - statement_record.paid_amount;
  select card_record.opening_balance + coalesce(sum(le.amount), 0) into card_balance
    from public.ledger_entries le
    join public.transactions t on t.id = le.transaction_id
    where le.account_id = card_record.id and t.status = 'posted' and t.voided_at is null;
  if payment_amount > remaining or payment_amount > greatest(0, -coalesce(card_balance, card_record.opening_balance)) then
    raise exception 'Card payment exceeds the payable balance';
  end if;
  insert into public.transactions (
    household_id, owner_id, visibility, account_id, transfer_account_id, kind, status,
    amount, currency, reporting_exchange_rate, occurred_on, payee, metadata
  ) values (
    card_record.household_id, actor_id, card_record.visibility, payment_record.id, card_record.id, 'transfer', 'posted',
    payment_amount, card_record.currency, transaction_rate, payment_date, card_record.name,
    jsonb_build_object('card_statement_id', statement_record.id, 'card_payment', true)
  ) returning id into posted_transaction_id;
  insert into public.ledger_entries (transaction_id, account_id, amount) values
    (posted_transaction_id, payment_record.id, -payment_amount), (posted_transaction_id, card_record.id, payment_amount);
  update public.card_statements set paid_amount = paid_amount + payment_amount,
    status = case when paid_amount + payment_amount >= statement_balance then 'paid' else 'open' end,
    updated_at = now() where id = statement_record.id;
  update public.card_settings set statement_balance = greatest(0, remaining - payment_amount), updated_at = now() where account_id = card_record.id;
  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (card_record.household_id, actor_id, card_record.owner_id, card_record.visibility, 'card_statement', statement_record.id, 'payment', jsonb_build_object('transaction_id', posted_transaction_id, 'amount', payment_amount));
  return posted_transaction_id;
end;
$$;

revoke all on function public.generate_recurring_occurrences(date) from public, anon, authenticated;
revoke all on function public.confirm_recurring_occurrence(uuid, uuid, date, numeric) from public, anon, authenticated;
revoke all on function public.skip_recurring_occurrence(uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_card_statement(uuid, uuid, date, date, date, numeric) from public, anon, authenticated;
revoke all on function public.record_card_payment(uuid, uuid, numeric, date, numeric) from public, anon, authenticated;
revoke execute on function public.confirm_recurring_rule(uuid, uuid, date) from service_role;
grant execute on function public.generate_recurring_occurrences(date) to service_role;
grant execute on function public.confirm_recurring_occurrence(uuid, uuid, date, numeric) to service_role;
grant execute on function public.skip_recurring_occurrence(uuid, uuid) to service_role;
grant execute on function public.record_card_statement(uuid, uuid, date, date, date, numeric) to service_role;
grant execute on function public.record_card_payment(uuid, uuid, numeric, date, numeric) to service_role;
