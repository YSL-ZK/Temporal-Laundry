-- Operational plan workflows: all state-changing writes stay behind
-- service-role-only RPCs that re-check the authenticated actor's scope.

create index if not exists transactions_household_expense_month_idx
  on public.transactions (household_id, occurred_on, category_id)
  where kind = 'expense' and status = 'posted';

create function public.confirm_recurring_rule(
  actor_id uuid,
  target_rule uuid,
  payment_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule_record public.recurring_rules;
  transaction_id uuid;
  transaction_kind public.transaction_kind;
  next_due date;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Server-only operation';
  end if;
  if actor_id is null or payment_date is null then
    raise exception 'Invalid recurring confirmation';
  end if;
  if coalesce((select count(*) from public.transactions where owner_id = actor_id and created_at > now() - interval '1 minute'), 0) >= 30 then
    raise exception 'Transaction limit reached. Try again shortly.';
  end if;

  select * into rule_record from public.recurring_rules where id = target_rule for update;
  if not found or not rule_record.active
    or not exists (select 1 from public.household_members where household_id = rule_record.household_id and user_id = actor_id)
    or (rule_record.visibility = 'private'::public.visibility and rule_record.owner_id <> actor_id) then
    raise exception 'Recurring rule access denied';
  end if;
  if not exists (
    select 1 from public.accounts a
    where a.id = rule_record.account_id and a.household_id = rule_record.household_id and a.archived_at is null
      and (a.visibility = 'shared'::public.visibility or a.owner_id = actor_id)
  ) then
    raise exception 'Payment account access denied';
  end if;
  transaction_kind := case when rule_record.rule_kind = 'income' then 'income'::public.transaction_kind else 'expense'::public.transaction_kind end;
  if rule_record.category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = rule_record.category_id and c.household_id = rule_record.household_id and c.kind = transaction_kind::text
  ) then
    raise exception 'Recurring category access denied';
  end if;
  if exists (select 1 from public.recurring_occurrences where rule_id = target_rule and due_on = rule_record.next_due_on and status = 'confirmed') then
    raise exception 'This recurring occurrence is already confirmed';
  end if;

  insert into public.transactions (
    household_id, owner_id, visibility, account_id, category_id, kind, status,
    amount, currency, reporting_exchange_rate, occurred_on, payee, metadata
  ) values (
    rule_record.household_id, actor_id, rule_record.visibility, rule_record.account_id, rule_record.category_id,
    transaction_kind, 'posted', rule_record.amount, rule_record.currency, 1, payment_date,
    coalesce(nullif(trim(rule_record.provider), ''), rule_record.name),
    jsonb_build_object('recurring_rule_id', rule_record.id, 'due_on', rule_record.next_due_on)
  ) returning id into transaction_id;
  insert into public.ledger_entries (transaction_id, account_id, amount)
  values (transaction_id, rule_record.account_id, case when transaction_kind = 'income' then rule_record.amount else -rule_record.amount end);
  insert into public.recurring_occurrences (rule_id, due_on, transaction_id, status, amount)
  values (target_rule, rule_record.next_due_on, transaction_id, 'confirmed', rule_record.amount)
  on conflict (rule_id, due_on) do update
    set transaction_id = excluded.transaction_id, status = 'confirmed', amount = excluded.amount;

  next_due := case rule_record.cadence
    when 'weekly' then rule_record.next_due_on + 7
    when 'monthly' then (rule_record.next_due_on + interval '1 month')::date
    when 'quarterly' then (rule_record.next_due_on + interval '3 months')::date
    when 'yearly' then (rule_record.next_due_on + interval '1 year')::date
    else null
  end;
  if next_due is null then raise exception 'Unsupported recurring cadence'; end if;
  update public.recurring_rules set next_due_on = next_due where id = target_rule;
  return transaction_id;
end;
$$;

