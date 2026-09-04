-- Explicit monthly budget close decisions. These change planning limits only;
-- they never post or alter ledger transactions.
create table public.budget_rollovers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  visibility public.visibility not null,
  source_budget_id uuid not null unique references public.budgets(id) on delete cascade,
  target_budget_id uuid not null references public.budgets(id) on delete cascade,
  decision text not null check (decision in ('reset', 'carry_surplus', 'carry_balance')),
  amount numeric(18,2) not null check (amount between -999999999999 and 999999999999),
  source_spent numeric(18,2) not null check (source_spent between 0 and 999999999999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_budget_id <> target_budget_id)
);

create index budget_rollovers_target_idx on public.budget_rollovers (target_budget_id);
create index budget_rollovers_household_idx on public.budget_rollovers (household_id);

alter table public.budget_rollovers enable row level security;

create policy "scoped budget rollovers"
on public.budget_rollovers for select to authenticated
using (private.can_access(household_id, owner_id, visibility));

revoke all on table public.budget_rollovers from public, anon, authenticated;
grant select on table public.budget_rollovers to authenticated;
grant all on table public.budget_rollovers to service_role;

create function public.rollover_budget(
  actor_id uuid,
  target_budget uuid,
  rollover_decision text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_record public.budgets;
  target_record public.budgets;
  rollover_id uuid;
  next_month date;
  spent_amount numeric(18,2);
  incoming_amount numeric(18,2);
  available_amount numeric(18,2);
  rollover_amount numeric(18,2);
  target_created boolean := false;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Server-only operation';
  end if;
  if actor_id is null or target_budget is null
    or rollover_decision not in ('reset', 'carry_surplus', 'carry_balance') then
    raise exception 'Invalid budget rollover';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_budget::text || ':budget-rollover', 0));
  if coalesce((
    select count(*) from public.audit_events event
    where event.actor_id = rollover_budget.actor_id
      and event.entity_type = 'budget_rollover'
      and event.created_at > now() - interval '1 minute'
  ), 0) >= 10 then
    raise exception 'Budget rollover limit reached. Try again shortly.';
  end if;

  select * into source_record
  from public.budgets budget
  where budget.id = target_budget
  for update;

  if not found
    or source_record.month >= date_trunc('month', current_date)::date
    or not exists (
      select 1 from public.household_members member
      where member.household_id = source_record.household_id and member.user_id = actor_id
    )
    or (source_record.visibility = 'private'::public.visibility and source_record.owner_id <> actor_id) then
    raise exception 'Budget rollover access denied';
  end if;

  next_month := (date_trunc('month', source_record.month) + interval '1 month')::date;

  select round(coalesce(sum(transaction_row.amount), 0), 2)
  into spent_amount
  from public.transactions transaction_row
  where transaction_row.household_id = source_record.household_id
    and transaction_row.kind = 'expense'
    and transaction_row.status = 'posted'
    and transaction_row.voided_at is null
    and transaction_row.currency = source_record.currency
    and transaction_row.occurred_on >= source_record.month
    and transaction_row.occurred_on < next_month
    and (source_record.category_id is null or transaction_row.category_id = source_record.category_id)
    and (
      (source_record.visibility = 'shared'::public.visibility and transaction_row.visibility = 'shared'::public.visibility)
      or (source_record.visibility = 'private'::public.visibility and transaction_row.owner_id = source_record.owner_id)
    );

  select round(coalesce(sum(rollover.amount), 0), 2)
  into incoming_amount
  from public.budget_rollovers rollover
  where rollover.target_budget_id = source_record.id;

  available_amount := round(source_record.amount + incoming_amount - spent_amount, 2);
  rollover_amount := case rollover_decision
    when 'reset' then 0
    when 'carry_surplus' then greatest(available_amount, 0)
    when 'carry_balance' then available_amount
  end;

  select * into target_record
  from public.budgets budget
  where budget.household_id = source_record.household_id
    and budget.month = next_month
    and budget.currency = source_record.currency
    and budget.category_id is not distinct from source_record.category_id
    and budget.visibility = source_record.visibility
    and (budget.visibility = 'shared'::public.visibility or budget.owner_id = source_record.owner_id)
  order by budget.id
  limit 1
  for update;

  if not found then
    insert into public.budgets (
      household_id, owner_id, visibility, category_id, month, amount, envelope_amount, currency
    ) values (
      source_record.household_id, source_record.owner_id, source_record.visibility,
      source_record.category_id, next_month, source_record.amount,
      source_record.envelope_amount, source_record.currency
    ) returning * into target_record;
    target_created := true;

    insert into public.budget_envelopes (budget_id, name, allocated_amount)
    select target_record.id, envelope.name, envelope.allocated_amount
    from public.budget_envelopes envelope
    where envelope.budget_id = source_record.id
    on conflict (budget_id, name) do nothing;
  end if;

  insert into public.budget_rollovers (
    household_id, owner_id, visibility, source_budget_id, target_budget_id,
    decision, amount, source_spent
  ) values (
    source_record.household_id, source_record.owner_id, source_record.visibility,
    source_record.id, target_record.id, rollover_decision, rollover_amount, spent_amount
  )
  on conflict (source_budget_id) do update set
    target_budget_id = excluded.target_budget_id,
    decision = excluded.decision,
    amount = excluded.amount,
    source_spent = excluded.source_spent,
    updated_at = now()
  returning id into rollover_id;

  insert into public.audit_events (
    household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data
  ) values (
    source_record.household_id, actor_id, source_record.owner_id, source_record.visibility,
    'budget_rollover', rollover_id, 'set',
    jsonb_build_object(
      'source_budget_id', source_record.id,
      'target_budget_id', target_record.id,
      'decision', rollover_decision,
      'amount', rollover_amount,
      'source_spent', spent_amount,
      'target_created', target_created
    )
  );

  return rollover_id;
end;
$$;

revoke all on function public.rollover_budget(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.rollover_budget(uuid, uuid, text) to service_role;
