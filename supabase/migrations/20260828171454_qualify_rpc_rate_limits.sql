-- Qualify audit columns so PL/pgSQL never confuses them with function arguments.

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
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  if $1 is null or not exists (select 1 from public.profiles profile_record where profile_record.id = $1) then
    raise exception 'A verified user profile is required';
  end if;
  if coalesce((
    select count(*) from public.audit_events audit_record
    where audit_record.actor_id = $1
      and audit_record.action = 'void_expense'
      and audit_record.created_at > now() - interval '1 minute'
  ), 0) >= 20 then
    raise exception 'Expense change limit reached. Try again later.';
  end if;
  select * into expense_record from public.transactions transaction_record
  where transaction_record.id = target_transaction for update;
  if not found or expense_record.owner_id <> $1 or expense_record.kind <> 'expense'
    or expense_record.status <> 'posted' or expense_record.voided_at is not null then
    raise exception 'Expense cannot be removed';
  end if;
  update public.transactions set voided_at = now(), voided_by = $1, updated_at = now()
  where id = expense_record.id;
  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (expense_record.household_id, $1, $1, expense_record.visibility, 'transaction', expense_record.id, 'void_expense', jsonb_build_object('kind', expense_record.kind, 'amount', expense_record.amount, 'currency', expense_record.currency));
  return expense_record.id;
end;
$$;

create or replace function public.create_payee(
  actor_id uuid,
  target_household uuid,
  payee_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := trim(payee_name);
  new_payee_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  if actor_id is null or not exists (select 1 from public.household_members member_record where member_record.household_id = target_household and member_record.user_id = actor_id) then
    raise exception 'Household access denied';
  end if;
  if length(normalized_name) < 1 or length(normalized_name) > 120 then raise exception 'Payee name must be between 1 and 120 characters'; end if;
  if (
    select count(*) from public.audit_events audit_record
    where audit_record.actor_id = $1 and audit_record.action in ('create_payee', 'create_tag')
      and audit_record.created_at >= now() - interval '1 minute'
  ) >= 30 then raise exception 'Organizer rate limit exceeded'; end if;
  select payee_record.id into new_payee_id from public.payees payee_record
  where payee_record.household_id = target_household and lower(payee_record.name) = lower(normalized_name) limit 1;
  if new_payee_id is null then
    insert into public.payees (household_id, name) values (target_household, normalized_name) returning id into new_payee_id;
  end if;
  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (target_household, actor_id, actor_id, 'shared', 'payee', new_payee_id, 'create_payee', jsonb_build_object('name', normalized_name));
  return new_payee_id;
end;
$$;

create or replace function public.create_tag(
  actor_id uuid,
  target_household uuid,
  tag_name text,
  tag_color text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := trim(tag_name);
  normalized_color text := lower(trim(tag_color));
  new_tag_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'Server-only operation'; end if;
  if actor_id is null or not exists (select 1 from public.household_members member_record where member_record.household_id = target_household and member_record.user_id = actor_id) then
    raise exception 'Household access denied';
  end if;
  if length(normalized_name) < 1 or length(normalized_name) > 40 then raise exception 'Tag name must be between 1 and 40 characters'; end if;
  if normalized_color !~ '^#[0-9a-f]{6}$' then raise exception 'Tag color must be a six-digit hex color'; end if;
  if (
    select count(*) from public.audit_events audit_record
    where audit_record.actor_id = $1 and audit_record.action in ('create_payee', 'create_tag')
      and audit_record.created_at >= now() - interval '1 minute'
  ) >= 30 then raise exception 'Organizer rate limit exceeded'; end if;
  select tag_record.id into new_tag_id from public.tags tag_record
  where tag_record.household_id = target_household and lower(tag_record.name) = lower(normalized_name) limit 1;
  if new_tag_id is null then
    insert into public.tags (household_id, name, color) values (target_household, normalized_name, normalized_color) returning id into new_tag_id;
  end if;
  insert into public.audit_events (household_id, actor_id, owner_id, visibility, entity_type, entity_id, action, data)
  values (target_household, actor_id, actor_id, 'shared', 'tag', new_tag_id, 'create_tag', jsonb_build_object('name', normalized_name, 'color', normalized_color));
  return new_tag_id;
end;
$$;

revoke all on function public.void_owned_expense(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_payee(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.create_tag(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.void_owned_expense(uuid, uuid) to service_role;
grant execute on function public.create_payee(uuid, uuid, text) to service_role;
grant execute on function public.create_tag(uuid, uuid, text, text) to service_role;