create function public.allocate_goal(
  actor_id uuid,
  target_goal uuid,
  allocation_amount numeric,
  allocation_date date,
  allocation_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  goal_record public.goals;
  allocation_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  if actor_id is null or allocation_amount <= 0 or allocation_date is null or (allocation_note is not null and length(trim(allocation_note)) > 500) then
    raise exception 'Invalid goal allocation';
  end if;
  select * into goal_record from public.goals where id = target_goal for update;
  if not found or not exists (select 1 from public.household_members where household_id = goal_record.household_id and user_id = actor_id)
    or (goal_record.visibility = 'private'::public.visibility and goal_record.owner_id <> actor_id) then
    raise exception 'Goal access denied';
  end if;
  insert into public.goal_allocations (goal_id, amount, allocated_on, note)
  values (target_goal, allocation_amount, allocation_date, nullif(trim(allocation_note), ''))
  returning id into allocation_id;
  update public.goals set current_amount = current_amount + allocation_amount where id = target_goal;
  return allocation_id;
end;
$$;

create function public.record_debt_payment(
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
  transaction_id uuid;
  transaction_kind public.transaction_kind;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  if actor_id is null or payment_amount <= 0 or payment_date is null or (payment_note is not null and length(trim(payment_note)) > 500) then
    raise exception 'Invalid debt payment';
  end if;
  if coalesce((select count(*) from public.transactions where owner_id = actor_id and created_at > now() - interval '1 minute'), 0) >= 30 then
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
  if not exists (
    select 1 from public.accounts a where a.id = source_account and a.household_id = debt_record.household_id and a.archived_at is null
      and (a.visibility = 'shared'::public.visibility or a.owner_id = actor_id)
  ) then raise exception 'Payment account access denied'; end if;
  if debt_record.account_id is not null and debt_record.account_id = source_account then raise exception 'Choose a different payment account'; end if;
  if debt_record.account_id is not null and not exists (
    select 1 from public.accounts a where a.id = debt_record.account_id and a.household_id = debt_record.household_id
      and (a.visibility = 'shared'::public.visibility or a.owner_id = actor_id)
  ) then raise exception 'Linked debt account access denied'; end if;
  transaction_kind := case when debt_record.account_id is null then 'expense'::public.transaction_kind else 'transfer'::public.transaction_kind end;
  insert into public.transactions (
    household_id, owner_id, visibility, account_id, transfer_account_id, kind, status,
    amount, currency, reporting_exchange_rate, occurred_on, payee, note, metadata
  ) values (
    debt_record.household_id, actor_id, payment_visibility, source_account, debt_record.account_id,
    transaction_kind, 'posted', payment_amount, debt_record.currency, 1, payment_date, debt_record.creditor,
    nullif(trim(payment_note), ''), jsonb_build_object('debt_id', debt_record.id)
  ) returning id into transaction_id;
  insert into public.ledger_entries (transaction_id, account_id, amount) values (transaction_id, source_account, -payment_amount);
  if debt_record.account_id is not null then
    insert into public.ledger_entries (transaction_id, account_id, amount) values (transaction_id, debt_record.account_id, payment_amount);
  end if;
  insert into public.debt_payments (debt_id, transaction_id, amount, paid_on)
  values (target_debt, transaction_id, payment_amount, payment_date);
  update public.debts set balance = balance - payment_amount where id = target_debt;
  return transaction_id;
end;
$$;

create function public.create_budget_envelope(
  actor_id uuid,
  target_budget uuid,
  envelope_name text,
  allocated_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  budget_record public.budgets;
  envelope_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  if actor_id is null or length(trim(envelope_name)) = 0 or length(trim(envelope_name)) > 80 or allocated_amount < 0 then
    raise exception 'Invalid budget envelope';
  end if;
  select * into budget_record from public.budgets where id = target_budget for update;
  if not found or not exists (select 1 from public.household_members where household_id = budget_record.household_id and user_id = actor_id)
    or (budget_record.visibility = 'private'::public.visibility and budget_record.owner_id <> actor_id) then
    raise exception 'Budget access denied';
  end if;
  insert into public.budget_envelopes (budget_id, name, allocated_amount)
  values (target_budget, trim(envelope_name), allocated_amount)
  returning id into envelope_id;
  return envelope_id;
end;
$$;

revoke all on function public.confirm_recurring_rule(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.allocate_goal(uuid, uuid, numeric, date, text) from public, anon, authenticated;
revoke all on function public.record_debt_payment(uuid, uuid, uuid, numeric, date, public.visibility, text) from public, anon, authenticated;
revoke all on function public.create_budget_envelope(uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.confirm_recurring_rule(uuid, uuid, date) to service_role;
grant execute on function public.allocate_goal(uuid, uuid, numeric, date, text) to service_role;
grant execute on function public.record_debt_payment(uuid, uuid, uuid, numeric, date, public.visibility, text) to service_role;
grant execute on function public.create_budget_envelope(uuid, uuid, text, numeric) to service_role;
